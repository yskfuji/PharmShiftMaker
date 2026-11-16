# 独立消去制御：導入・照合・復元

本書は、独立した消去制御の導入、照合及び復元の手順について定める。

## 1. 前提

production の制御サービスは、独立した世代照合への接続を必須とした。先に[世代照合の設定・初期移行・未確定処理の境界](generation-witness.md)を確認する。
以下の起動例も、その設定を前提とする。既存の照合台帳を再初期化してはならない。

## 2. 適用範囲

実装は `src/shift_scheduler/control/` にあり、アプリ DB とは別の PostgreSQL を正本とする。通常の利用環境には、自動では導入していない。
全保存経路、完全な復元及び書込み主体の切替えの受入は未完了であるため、本書は本番導入を完了させる手順ではない。

## 3. 設定と起動

制御側には、次の値を秘密の設定として渡す。

| 変数 | 内容 |
|---|---|
| `PHARMSHIFT_AUTHORITY_DB_URL` | 別の PostgreSQL。DB 名に control を含める |
| `PHARMSHIFT_AUTHORITY_PRIVATE_KEY` | Ed25519 の32バイトの秘密鍵を16進表記したもの |
| `PHARMSHIFT_AUTHORITY_CREDENTIALS` | JSON。サービスIDごとのロール（role）と32文字以上のトークン |

ロールは、`source`、`restore` 及び `operator` である。鍵及びトークンについて、サンプルを本番へ流用してはならない。秘密鍵をアプリ及び復元先へ渡してはならない。

```sh
# 独立DBを初期化。アプリのAlembicとは別管理。
.venv/bin/python -m scripts.control_authority
.venv/bin/uvicorn scripts.control_authority:build_app --factory --host 127.0.0.1 --port 18520
```

本番の接続には、認証付きの TLS を要する。上記の HTTP は、ローカルの合成テスト用である。
`operator` の資格情報で `POST /nodes` を呼び出し、`source` を1台、`restore` を必要な数だけ登録する。復元先は、閉鎖状態で登録される。`operator` の資格情報を、通常の API 及びワーカーへ渡してはならない。

アプリの API、ワーカー及び通常の CLI の全プロセスへ、次の同じ設定を配布する。

| 変数 | 用途 |
|---|---|
| `PHARMSHIFT_CONTROL_URL` | 制御サービスの HTTPS URL |
| `PHARMSHIFT_CONTROL_NODE` | 登録済みの `source` 又は `restore` の ID |
| `PHARMSHIFT_CONTROL_TOKEN` | そのサービスID専用のトークン |
| `PHARMSHIFT_CONTROL_PUBLIC_KEY` | 信頼する Ed25519 公開鍵の16進表記 |
| `PHARMSHIFT_ERASURE_MANIFEST_KEY` | 既存のマニフェストの HMAC 鍵（32バイト以上） |

アプリ側では、先に追加のマイグレーション0012を適用する。旧ワーカーとの混在を止め、全ての起動入口が新しい設定を使用することを確認する。
production で制御の設定が欠落している場合、本ソフトウェアは停止する。development で未設定の場合は、旧来のテスト及び移行との互換モードとなり、独立制御の保証の対象外である。

## 4. 曖昧なコミット

保全、保存規則、本人対応の判断及び消去の処理は、制御の `PREPARED` → アプリの操作と `control_commits` の同時コミット → 制御の `COMMITTED` の順で行われる。
`PREPARED` の間は、通常のアクセス及び復元の開放を拒否する。制御の応答については、呼出し元と毎回異なるノンスとに結び付く署名を検証し、古い許可をキャッシュしない。

応答が途絶えた後は、**元の `source` の DB** 及び `source` の資格情報で、次を実行する。

```sh
.venv/bin/python -m scripts.control_reconcile
```

受領記録（receipt）が存在し、かつ整合する場合に限り、確定できる。復元した古い DB に受領記録がないことを、取消しの根拠にしてはならない。未確定の処理は、自動で失効させない。
`operator` の `verified-rollback` 入口は、独立に調査した証拠のハッシュ及び理由を要求する。ただし、この入口は証拠の内容を機械的に証明する機能ではない。判断の前に、遮断を解除してはならない。

## 5. 復元

1. 対象を別のネットワーク及び DB 権限で隔離し、`restore` ノードとして登録する。アプリ DB のバックアップで制御 DB を上書きしてはならない。
2. バックアップ復元の CLI へ、`operator` の資格情報及び `PHARMSHIFT_RESTORE_NODE` を渡す。外部の隔離（quarantine）を記録してから、既存の復元ロックの下で、空の隔離 DB への復元を行う。
3. `scripts.erasure_manifest apply --restore-node NODE --preservation-artifacts FILE --result NEW_RESULT` により、最新のマニフェストを制御サービスから取得する。再構成の成果物の不足若しくは改変、未確定の処理又は署名若しくは世代の不一致がある場合は、閉鎖を維持する。
4. DB 及びファイルの再適用のコミット後に、検証した世代と最新の世代とを比較して開放する。途中で制御の更新があれば、再適用する。DB 内の `REPLAYED` だけでは、外部の関門を開けない。

現状の開放（release）は、権限を持つ `operator` から検証のハッシュを受け取る。全保存先の照合結果及び検証者の正しさを、制御サービス単体では証明しない。
再構成の成果物の独立した配送、全保存先の照合及び全 CLI 入口の統一は、残件である。
制御 DB 単独の巻戻しは、独立した世代照合（witness）で拒否する。制御サービスの書込み元（`source`）の交代には、締出し（fence）の証跡と世代の一致とを要求する。
アプリ DB 内で旧主体が実行中のトランザクションまで停止させる自動手順は、別の残件である。物理ネットワークの設定の自動作成も、未実装である。
これらの残件は本ソフトウェア側で対応を要する事項であり、導入施設からの資料の提供を待つ事項としては扱わない。

## 6. 再テスト

`scripts.control_network_trial --output NEW_DIR --application-db AUDIT_DB` は、新規の独立した PostgreSQL のコンテナ、実際の HTTP プロセス及びアプリ側の新規スキーマを作成し、その範囲だけを停止し、破棄する。
このコマンドは、SIGKILL、コミット後の応答不能、DB の停止・再起動及び古い世代を検査する。この結果は、25か月の全運用、完全な pg_restore 又は RPO/RTO の合格の証拠ではない。

## 7. 書込み元（source）の主体の交代

`control_maintenance fence-writer` は、操作ID、期待する世代及び理由を要求する。
`replace-writer` は、同じ締出し（fence）の ID、期待する世代及び新しい登録済みの `source` の ID を要求し、旧主体を `retired_source` へ変更する。旧主体の再登録、準備（prepare）及びコミットは、拒否される。
新しい資格情報は `operator` が独立して配布し、旧アプリのプロセス及び DB 権限の停止並びに失効も実施する。曖昧なアプリのコミットについて、締出しだけを根拠に `verified-rollback` を自動実行する CLI は提供しない。

移行後も、旧入力 v1/v2/v3 の内容及びハッシュを保持する。0014は人物参照の登録と分類を追加する移行であり、原本を書き換えない。
追加された参照によって既存の人物確認は無効になるため、現在の版及び現在のハッシュで再確認する。
