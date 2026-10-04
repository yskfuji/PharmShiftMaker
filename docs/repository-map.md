# リポジトリの読み順と責務

1. `README.md`：目的、起動及び現在の監査への入口
2. `docs/ideal-ui/verification.md`：公開候補において実行した検査、未完了事項及び実行条件
3. `src/shift_scheduler/domain`：入力版・契約・勤務・休暇・コピーの型
4. `src/shift_scheduler/application`：認可後の状態遷移、ジョブ、公開、台帳及び保存・消去
5. `src/shift_scheduler/validation`：元入力からの独立再計算。ソルバーの制約関数は、期待値として用いない。
6. `src/shift_scheduler/optimizer`：候補選択、ハード制約、目的関数の優先順位と探索状態
7. `src/shift_scheduler/db` 及び `alembic`：原本及び追加移行。JSON参照は、物理FKと区別する。
8. `src/shift_scheduler/api/routers` 及び `frontend/src`：公開API及び業務画面。旧経路は、読取互換を有する。
9. `tests` 及び `frontend/tests`：正例・反例・状態遷移・ブラウザー試験
10. `scripts` 及び `ops`：隔離評価、導入、バックアップ、復元及び資源制限
11. `devtools`：開発用の生成器及び監査用ツール（アプリからは読み込まない）
    - `devtools/er`：ER図と情報設計の対応表。出力先は `docs/architecture/er` である。
    - `devtools/visual`：視覚的回帰試験及び視覚的検査。使用方法は `docs/design-system/README.md` に示す。
    - `tools/` は、可搬版のNode等の格納場所であり、版管理の対象としない。

## 評価の再利用

`completion_benchmark` はV2入力を、`remediation_benchmark` はV3入力を提供し、HTTP実行は `benchmark_runner.run(workload_factory, argv)` に集約する。入力版の相違は重複ではない。なお、旧CLIの引数は保持する。

`planning_*` / `completion_*` / `remediation_*` は、名称のみを理由として削除しないこと。旧版読取、過去の再現手順、現在のimport及びE2E設定からの参照を確認した上で共通化すること。

## 開発時の生成物

Next.jsの`.next*`、ブラウザーのトレース、動画、データベースのダンプ及び生の監査ログは、公開ツリーへ保存しない。検査中の成果物は`/private/tmp/pharmshift-artifacts/<run-id>`へ出力し、リポジトリには、再生成手順、要約、目録（manifest）及び必要な合成データの基準画像のみを保持する。

公開候補の生成器は、版管理された、未コミットの変更がないコミットを入力とし、50 MBを超える単一ファイル、シンボリックリンク及び公開対象外の作業履歴を拒否する。起動中のサーバーが使用する出力先又は利用者が管理するデータベース・バックアップを、整理目的で削除してはならない。
