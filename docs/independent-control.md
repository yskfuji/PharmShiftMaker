# 独立消去制御：導入・照合・復元

本書は、独立した消去制御の導入、照合及び復元の手順について定めます。

## 1. 前提

production の制御サービスは、独立した世代照合への接続を必須としました。先に[世代照合の設定・初期移行・未確定処理の境界](generation-witness.md)を確認してください。

以下の起動例も、その設定を前提とします。既存の照合台帳を再初期化してはなりません。

## 2. 適用範囲

実装は `src/shift_scheduler/control/` にあり、アプリ DB とは別の PostgreSQL を正本とします。通常の利用環境には、自動では導入していません。

全保存経路、完全な復元及び書込み主体の切替えの受入は未完了であるため、本書は本番導入を完了させる手順ではありません。

## 3. 設定と起動

制御側には、次の値を秘密の設定として渡します。

| 変数 | 内容 |
|---|---|
| `PHARMSHIFT_AUTHORITY_DB_URL` | 別の PostgreSQL。DB 名に control を含めます |
| `PHARMSHIFT_AUTHORITY_PRIVATE_KEY` | Ed25519 の32バイトの秘密鍵を16進表記したもの |
| `PHARMSHIFT_AUTHORITY_CREDENTIALS` | JSON。サービスIDごとのロール（role）と32文字以上のトークン |

ロールは、`source`、`restore` 及び `operator` です。鍵及びトークンについて、サンプルを本番へ流用してはなりません。秘密鍵をアプリ及び復元先へ渡してはなりません。

```sh
# 独立DBを初期化。アプリのAlembicとは別管理。
.venv/bin/python -m scripts.control_authority
.venv/bin/uvicorn scripts.control_authority:build_app --factory --host 127.0.0.1 --port 18520
```

本番の接続には、認証付きの TLS を要します。上記の HTTP は、ローカルの合成テスト用です。

`operator` の資格情報で `POST /nodes` を呼び出し、`source` を1台、`restore` を必要な数だけ登録します。復元先は、閉鎖状態で登録されます。`operator` の資格情報を、通常の API 及びワーカーへ渡してはなりません。

アプリの API、ワーカー及び通常の CLI の全プロセスへ、次の同じ設定を配布します。

| 変数 | 用途 |
|---|---|
| `PHARMSHIFT_CONTROL_URL` | 制御サービスの HTTPS URL |
| `PHARMSHIFT_CONTROL_NODE` | 登録済みの `source` 又は `restore` の ID |
| `PHARMSHIFT_CONTROL_TOKEN` | そのサービスID専用のトークン |
| `PHARMSHIFT_CONTROL_PUBLIC_KEY` | 信頼する Ed25519 公開鍵の16進表記 |
| `PHARMSHIFT_ERASURE_MANIFEST_KEY` | 既存のマニフェストの HMAC 鍵（32バイト以上） |

アプリ側では、先に追加のマイグレーション0012を適用します。旧ワーカーとの混在を止め、全ての起動入口が新しい設定を使用することを確認します。

production で制御の設定が欠落している場合、本ソフトウェアは停止します。development で未設定の場合は、旧来のテスト及び移行との互換モードとなり、独立制御の保証の対象外です。

## 4. 曖昧なコミット

保全、保存規則、本人対応の判断及び消去の処理は、制御の `PREPARED` → アプリの操作と `control_commits` の同時コミット → 制御の `COMMITTED` の順で行われます。

`PREPARED` の間は、通常のアクセス及び復元の開放を拒否します。制御の応答については、呼出し元と毎回異なるノンスとに結び付く署名を検証し、古い許可をキャッシュしません。

応答が途絶えた後は、**元の `source` の DB** 及び `source` の資格情報で、次を実行します。

```sh
.venv/bin/python -m scripts.control_reconcile
```

受領記録（receipt）が存在し、かつ整合する場合に限り、確定できます。復元した古い DB に受領記録がないことを、取消しの根拠にしてはなりません。未確定の処理は、自動で失効させません。

`operator` の `verified-rollback` 入口は、独立に調査した証拠のハッシュ及び理由を要求します。ただし、この入口は証拠の内容を機械的に証明する機能ではありません。判断の前に、遮断を解除してはなりません。

## 5. 復元

1. 対象を別のネットワーク及び DB 権限で隔離し、`restore` ノードとして登録します。アプリ DB のバックアップで制御 DB を上書きしてはなりません。
2. バックアップ復元の CLI へ、`operator` の資格情報及び `PHARMSHIFT_RESTORE_NODE` を渡します。外部の隔離（quarantine）を記録してから、既存の復元ロックの下で、空の隔離 DB への復元を行います。
3. `scripts.erasure_manifest apply --restore-node NODE --preservation-artifacts FILE --result NEW_RESULT` により、最新のマニフェストを制御サービスから取得します。再構成の成果物の不足若しくは改変、未確定の処理又は署名若しくは世代の不一致がある場合は、閉鎖を維持します。
4. DB 及びファイルの再適用のコミット後に、検証した世代と最新の世代とを比較して開放します。途中で制御の更新があれば、再適用します。DB 内の `REPLAYED` だけでは、外部の関門を開けません。

現状の開放（release）は、権限を持つ `operator` から検証のハッシュを受け取ります。全保存先の照合結果及び検証者の正しさを、制御サービス単体では証明しません。

再構成の成果物の独立した配送、全保存先の照合及び全 CLI 入口の統一は、残件です。

制御 DB 単独の巻戻しは、独立した世代照合（witness）で拒否します。制御サービスの書込み元（`source`）の交代には、締出し（fence）の証跡と世代の一致とを要求します。

アプリ DB 内で旧主体が実行中のトランザクションまで停止させる自動手順は、別の残件です。物理ネットワークの設定の自動作成も、未実装です。

これらの残件は本ソフトウェア側で対応を要する事項であり、導入施設からの資料の提供を待つ事項としては扱いません。

## 6. 再テスト

`scripts.control_network_trial --output NEW_DIR --application-db AUDIT_DB` は、新規の独立した PostgreSQL のコンテナ、実際の HTTP プロセス及びアプリ側の新規スキーマを作成し、その範囲だけを停止し、破棄します。

このコマンドは、SIGKILL、コミット後の応答不能、DB の停止・再起動及び古い世代を検査します。この結果は、25か月の全運用、完全な pg_restore 又は RPO/RTO の合格の証拠ではありません。

## 7. 書込み元（source）の主体の交代

`control_maintenance fence-writer` は、操作ID、期待する世代及び理由を要求します。

`replace-writer` は、同じ締出し（fence）の ID、期待する世代及び新しい登録済みの `source` の ID を要求し、旧主体を `retired_source` へ変更します。旧主体の再登録、準備（prepare）及びコミットは、拒否されます。

新しい資格情報は `operator` が独立して配布し、旧アプリのプロセス及び DB 権限の停止並びに失効も実施します。曖昧なアプリのコミットについて、締出しだけを根拠に `verified-rollback` を自動実行する CLI は提供しません。

移行後も、旧入力 v1/v2/v3 の内容及びハッシュを保持します。0014は人物参照の登録と分類を追加する移行であり、原本を書き換えません。

追加された参照によって既存の人物確認は無効になるため、現在の版及び現在のハッシュで再確認します。
