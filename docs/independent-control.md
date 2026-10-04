# 独立消去制御：導入・照合・復元

productionの制御サービスは、独立した世代照合への接続を必須にした。[世代照合の設定・初期移行・未確定処理の境界](generation-witness.md)を先に確認する。以下の起動例もその設定を前提とする。既存照合台帳を再初期化してはならない。

実装は `src/shift_scheduler/control/` にある。アプリデータベースとは別のPostgreSQLを、制御情報の拠り所とする。通常利用環境には自動導入していない。全保存経路・完全復元・書込み主体切替の受入試験は未完了なので、本番導入完了手順ではない。

## 設定と起動

制御側に `PHARMSHIFT_AUTHORITY_DB_URL`（別PostgreSQL、データベース名にcontrol）、`PHARMSHIFT_AUTHORITY_PRIVATE_KEY`（Ed25519の32 byte秘密鍵をhex表記）、`PHARMSHIFT_AUTHORITY_CREDENTIALS`（JSON、サービスIDごとのroleと32文字以上のトークン）を秘密設定として渡す。roleはsource（書込み主体）・restore（復元先）・operator（運用担当者）である。鍵とトークンは、サンプルを本番へ流用しない。秘密鍵をアプリ・復元先へ渡さない。

```sh
# 独立DBを初期化。アプリのAlembicとは別管理。
.venv/bin/python -m scripts.control_authority
.venv/bin/uvicorn scripts.control_authority:build_app --factory --host 127.0.0.1 --port 18520
```

本番接続には認証付きTLSが必要である。上記HTTPはローカル合成試験用である。運用担当者の資格で `POST /nodes` にsource（書込み主体）を1台、restore（復元先）を必要数登録する。復元先は閉鎖状態で登録される。運用担当者の資格を通常API・ワーカーへ渡さない。

アプリAPI・ワーカー・通常CLIの全プロセスへ同じ設定を配布する。

|変数|用途|
|---|---|
|PHARMSHIFT_CONTROL_URL|制御サービスのHTTPS URL|
|PHARMSHIFT_CONTROL_NODE|登録済みのsource/restoreのID|
|PHARMSHIFT_CONTROL_TOKEN|そのサービスID専用のトークン|
|PHARMSHIFT_CONTROL_PUBLIC_KEY|信頼するEd25519公開鍵のhex|
|PHARMSHIFT_ERASURE_MANIFEST_KEY|既存の目録（manifest）のHMAC鍵、32 byte以上|

アプリ側は、先に追加マイグレーション0012を適用する。旧ワーカーとの混在を止め、全起動入口が新しい設定を使用することを確認する。productionで制御設定が欠落すると停止する。developmentで未設定の場合は旧試験・移行との互換モードであり、独立制御の保証対象外である。

## 曖昧なコミット

保全・保存規則・本人対応判断・消去処理は、制御PREPARED→アプリ操作とcontrol_commitsの同時コミット→制御COMMITTEDの順となる。PREPARED中は通常アクセスと復元開放を拒否する。制御応答については、呼出者と毎回異なるnonceに結び付く署名を検証し、古い許可をキャッシュしない。

応答断後は、**元の書込み主体（source）のデータベース**とsourceの資格で次を実行する。

```sh
.venv/bin/python -m scripts.control_reconcile
```

receiptが存在し整合する場合だけ確定できる。復元した古いデータベースにreceiptがないことを、取消の根拠にしてはならない。未確定処理は自動失効させない。運用担当者のverified-rollback入口は、独立調査済みの証拠のハッシュ値・理由を要求する。ただし、この入口は証拠の内容を機械的に証明する機能ではない。判断前に遮断を解除しない。

## 復元

1. 対象を別ネットワーク・データベース権限で隔離し、復元先ノードとして登録する。アプリデータベースのバックアップで制御データベースを上書きしない。
2. バックアップ復元CLIへ運用担当者の資格と `PHARMSHIFT_RESTORE_NODE` を渡す。外部の隔離（quarantine）を記録してから、既存の復元ロック・空の隔離データベースへの復元を行う。
3. `scripts.erasure_manifest apply --restore-node NODE --preservation-artifacts FILE --result NEW_RESULT` により、最新の目録をサービスから取得する。再構成成果物の不足・改変、未確定処理、署名・世代の不一致では、閉鎖を維持する。
4. データベース・ファイル再適用のコミット後に、検証した世代と最新世代を比較して開放する。途中で制御更新があれば再適用する。データベース内のREPLAYEDだけでは外部ゲートを開けない。

現状の開放（release）は、権限を持つ運用担当者から検証ハッシュ値を受け取る。全保存先の照合結果・検証者の正しさをサービス単体で証明しない。再構成成果物の独立配送・全保存先照合・全CLI入口統一は未完了事項である。制御データベース単独の巻戻しは、独立世代照合（witness）で拒否する。制御サービスの書込み主体（source）の交代は、書込みの遮断（fence）の証跡と世代一致を要求する。アプリデータベース内の旧主体の実行中トランザクションまで停止させる自動手順は、別の未完了事項である。物理ネットワーク設定の自動作成も未実装である。これらを施設資料待ちに移さない。

## 再試験

`scripts.control_network_trial --output NEW_DIR --application-db AUDIT_DB` は、新規の独立したPostgreSQLコンテナ、実HTTPプロセス、アプリ側新規スキーマを作成し、その範囲だけを停止・破棄する。SIGKILL、コミット後の応答不能、データベースの停止・再起動、古い世代を検査する。これは、全25か月運用や完全pg_restore・RPO/RTOの合格の根拠ではない。

## 書込み主体（source）の交代

`control_maintenance fence-writer` は、操作ID・期待世代・理由を要求する。`replace-writer` は、同じ書込みの遮断のID、期待世代、新しい登録済みのsource IDを要求し、旧主体をretired_sourceへ変更する。旧主体の再登録・prepare・commitは拒否される。新資格の設定は、運用担当者が独立して配布する。運用担当者は、旧アプリプロセス/データベース権限の停止と失効も行う。曖昧なアプリコミットについて、書込みの遮断だけでverified-rollbackを自動実行するCLIは提供しない。

移行後も、旧入力v1/v2/v3の内容とハッシュ値を保持する。0014は人物参照の登録と分類を追加する移行で、原本を書き換えない。追加された参照により既存の人物確認は無効になるため、現版・現ハッシュ値で再確認する。
