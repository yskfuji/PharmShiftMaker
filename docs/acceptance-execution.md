# 隔離受入試験の実行・再開

通常環境・実データへ向けない。`ops/acceptance-cases.json` が、必須の受入試験の行と依存関係の原本である。診断行と受入試験の行を区別し、未実装の実行入口は `command: null` として残す。既存の局所試験を、全共有型・指定BFS・25か月結合・性能の代用にしない。

```sh
.venv/bin/python -m scripts.acceptance preflight
# 監査専用localhost PostgreSQL URLをPHARMSHIFT_TEST_PG_URLへ設定する。
# データベース名はpharmshift_auditで始まるものに限定する。
.venv/bin/python -m scripts.acceptance run \
  --directory audit/<新しい実行ID>/execution --case resume-public-api --detach
.venv/bin/python -m scripts.acceptance report --directory audit/<実行ID>/execution
.venv/bin/python -m scripts.acceptance resume --directory audit/<実行ID>/execution --detach
```

`--case` は指定行の依存行も実行する。終了コード0は選択した行の成功であり、全受入試験の完了は出力の `acceptance_complete` で別判定する。`preflight` は前提確認だけを行い、APIやデータベースの疎通、資源の実測、試験実行の成功の根拠にはならない。

## 検証記録と再開

新規ディレクトリのみ作成し、既存の検証記録を上書きしない。コード・フロントエンド・依存定義・設定・入力生成器、実行時Python主要依存・データベース接続先・探索スレッドを固定する。パスワードは実行目録（manifest）へ記録しない。コード等が変わった場合は新規実行にする。イメージのハッシュ値（digest）・実資源・最終配布物検査は独立した必須行であり、ソースハッシュの一致だけで合格にしない。

SQLiteの実行台帳に開始・結果を追記し、試行ごとのログとSHA256を保持する。中断・初回失敗を再試行で上書きしない。成功ログの改変は失敗になり、その依存行も合格ではなくなる。親プロセスがSIGKILLされても、実行中の子が所有ロックを保持し、同じケースの二重実行を拒否する。子まで停止した場合、開始のみの試行を中断として残して再試行する。

受入試験用のpytest入口は `scripts.acceptance_pytest` である。テスト0件、スキップ、失敗を合格にしない。汎用の実行器（runner）の終了コードだけでは、任意コマンドの検証内容までは保証しない。各行のcriterion・独立期待値・コマンドの対応をレビューする。

## HTTPジョブの再開

`GET /planning/jobs/by-key?scope_id=...&idempotency_key=...` を入力再登録より先に使う。同じ操作者・部署・キーに限り、過去入力のジョブも照会できる。返却された入力ハッシュ値・予算・ジョブIDを保存済みケースと照合する。存在しない場合だけ通常の登録・受付へ進む。消去制御・認可・入力整合性の検査は維持する。

ケース段階は `GENERATED → REGISTERED → ACCEPTED → COMMITTED → OBSERVED` である。根拠のない飛越し、逆行、別本文・キー・予算・ジョブへの置換を拒否する。再起動後に元の単調時計による受付起点を失ったケースは `elapsed=null` となる。機能結果が正常でも性能成功にはならない。性能の最終判定には、初回試行を用いる既存 `acceptance_assessment` も必要である。

## 現時点で実行入口のない受入試験

全製品保存経路、全共有型、独立制御の全復旧、全専用操作、指定結合BFS、指定25か月結合故障、完全復元、全視覚評価、Linux最終配布、資源実測、1440調整・1200受入・10利用者+5生成は、それぞれ実装と根拠を接続してから `null` を実コマンドへ置き換える。単に完了フラグを追加しない。
