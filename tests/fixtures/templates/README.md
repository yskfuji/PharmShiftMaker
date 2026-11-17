# フィクスチャのテンプレート

本書は、`tests/fixtures/templates/` に置くテンプレートの方針、使い方及び収録内容を定めます。

## 1. 目的

`tests/fixtures/templates/` には、**小規模インスタンスを素早く組み立てるための YAML の断片**（スニペット）を格納します。これまでに追加してきた回帰テスト及びプロパティベーステストから再利用できるよう、次の規則で運用します。

## 2. ディレクトリの方針

- 1ファイルにつき、1つの概念を扱います（例：週末制約を検証する職員の構成、夜勤の組合せ等）。
- ファイル名は `snake_case` とし、拡張子は `.yaml` とします。
- 各 YAML は、`people`、`profiles`、`timeline_entries`、`shift_types`、`holiday_requests` 又は `leave_quotas` のいずれかのキーを持つ部分的な断片です。
- 断片同士は、`tests/utils/fixture_factory.py` の `build_config_from_templates()` で統合（マージ）します。

## 3. 使い方

1. 必要な断片の名前を配列で指定して、`build_config_from_templates(["baseline_staff"], ...)` を呼び出してください。
2. テスト側で、`day_infos` 及び追加の `shift_types` をプログラムで生成して引き渡してください。
3. 生成された `LoadedConfig` を `solve_schedule()` へ渡し、制約を検証してください。

### 3.1 追加時の確認項目

- [ ] YAML の値を、`shift_scheduler.domain` の Enum 名にそろえます（例：`role: PHARMACIST`）。
- [ ] `timeline_entries` の `from` 及び `to` は、ISO 8601 の文字列で記載します。
- [ ] 本書（README）に、用途を1行で追記します。
- [ ] テンプレートを利用するテストを、1つ以上追加し、又は更新します。

## 4. 収録済みテンプレート

| テンプレート | 用途 | 備考 |
| --- | --- | --- |
| `baseline_staff.yaml` | 週末に勤務できない職員、週末に勤務できる職員及び夜勤ができる職員をまとめた最小構成 | プロパティベーステスト及び追加フィクスチャの土台として使用 |
| `balanced_fulltime_pool.yaml` | 公平性の検証に向けた常勤 4 名の組。休日可否及び連勤制限を緩め、日勤の公平性だけを観察する用途 | 日勤の公平性のプロパティベーステスト（`test_day_shift_fairness_scales_with_randomized_horizon`）で使用 |

必要に応じてテンプレートを追加し、[`tests/fixtures/README.md`](../README.md) と併せて保守します。
