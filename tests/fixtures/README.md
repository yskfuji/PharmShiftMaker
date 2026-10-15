# Fixtures Overview (Shift Scheduler)

本ディレクトリには、Phase3/4の完了の定義（Definition of Done：DoD）で利用する**小規模インスタンス**を格納する。
`pytest tests/test_solver_small_instance.py` が読み込むYAMLは、以下のコンセプトを固定する。これにより、ハード制約の回帰テストの追加を容易にしている。

## `small_instance/`

| ファイル | 役割 | 規模 |
| --- | --- | --- |
| `people.yaml` | 6名（常勤4、パート2）の職員を定義 | 6人 |
| `profiles.yaml` | 夜勤可否・週末可否等の勤務プロファイル | 4プロファイル |
| `timeline.yaml` | 1週間分（2025-02-03〜2025-02-09）の在籍状況 | 6エントリ |
| `calendar.yaml` | 7日間の曜日・祝日フラグ | 7日 |
| `shift_types.yaml` | 日勤/夕診/夜勤/当直等の必要人数 | 12シフト |
| `holiday_requests.yaml` | 公休/有給の希望データ（優先度付き） | 9件 |

### 使い方ガイド
- **原則7日間**：3〜7日程度の計画期間（horizon）を維持し、CP-SATモデルの状態を最小化する。
- **差分は追加ファイルで管理**：別個のケースを作成する場合は、`small_instance_weekend.yaml` のように接尾辞を付し、`tests/test_solver_small_instance.py` から明示的に読み込む。
- **命名規則**：人ID / プロファイルID / シフトIDはsnake_caseに統一し、他のフィクスチャにおける再利用を容易にする。

## Property-based / Regression 指針

Phase3のハード制約の回帰テストを追加する場合は、以下のルールに従ってフィクスチャを設計すること。

1. **1つの物理ルールにつき1ケース**
   - 例：祝日種別の追加テスト、連勤上限の境界値テスト等。
   - 各ケースにつきYAMLとPytestを組で追加し、テスト名にルール名を含める。
2. **期待値はコメントで明示**
   - `holiday_requests.yaml` 等においては、いずれのIDの採用を期待するかを、`# expect off` のようなコメントとして記載する。
3. **Property-basedテスト候補**
   - 連勤上限：`hypothesis` の `data()` を用いて3〜7日のランダムパターンを生成し、`max_consecutive_working_days` を超過しないことを確認する。
   - 祝日上限：曜日フラグをランダムに変更しても `holiday_limits` を超過しないことを検証する。
   - 既存例：`tests/test_solver_properties.py` は、週末制約と連勤上限をHypothesisで検証しており、追加ケースのひな形として利用できる。
4. **テンプレート**
   - `tests/fixtures/templates/` にYAMLスニペットを集約し、`tests/utils/fixture_factory.py` の `build_config_from_templates()` によりマージして利用する。追加したテンプレートは、本READMEとテンプレート側のREADMEの双方に記載し、テストコードから1件以上参照すること。

本READMEは、フィクスチャを追加・更新する都度保守する。AIと人間のいずれが参照しても、意図を直ちに把握できる状態を維持する。

## テンプレートカタログ

| テンプレート | 用途 | 参照テスト |
| --- | --- | --- |
| `baseline_staff.yaml` | 週末禁止スタッフを含む混成の構成。週末・連勤のpropertyテストの基盤。 | `tests/test_solver_properties.py::test_weekend_ineligible_staff_are_never_assigned_on_weekends` |
| `balanced_fulltime_pool.yaml` | 日勤フェアネスのみを観察する常勤4名セット。大規模フェアネスのpropertyテストに利用。 | `tests/test_solver_properties.py::test_day_shift_fairness_scales_with_randomized_horizon` |
