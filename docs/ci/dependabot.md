# Dependabot の更新の取り込み手順

本書は、Dependabot が作成した依存関係の更新を、PharmShiftMaker に取り込む手順を定めるものです。

## 1. 前提

1. Dependabot は、依存関係の宣言とロックファイルだけを変更します。SBOM（`docs/release/SBOM.cdx.json`）と第三者ライセンスのマニフェスト（`docs/release/THIRD_PARTY_LICENSES/`）は作り直しません。そのため、Dependabot の PR は、そのままでは CI の Backend で「SBOM is stale」となり失敗します。
2. この作り直しを、強い権限を持つワークフロー（`pull_request_target` での自動 push）で行うことはしません。信頼できない変更に、書き込みの権限を与えることになるためです。
3. マイナーとパッチの更新は、エコシステムごとに1件の PR にまとめて届きます。公開から7日を経過した版だけが提案されます（`.github/dependabot.yml`）。

## 2. 手順

1. Dependabot の PR を、手元の作業ブランチに取り込みます（複数ある場合は cherry-pick でまとめます）。
2. Python の依存を更新した場合は、`requirements.lock` から uv で Python 3.12.15 の環境を作り、次を実行します。
   - `python -m scripts.lock_verified_dependencies`（`pyproject.toml` だけが変わった場合）
3. 次の生成器で、SBOM と第三者ライセンスのマニフェストを作り直します。
   - `PYTHONPATH=src:. python -m devtools.release.generate_sbom --write`
   - `PYTHONPATH=src:. python -m devtools.release.collect_licenses --write`（npm の依存は `frontend` で `npm ci` を実行した後に作ります）
4. `tests/test_public_tree_policy.py` を実行し、SBOM とライセンスの一式が最新であることを確かめます。
5. 公開用ツリーのマニフェストを、別のコミットで作り直します（`python -m devtools.release.public_tree <リポジトリ外の新しいディレクトリ>`）。
6. PR を作り、必須チェックがすべて成功してからマージします。取り込んだ Dependabot の PR は、取り込み先の PR を示すコメントを付けて閉じます。

## 3. 確認すること

1. 本番の依存の監査（`npm audit --omit=dev --audit-level=moderate`、`pip-audit`）で、新しい指摘がないこと。
2. メジャー更新では、更新元のリリースノートで破壊的な変更を確認し、影響の有無を PR に記載すること。
