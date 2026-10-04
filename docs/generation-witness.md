# 独立世代照合の導入と復旧境界

この手順は `control/witness.py` と `scripts/control_witness.py` の実装範囲を説明する。全保存経路・25か月結合故障・施設の本番受入は完了していない。既存の[独立制御手順](independent-control.md)も参照する。

## 保存領域と権限

アプリDB、消去制御DB、世代照合DBを分ける。世代照合DBは `witness_checkpoint`、`witness_intents`、`witness_intent_resolutions`で、世代・操作ID・ダイジェスト・状態を保持し、人物や元本文を受け取らない。URLの同一ホスト・ポート・DB名は資格が異なっても拒否する。ただしDNS別名、同じ物理volume、バックアップ運用の独立性をURL検査だけで証明できない。

アプリには `PHARMSHIFT_CONTROL_*` と必要なmanifest署名鍵を設定する。アプリへ制御operator資格や制御／照合の署名秘密鍵を配布しない。制御サービスだけが `PHARMSHIFT_WITNESS_URL/CLIENT/TOKEN/PUBLIC_KEY` を使う。照合サービスには独自の `PHARMSHIFT_WITNESS_DB_URL/PRIVATE_KEY/CLIENT/TOKEN` を設定する。秘密鍵は32byteのEd25519鍵のhex、tokenは32文字以上。本番通信はTLSを必須とする。開発用の資格や証明書を本番へ流用しない。

## 既存DBを保全した初期導入

1. アプリ・旧workerの更新を止め、DB／管理ファイルのバックアップと版・件数・hashを保存する。新しい制御DB・照合DB・資格を用意する。
2. 制御DBは `python -m scripts.control_authority` で追加作成する。既存Headをゼロへ戻さない。
3. 制御の全表が承認済みの移行内容であることを確認し、停止中の制御DBから `authority_digest(session)` を算出する。運用承認記録に対象DB・内容照合・digestを結び付ける。巻戻しが疑われるDBの現在値を無条件に初期正本にしない。
4. **未使用の照合DBだけ**に `python -m scripts.control_witness --verified-bootstrap-digest APPROVED_DIGEST` を実行する。既存checkpointがあれば処理は拒否する。既存台帳のリセット手順ではない。
5. `uvicorn scripts.control_witness:build_app --factory`、次に照合接続を設定した `uvicorn scripts.control_authority:build_app --factory` を権限制限した運用環境で起動する。productionの制御サービスは照合接続がないと起動を拒否する。
6. operatorがsource／restoreを登録し、アプリ・worker・CLIの資格と接続を切り替える。試験対象外の旧更新主体は停止してから開始する。切替の完全自動化・鍵交代・旧主体の失効一巡は未受入。

マイグレーション0013は型付きアカウント参照をコピー登録へ追加する。既存行を変更しない。既存コピーの人物追加は、管理者の「既存記録の操作者参照を照合」でプレビューhashを確認して適用する。追加時は旧対象者レビューを無効にし、原本hashと保存起算日は保持する。曖昧な対応を自動確定しない。

## 不確定処理と復旧

制御トランザクションは、現在の制御DB全体のdigestを照合サービスと比較し、変更後digestを準備記録してからDBをcommitし、その後照合側を確定する。

|停止位置|実装の挙動|運用上の境界|
|---|---|---|
|照合準備前|制御DB変更をrollback|同じ要求を再送可能|
|照合準備後・制御DBcommit前|未確定を残し、アクセスと復元開放を遮断|時刻で取消しない。operatorの `/witness/reconcile` が同じ制御headロック内でDB全体digestを照合し、before-image一致なら証跡付きABORTEDを記録、after-image一致なら確定する。異なるimageは遮断を維持。これはアプリ業務コミットの不存在の証明とは別|
|制御DBcommit後・照合ACK前|DB全体が準備済みafter-imageと一致する場合だけ照合側を確定|アプリ側の消去commit証跡の照合は別の制御プロトコルが担当|
|古い制御DBに復元|独立照合digestとの不一致で遮断|照合DBまで同時巻戻しされた場合や全管理者権限侵害は、この構成だけでは防げない|
|照合サービス通信断|個人情報操作と開放を停止|可用性への影響を含め本番の冗長化・訓練が必要|

`backup_pipeline.restore_command` はファイル展開前に独立quarantineを要求し、DB復元・ファイル展開だけでは開放しない。`restore_with_authority` は最新manifest・保全成果物を適用し、世代比較付きreleaseを要求する。世代が更新されればreleaseは拒否される。ネットワークACL・DBロールによる隔離の自動導入、署名付き成果物の独立配送サービス、全保存先の走査証明は残件であり、ソフトウェアのゲートだけで代替しない。

切戻し時はアプリDBだけを戻して開放してはならない。照合DBと制御DBの新版を保全し、不確定処理・新しい消去を確認する。旧ファイル台帳を別の更新正本へ戻さない。

## 検証した範囲

内部の限定試験では、独立PostgreSQLと実HTTP、照合プロセスSIGKILL、制御DB巻戻しの拒否、2人共有履歴及び1ファイルの復元・再適用を確認した。個別の環境情報を含む生の実行記録は公開候補に収録しない。この結果は、全共有型・25か月・全障害行列の証明ではない。

## 今回の追加移行と操作

通常API・workerを停止して新版へ統一したうえで、独立照合DBにだけ追加表を作成する。既存checkpoint/intentsを初期化し直さない。

```sh
.venv/bin/python -m scripts.control_witness --upgrade-resolution-schema
.venv/bin/python -m scripts.control_maintenance reconcile-witness
```

後者は `PHARMSHIFT_CONTROL_OPERATOR_ID/TOKEN` を持つ保守主体だけが実行する。実3DB・HTTP応答喪失、鍵・主体交代の限定試験を実施したが、個別の環境情報を含む生の実行記録は公開候補に収録しない。二つのコマンドはアプリDBの業務transactionを強制停止しない。sourceをfenceした事実だけからアプリ未commitと判定しない。
