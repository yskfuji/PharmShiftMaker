# 独立消去制御：導入・照合・復元

productionの制御サービスは独立した世代照合への接続を必須にした。[世代照合の設定・初期移行・未確定処理の境界](generation-witness.md)を先に確認する。以下の起動例もその設定を前提とし、既存照合台帳を再初期化してはならない。

実装は `src/shift_scheduler/control/`。アプリDBとは別のPostgreSQLを正本とする。通常利用環境には自動導入していない。全保存経路・完全復元・書込み主体切替の受入は未完了なので、本番導入完了手順ではない。

## 設定と起動

制御側に `PHARMSHIFT_AUTHORITY_DB_URL`（別PostgreSQL、DB名にcontrol）、`PHARMSHIFT_AUTHORITY_PRIVATE_KEY`（Ed25519の32 byte秘密鍵をhex表記）、`PHARMSHIFT_AUTHORITY_CREDENTIALS`（JSON、サービスIDごとのroleと32文字以上のtoken）を秘密設定として渡す。roleはsource・restore・operator。鍵とtokenはサンプルを本番へ流用しない。秘密鍵をアプリ・復元先へ渡さない。

```sh
# 独立DBを初期化。アプリのAlembicとは別管理。
.venv/bin/python -m scripts.control_authority
.venv/bin/uvicorn scripts.control_authority:build_app --factory --host 127.0.0.1 --port 18520
```

本番接続には認証付きTLSが必要。上記HTTPはローカル合成試験用。operator資格で `POST /nodes` にsourceを1台、restoreを必要数登録する。復元先は閉鎖状態で登録される。operator資格を通常API・workerへ渡さない。

アプリAPI・worker・通常CLIの全プロセスへ同じ設定を配布する。

|変数|用途|
|---|---|
|PHARMSHIFT_CONTROL_URL|制御サービスのHTTPS URL|
|PHARMSHIFT_CONTROL_NODE|登録済みsource/restore ID|
|PHARMSHIFT_CONTROL_TOKEN|そのサービスID専用token|
|PHARMSHIFT_CONTROL_PUBLIC_KEY|信頼するEd25519公開鍵のhex|
|PHARMSHIFT_ERASURE_MANIFEST_KEY|既存manifestのHMAC鍵、32 byte以上|

アプリ側は先に追加マイグレーション0012を適用する。旧workerとの混在を止め、全起動入口が新しい設定を使用することを確認する。productionで制御設定が欠落すると停止する。developmentで未設定の場合は旧試験・移行との互換モードであり、独立制御の保証対象外。

## 曖昧なコミット

保全・保存規則・本人対応判断・消去処理は、制御PREPARED→アプリ操作とcontrol_commitsの同時コミット→制御COMMITTEDの順となる。PREPARED中は通常アクセスと復元開放を拒否する。制御応答は呼出者と毎回異なるnonceに結び付く署名を検証し、古い許可をキャッシュしない。

応答断後は**元のsource DB**とsource資格で次を実行する。

```sh
.venv/bin/python -m scripts.control_reconcile
```

receiptが存在し整合する場合だけ確定できる。復元した古いDBにreceiptがないことを取消の根拠にしてはいけない。未確定処理は自動失効させない。operatorのverified-rollback入口は独立調査済みの証拠hash・理由を要求するが、証拠の内容を機械的に証明する機能ではない。判断前に遮断を解除しない。

## 復元

1. 対象を別ネットワーク・DB権限で隔離し、restoreノードとして登録する。アプリDBのバックアップで制御DBを上書きしない。
2. バックアップ復元CLIへoperator資格と `PHARMSHIFT_RESTORE_NODE` を渡す。外部quarantineを記録してから、既存の復元ロック・空の隔離DBへの復元を行う。
3. `scripts.erasure_manifest apply --restore-node NODE --preservation-artifacts FILE --result NEW_RESULT` により最新manifestをサービスから取得する。再構成成果物の不足・改変、未確定処理、署名・世代の不一致では閉鎖を維持する。
4. DB・ファイル再適用のコミット後に、検証した世代と最新世代を比較して開放する。途中で制御更新があれば再適用する。DB内REPLAYEDだけでは外部ゲートを開けない。

現状のreleaseは権限を持つoperatorから検証hashを受け取る。全保存先の照合結果・検証者の正しさをサービス単体で証明しない。再構成成果物の独立配送・全保存先照合・全CLI入口統一は残件。制御DB単独巻戻しは独立witnessで拒否し、制御サービスのsource交代はfence証跡と世代一致を要求する。アプリDB内の旧主体の実行中transactionまで停止させる自動手順は別の残件。物理ネットワーク設定の自動作成も未実装。これらを施設資料待ちに移さない。

## 再試験

`scripts.control_network_trial --output NEW_DIR --application-db AUDIT_DB` は、新規の独立PGコンテナ、実HTTPプロセス、アプリ側新規スキーマを作成し、その範囲だけを停止・破棄する。SIGKILL、コミット後の応答不能、DB停止・再起動、古い世代を検査する。これは全25か月運用や完全pg_restore・RPO/RTOの合格証拠ではない。

## source主体の交代

`control_maintenance fence-writer` は操作ID・期待世代・理由を要求する。`replace-writer` は同じfence ID、期待世代、新しい登録済みsource IDを要求し、旧主体をretired_sourceへ変更する。旧主体の再登録・prepare・commitは拒否される。新資格の設定はoperatorが独立して配布し、旧アプリプロセス/DB権限の停止と失効も実施する。曖昧なアプリcommitについて、fenceだけでverified-rollbackを自動実行するCLIは提供しない。

移行後も旧入力v1/v2/v3の内容とhashを保持する。0014は人物参照の登録と分類を追加する移行で、原本を書き換えない。追加された参照により既存の人物確認は無効になるため、現版・現hashで再確認する。
