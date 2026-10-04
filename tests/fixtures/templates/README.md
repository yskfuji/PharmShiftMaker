# Fixture Templates

`tests/fixtures/templates/` には、**小規模インスタンスを素早く組み立てるためのYAMLスニペット**を格納する。Phase3以降で追加してきた回帰テストやproperty-basedテストから再利用できるよう、以下のルールで運用する。

## ディレクトリ方針

- 1ファイル = 1コンセプト（例：週末制約を検証するスタッフ構成、夜勤ペアなど）
- ファイル名は `snake_case`、拡張子は `.yaml`
- 各YAMLは、`people`、`profiles`、`timeline_entries`、`shift_types`、`holiday_requests`、`leave_quotas` のいずれかのキーを持つ部分断片である
- 断片同士は `tests/utils/fixture_factory.py` の `build_config_from_templates()` でマージする

## 使い方フロー

1. 必要なスニペット名を配列で指定して `build_config_from_templates(["baseline_staff"], ...)` を呼び出す
2. テスト側で、`day_infos` や追加の `shift_types` をプログラムで生成して引き渡す
3. 生成された `LoadedConfig` を `solve_schedule()` へ渡し、制約を検証する

### 追加時のチェックリスト

- [ ] YAMLの値は `shift_scheduler.domain` のEnum名にそろえる（例：`role: PHARMACIST`）
- [ ] `timeline_entries` の `from` / `to` はISO8601文字列で記載する
- [ ] README（本ファイル）に用途を1行で追記する
- [ ] テンプレートを利用するテストを1つ以上追加又は更新する

## 収録済みテンプレート

| テンプレート | 用途 | メモ |
| --- | --- | --- |
| `baseline_staff.yaml` | 週末禁止スタッフ、週末対応スタッフ及び夜勤対応スタッフをまとめた最小構成 | property-basedテストや追加フィクスチャの土台として使用 |
| `balanced_fulltime_pool.yaml` | フェアネス検証向けの常勤4名セット。休日可否や連勤制限を緩め、日勤フェアネスだけを観察する用途 | Phase4のday-shift fairness propertyテストで使用 |

必要に応じてテンプレートを増やし、`tests/fixtures/README.md` と併せて保守すること。
