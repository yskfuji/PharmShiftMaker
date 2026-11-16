# テスト用フィクスチャの概要（Shift Scheduler）

本書は、`tests/fixtures/` に収める小規模インスタンスの構成と、フィクスチャを追加する際の規則を定めます。

## 1. 目的

本ディレクトリには、ソルバのハード制約の回帰テストで利用する**小規模インスタンス**を収めます。`pytest tests/test_solver_small_instance.py` が読み込む YAML は、次の構成を固定し、ハード制約の回帰テストを容易に追加できるようにしています。

## 2. `small_instance/`

| ファイル | 役割 | 規模 |
| --- | --- | --- |
| `staff_people.yaml` | 6 名（常勤 4, パート 2）の職員を定義 | 6 人 |
| `staff_profiles.yaml` | 夜勤可否・週末可否などの勤務プロファイル | 4 プロファイル |
| `staff_timeline.yaml` | 1 週間分（2025-02-03〜2025-02-09）の在籍状況 | 6 エントリ |
| `calendar_2025_02.yaml` | 7 日間の曜日・祝日フラグ | 7 日 |
| `shift_types.yaml` | 日勤/夕診/夜勤/当直などの必要人数 | 12 シフト |
| `holiday_requests_2025_02.yaml` | 公休/有給の希望データ（優先度付き） | 9 件 |

### 2.1 使い方

- 期間は、原則として7日間とします。計画期間（horizon）を3〜7日程度に保ち、CP-SAT モデルの状態を最小化します。
- 差分は、追加ファイルで管理します。別のケースを作る場合は、`small_instance_weekend.yaml` のように接尾辞（suffix）を付け、`tests/test_solver_small_instance.py` から明示的に読み込みます。
- 人 ID、プロファイル ID 及びシフト ID は、snake_case に統一し、他のフィクスチャでも再利用しやすくします。

## 3. プロパティベーステスト及び回帰テストの指針

ハード制約の回帰テストを追加する場合は、次の各号に従ってフィクスチャを設計するものとします。

1. 一つの物理ルールにつき、1ケースとします。
   - 例：祝日種別の追加テスト、連勤上限の境界値テスト等。
   - ケースごとに YAML 及び Pytest を組で追加し、テスト名にルール名を含めます。
2. 期待値は、コメントで明示します。
   - `holiday_requests_2025_02.yaml` 等に、どの ID が採用されるべきかを `# expect off` のようなコメントで残します。
3. プロパティベーステストの候補は、次のとおりとします。
   - 連勤上限：`hypothesis` の `data()` を使って3〜7日のランダムなパターンを生成し、`max_consecutive_working_days` を超えないことを確認します。
   - 祝日上限：曜日フラグをランダムに変えても、`holiday_limits` を超えないことを検証します。
   - 既存例：`tests/test_solver_properties.py` は、週末制約及び連勤上限を Hypothesis で検証しています。当該ファイルは、追加ケースの雛形として利用できます。
4. テンプレートは、次のとおり扱います。
   - `tests/fixtures/templates/` に YAML の断片（スニペット）をまとめ、`tests/utils/fixture_factory.py` の `build_config_from_templates()` で統合（merge）して利用します。
   - 追加したテンプレートは、本書及び[テンプレート側の README](templates/README.md) の両方に記載し、テストコードから1件以上参照しなければなりません。

フィクスチャを追加又は更新するたびに本書を保守し、人及び AI のいずれが読んでも意図を即座に把握できるようにします。

## 4. テンプレートの一覧

| テンプレート | 用途 | 参照するテスト |
| --- | --- | --- |
| `baseline_staff.yaml` | 週末に勤務できない職員を含む混成の構成。週末及び連勤のプロパティベーステストの土台。 | `tests/test_solver_properties.py::test_weekend_ineligible_staff_are_never_assigned_on_weekends` |
| `balanced_fulltime_pool.yaml` | 日勤の公平性だけを観察する常勤 4 名の組。大規模な公平性のプロパティベーステストに利用。 | `tests/test_solver_properties.py::test_day_shift_fairness_scales_with_randomized_horizon` |
