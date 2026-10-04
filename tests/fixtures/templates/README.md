# Fixture Templates

`tests/fixtures/templates/` には **小規模インスタンスを素早く組み立てるための YAML スニペット** を格納します。Phase3 以降で追加してきた回帰テストや property-based テストから再利用できるよう、以下のルールで運用します。

## ディレクトリ方針

- 1 ファイル = 1 コンセプト（例：週末制約を検証するスタッフ構成、夜勤ペアなど）
- ファイル名は `snake_case`、拡張子は `.yaml`
- 各 YAML は `people`, `profiles`, `timeline_entries`, `shift_types`, `holiday_requests`, `leave_quotas` のいずれかのキーを持つ部分断片です
- 断片同士は `tests/utils/fixture_factory.py` の `build_config_from_templates()` でマージします

## 使い方フロー

1. 必要なスニペット名を配列で指定して `build_config_from_templates(["baseline_staff"], ...)` を呼び出す
2. テスト側で `day_infos` や追加の `shift_types` をプログラム的に生成して引き渡す
3. 生成された `LoadedConfig` を `solve_schedule()` へ投入し、制約を検証する

### 追加時のチェックリスト

- [ ] YAML の値は `shift_scheduler.domain` の Enum 名に揃える（例：`role: PHARMACIST`）
- [ ] `timeline_entries` の `from` / `to` は ISO8601 文字列で記載
- [ ] README（本ファイル）に用途を 1 行で追記
- [ ] テンプレートを利用するテストを 1 つ以上追加 or 更新

## 収録済みテンプレート

| テンプレート | 用途 | メモ |
| --- | --- | --- |
| `baseline_staff.yaml` | 週末禁止スタッフ + 週末対応スタッフ + 夜勤対応スタッフをまとめた最小構成 | property-based テストや追加フィクスチャの土台として使用 |
| `balanced_fulltime_pool.yaml` | フェアネス検証向けの常勤 4 名セット。休日可否や連勤制限を緩め、日勤フェアネスだけを観察する用途 | Phase4 の day-shift fairness property テストで使用 |

必要に応じてテンプレートを増やし、`tests/fixtures/README.md` と併せてメンテナンスしてください。
