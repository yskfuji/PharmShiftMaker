# リポジトリの読み順と責務

1. `README.md`：目的、起動、現在の監査への入口。
2. `docs/ideal-ui/verification.md`：公開候補で実行した検査、未完了事項及び実行条件。
3. `src/shift_scheduler/domain`：入力版・契約・勤務・休暇・コピーの型。
4. `src/shift_scheduler/application`：認可後の状態遷移、ジョブ、公開、台帳、保存・消去。
5. `src/shift_scheduler/validation`：元入力からの独立再計算。ソルバーの制約関数を期待値にしない。
6. `src/shift_scheduler/optimizer`：候補選択、ハード制約、目的関数の優先順位と探索状態。
7. `src/shift_scheduler/db` と `alembic`：原本と追加移行。JSON参照は物理FKと区別する。
8. `src/shift_scheduler/api/routers` と `frontend/src`：公開APIと業務画面。旧経路には読取互換がある。
9. `tests` と `frontend/tests`：正例・反例・状態遷移・ブラウザー試験。
10. `scripts` と `ops`：隔離評価、導入、バックアップ、復元、資源制限。
11. `devtools`：開発用の生成器と監査の道具（アプリからは読み込まない）。
    - `devtools/er`：ER図と情報設計の対応表。出力は `docs/architecture/er`。
    - `devtools/visual`：視覚的回帰試験及び視覚的検査。使い方は `docs/design-system/README.md`。
    - `tools/` は持ち運び用のNodeなどの置き場であり、版管理しない。

## 評価の再利用

`completion_benchmark` はV2入力を、`remediation_benchmark` はV3入力を提供する。HTTP実行は `benchmark_runner.run(workload_factory, argv)` に集約する。入力版の違いは重複ではない。旧CLIの引数は保持する。

`planning_*` / `completion_*` / `remediation_*` は、名前だけを理由に削除しないこと。旧版読取、過去の再現手順、現在のimport、E2E設定からの参照を確認してから共通化すること。

## 開発時の生成物

Next.jsの`.next*`、ブラウザーのトレース、動画、データベースのダンプ及び生の監査ログは、公開ツリーへ保存しない。検査中の成果物は`/private/tmp/pharmshift-artifacts/<run-id>`へ出力する。リポジトリには、再生成手順、要約、目録（manifest）及び必要な合成データの基準画像だけを残す。

公開候補の生成器は、版管理された、未コミットの変更がないコミットを入力とする。この生成器は、50 MBを超える単一ファイル、シンボリックリンク及び公開対象外の作業履歴を拒否する。起動中のサーバーが使用する出力先や、利用者が管理するデータベース・バックアップを、整理目的で削除してはならない。
