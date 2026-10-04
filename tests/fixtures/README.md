# Fixtures Overview (Shift Scheduler)

このディレクトリは Phase3/4 の DoD で利用する **小規模インスタンス** を収めています。
`pytest tests/test_solver_small_instance.py` で読み込まれる YAML は、以下のコンセプトを固定し、ハード制約の回帰テストを簡単に増やせるようにしています。

## `small_instance/`

| ファイル | 役割 | 規模 |
| --- | --- | --- |
| `people.yaml` | 6 名（常勤 4, パート 2）の職員を定義 | 6 人 |
| `profiles.yaml` | 夜勤可否・週末可否などの勤務プロファイル | 4 プロファイル |
| `timeline.yaml` | 1 週間分 (2025-02-03〜2025-02-09) の在籍状況 | 6 エントリ |
| `calendar.yaml` | 7 日間の曜日・祝日フラグ | 7 日 |
| `shift_types.yaml` | 日勤/夕診/夜勤/当直などの必要人数 | 12 シフト |
| `holiday_requests.yaml` | 公休/有給の希望データ（優先度付き） | 9 件 |

### 使い方ガイド
- **原則 7 日間**：3〜7 日程度の horizon を保ち、CP-SAT モデルの状態を最小化します。
- **差分は追加ファイルで管理**：別ケースを作るときは `small_instance_weekend.yaml` など suffix を付け、`tests/test_solver_small_instance.py` から明示的にロードします。
- **命名規則**：人 ID / プロファイル ID / シフト ID は snake_case で統一し、他のフィクスチャでも再利用しやすくします。

## Property-based / Regression 指針

Phase3 のハード制約回帰を増やすときは、以下のルールに従ってフィクスチャを設計してください。

1. **1 つの物理ルールにつき 1 ケース**
   - 例：祝日種別の追加テスト、連勤上限の境界値テストなど。
   - ケースごとに YAML と Pytest をセットで追加し、テスト名にルール名を含める。
2. **期待値はコメントで明示**
   - `holiday_requests.yaml` などで、どの ID が採用されるべきか `# expect off` のようなコメントを残す。
3. **Property-based テスト候補**
   - 連勤上限：`hypothesis` の `data()` を使って 3〜7 日のランダムパターンを生成し、`max_consecutive_working_days` を越えないことを確認。
   - 祝日上限：曜日フラグをランダムに変えても `holiday_limits` を超えないことを検証。
   - 既存例：`tests/test_solver_properties.py` では weekend 制約と連勤上限を Hypothesis で検証しているので、追加ケースの雛形として利用可能。
4. **テンプレート**
   - `tests/fixtures/templates/` に YAML スニペットをまとめ、`tests/utils/fixture_factory.py` の `build_config_from_templates()` で merge して利用します。追加したテンプレートはこの README とテンプレート側の README の両方に記載し、テストコードから 1 件以上参照すること。

この README はフィクスチャを追加・更新するたびにメンテナンスし、AI / 人間どちらでも意図を即座に把握できるようにします。

## テンプレートカタログ

| テンプレート | 用途 | 参照テスト |
| --- | --- | --- |
| `baseline_staff.yaml` | 週末禁止スタッフを含むミックス構成。週末・連勤 property テストの土台。 | `tests/test_solver_properties.py::test_weekend_ineligible_staff_are_never_assigned_on_weekends` |
| `balanced_fulltime_pool.yaml` | 日勤フェアネスのみを観察する常勤 4 名セット。大規模フェアネス property に利用。 | `tests/test_solver_properties.py::test_day_shift_fairness_scales_with_randomized_horizon` |
