# リポジトリの読み順と責務

本書は、本リポジトリを読む順序と、各ディレクトリが担う責務を定める。

## 1. 読み順と責務

1. `README.md`：目的、起動及び検証記録への入口。
2. `docs/ideal-ui/verification.md`：公開候補で実行した検査、残件及び実行条件。
3. `src/shift_scheduler/domain`：入力版、契約、勤務、休暇及びコピーの型。
4. `src/shift_scheduler/application`：認可後の状態遷移、ジョブ、公開、台帳並びに保存及び消去。
5. `src/shift_scheduler/validation`：元の入力からの独立した再計算。ソルバの制約関数を期待値としない。
6. `src/shift_scheduler/optimizer`：候補選択、必須制約、目的段階及び探索状態。
7. `src/shift_scheduler/db` 及び `alembic`：正本及び追加移行。JSON による参照は、物理的な外部キー（FK）と区別する。
8. `src/shift_scheduler/api/routers` 及び `frontend/src`：公開 API 及び業務画面。旧経路には読取りの互換性がある。
9. `tests` 及び `frontend/tests`：正例、反例、状態遷移及びブラウザのテスト。
10. `scripts` 及び `ops`：隔離評価、導入、バックアップ、復元及び資源制限。
11. `devtools`：開発用の生成器及び検査の道具。アプリケーションからは読み込まない。
    - `devtools/er`：ER 図及び情報設計の対応表。出力先は `docs/architecture/er` である。
    - `devtools/visual`：画面の視覚・光学の検査。使い方は [`docs/design-system/README.md`](design-system/README.md) に記載する。
    - 持ち運び用の Node.js 等の実行環境は、版管理せず、公開リポジトリに含めない。

## 2. 評価の再利用

`completion_benchmark` は V2 の入力を、`remediation_benchmark` は V3 の入力を提供する。HTTP による実行は、`benchmark_runner.run(workload_factory, argv)` に集約する。両者は入力版が異なるため、重複ではない。旧 CLI の引数は保持する。

`planning_*`、`completion_*` 及び `remediation_*` は、開発の段階ごとに追加したモジュールに付けた名前である。これらの名前が付いていることだけを理由に、当該モジュールを削除してはならない。共通化する場合は、旧版の読取り、過去の再現手順、現在の import 及び E2E 設定からの参照を確認した後に行うものとする。

## 3. 開発時の生成物

Next.js の `.next*`、ブラウザの trace、動画、DB のダンプ及び生の監査ログは、公開リポジトリへ保存しない。検査中の成果物は、リポジトリ外の `/private/tmp/pharmshift-artifacts/<run-id>` へ出力する。リポジトリには、再生成手順、要約、マニフェスト及び必要な合成データの基準画像だけを残す。

公開候補の生成器は、版管理された未変更のコミット（clean commit）を入力とする。当該生成器は、50 MB を超える単一ファイル、シンボリックリンク及び公開対象外の作業履歴を拒否する。

整理を目的として、起動中のサーバーが使用する出力先又は利用者が管理する DB 若しくはバックアップを削除してはならない。
