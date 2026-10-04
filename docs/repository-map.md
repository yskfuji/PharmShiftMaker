# リポジトリの読み順と責務

1. `README.md`：目的、起動、現在の監査への入口。
2. `docs/ideal-ui/verification.md`：公開候補で実行した検査、残件及び実行条件。
3. `src/shift_scheduler/domain`：入力版・契約・勤務・休暇・コピーの型。
4. `src/shift_scheduler/application`：認可後の状態遷移、ジョブ、公開、台帳、保存・消去。
5. `src/shift_scheduler/validation`：元入力からの独立再計算。ソルバの制約関数を期待値にしない。
6. `src/shift_scheduler/optimizer`：候補選択、必須制約、目的段階と探索状態。
7. `src/shift_scheduler/db` と `alembic`：正本と追加移行。JSON参照は物理FKと区別する。
8. `src/shift_scheduler/api/routers` と `frontend/src`：公開APIと業務画面。旧経路には読取互換がある。
9. `tests` と `frontend/tests`：正例・反例・状態遷移・ブラウザ試験。
10. `scripts` と `ops`：隔離評価、導入、バックアップ、復元、資源制限。
11. `devtools`：開発用の生成器と監査の道具（アプリからは読み込まない）。
    - `devtools/er`：ER 図と情報設計の対応表。出力は `docs/architecture/er`。
    - `devtools/visual`：視覚・光学の監査。使い方は `docs/design-system/README.md`。
    - `tools/` は持ち運び用の Node などの置き場で、版管理しない。

## 評価の再利用

`completion_benchmark` はV2入力、`remediation_benchmark` はV3入力を提供し、HTTP実行は `benchmark_runner.run(workload_factory, argv)` に集約する。入力版の違いは重複ではない。旧CLIの引数は保持する。

`planning_*` / `completion_*` / `remediation_*` の名前だけで削除しない。旧版読取、過去の再現手順、現在のimport、E2E設定からの参照を確認してから共通化する。

## 開発時の生成物

Next.jsの`.next*`、ブラウザのtrace、動画、DB dump及び生の監査ログは公開ツリーへ保存しない。検査中の成果物は`/private/tmp/pharmshift-artifacts/<run-id>`へ出力し、リポジトリには再生成手順、要約、manifest及び必要な合成データの基準画像だけを残す。

公開候補の生成器は、版管理されたclean commitを入力とし、50 MBを超える単一ファイル、シンボリックリンク及び公開対象外の作業履歴を拒否する。起動中のサーバーが使用する出力先や、利用者が管理するDB・バックアップを整理目的で削除してはならない。
