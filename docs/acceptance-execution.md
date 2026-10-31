# 隔離受入の実行・再開

通常環境・実データへ向けない。`ops/acceptance-cases.json` が必須受入行と依存関係の正本。診断行と受入行を区別し、未実装の実行入口は `command: null` として残す。既存の局所試験を全共有型・指定BFS・25か月結合・性能の代用にしない。

```sh
.venv/bin/python -m scripts.acceptance preflight
# 監査専用localhost PostgreSQL URLをPHARMSHIFT_TEST_PG_URLへ設定する。
# データベース名はpharmshift_auditで始まるものに限定する。
.venv/bin/python -m scripts.acceptance run \
  --directory audit/<新しい実行ID>/execution --case resume-public-api --detach
.venv/bin/python -m scripts.acceptance report --directory audit/<実行ID>/execution
.venv/bin/python -m scripts.acceptance resume --directory audit/<実行ID>/execution --detach
```

`--case` は指定行の依存行も実行する。終了コード0は選択した行の成功であり、全受入完了は出力の `acceptance_complete` で別判定する。`preflight` は前提確認のみ。APIやDBの疎通、資源の実測、試験実行の成功証拠にはならない。

## 証拠と再開

新規ディレクトリのみ作成し、既存証拠を上書きしない。コード・frontend・依存定義・設定・入力生成器、実行時Python主要依存・DB接続先・探索スレッドを固定する。パスワードは実行マニフェストへ記録しない。コード等が変わった場合は新規実行にする。イメージdigest・実資源・最終配布物検査は独立した必須行であり、ソースハッシュの一致だけで合格にしない。

SQLiteの実行台帳に開始・結果を追記し、試行ごとのログとSHA256を保持する。中断・初回失敗を再試行で上書きしない。成功ログの改変は失敗になり、その依存行も合格ではなくなる。親プロセスがSIGKILLされても実行中の子が所有ロックを保持し、同じケースの二重実行を拒否する。子まで停止した場合、開始のみの試行を中断として残して再試行する。

受入用pytest入口は `scripts.acceptance_pytest`。テスト0件、skip、失敗を合格にしない。汎用runnerの終了コードだけでは、任意コマンドの検証内容までは保証しない。各行のcriterion・独立期待値・コマンドの対応をレビューする。

## HTTPジョブの再開

`GET /planning/jobs/by-key?scope_id=...&idempotency_key=...` を入力再登録より先に使う。同じ操作者・部署・キーに限り、過去入力のジョブも照会できる。返却された入力hash・予算・job IDを保存済みケースと照合する。存在しない場合だけ通常の登録・受付へ進む。消去制御・認可・入力整合性の検査は維持する。

ケース段階は `GENERATED → REGISTERED → ACCEPTED → COMMITTED → OBSERVED`。根拠のない飛越し、逆行、別本文・キー・予算・jobへの置換を拒否する。再起動後に元の単調時計による受付起点を失ったケースは `elapsed=null`。機能結果が正常でも性能成功にはならない。性能の最終判定は初回試行を用いる既存 `acceptance_assessment` も必要。

## 現時点で実行入口のない受入

全製品保存経路、全共有型、独立制御の全復旧、全専用操作、指定結合BFS、指定25か月結合故障、完全復元、全視覚評価、Linux最終配布、資源実測、1440調整・1200受入・10利用者+5生成は、それぞれ実装と根拠を接続してから `null` を実コマンドへ置き換える。単に完了フラグを追加しない。

## 多職種版の実ブラウザ更新一巡

再利用する検査コードは `frontend/tests/acceptance/multirole-journey.cjs` に置く。
DBコピー、資格、TLS鍵、画像、ログはGitへ追加せず、実行ごとの管理領域へ保存する。
製品ソースのworktreeと成果物領域を混同しない。別Git管理領域に属するworktreeもあるため、
`git rev-parse --git-common-dir`、基点、未コミット差分hashをそれぞれ記録する。
整理時に古いworktreeや監査記録を自動削除・pruneしない。

この検査は通常環境の疎通確認ではなく、合成データへの書込みである。
所有確認済みの専用PostgreSQL、mock認証、専用管理領域、実生成workerを準備する。
通常18510/18511へ向けず、コンテナ内部のHTTPS18610/18611を使用する。
空のDBに既存マイグレーション、管理者本人対応、合成原本を用意し、職種登録と本人対応を実APIで行う。
保存した公開・review・操作成功を直接挿入してはならない。

```sh
# frontendディレクトリ。資格とCAは管理領域内の実在パスを指定する。
# 出力先の親だけを準備し、<新しい実行ID>は未作成の名前にする。
PHARMSHIFT_SYNTHETIC_ACCEPTANCE=1 \
ACCEPTANCE_CREDENTIALS=/managed/test-credentials.json \
ACCEPTANCE_OUTPUT=/managed/<新しい実行ID> \
NODE_EXTRA_CA_CERTS=/managed/ca.pem \
node tests/acceptance/multirole-journey.cjs
```

`.nvmrc`のNode 26.12.1で実行する。管理者による部署全体の申請・公開版の空確認を
最初の書込み前に行う。資格ファイルは合成アカウントのstaff/admin/pharmacistのみを使用し、
内容を結果要約やコマンド行へ出さない。出力先の再利用は拒否する。
既存データを検出したときは自動削除せず、新しいDBと実行IDを用意する。

成功条件は希望提出、入力への反映、生成、検証、review、公開、本人再取得と、
初回・再読込みの画面表示、他人非表示、管理操作・別部署の拒否。
API成功と撮影だけで画面合格にしない。生成前の合成原本と期待値もhashで結び付ける。
この入口は限定ブラウザ診断であり、既存`multirole-workflow`や未実施の正式ゲートを
自動的に合格へ変更しない。実拡大、VoiceOver、全画像審査は別の実行記録にする。
