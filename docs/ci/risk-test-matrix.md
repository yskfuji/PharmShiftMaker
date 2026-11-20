# 重要な処理のリスクとテストの対応表

本書は、PharmShiftMaker の重要な処理について、想定するリスクと、それを検出する専用のテストとの対応を定めるものです。カバレッジの数値だけでは、重要な処理が検証されているかを判断できないため、本表で補います。

## 1. 運用の規則

1. 本表の各行には、リポジトリに実在するテストを1件以上記載します。`python -m devtools.ci.risk_matrix` が、記載したテストの実在を CI で検査します（`tests/test_ci_risk_matrix.py`）。
2. 本表のテストは、PR ごとの必須の CI（Backend lint & tests）で実行します。定期実行だけに移してはなりません。
3. 重要な処理を追加・変更する PR では、本表に行を加えるか、既存の行のテストを更新します。

## 2. 対応表

| ID | 区分 | 想定するリスク | テスト |
|---|---|---|---|
| R-01 | 認証 | 操作がないまま放置された画面のセッションが使われ続ける | `tests/test_session_idle.py::test_a_browser_token_ends_after_the_idle_limit` |
| R-02 | 認証 | サインアウトしたトークンが再利用される | `tests/test_session_idle.py::test_sign_out_revokes_an_idle_expired_token` |
| R-03 | 認証 | 不正な Origin、壊れた認可ヘッダー、サインアウト後の再送が受け付けられる | `tests/test_reviewed_security.py::test_cookie_origin_garbage_authorization_and_logout_replay` |
| R-04 | 認証 | OIDC の利用者が、旧来の所属の射影で別人として扱われる | `tests/test_auth_me.py::test_oidc_account_identity_is_not_legacy_membership_projection` |
| R-05 | 認可 | 役割・所属範囲・本人の境界を越えて操作できる | `tests/test_ideal_workflows_api.py::test_role_scope_and_subject_boundaries` |
| R-06 | 認可 | 個人情報の一覧が、所属範囲や本人の範囲を越えて見える | `tests/test_compliance_v3_api.py::test_privacy_roster_is_exact_scope_and_self_limited` |
| R-07 | 消去 | 依存関係の順序や取消しを誤り、消去が不完全になる、又は復元後に戻る | `tests/test_database_erasure_postgres.py::test_dependency_order_transaction_and_restore_reapplication` |
| R-08 | 消去 | 確認していない子レコードや法的保全があるのに削除してしまう | `tests/test_database_erasure_postgres.py::test_unreviewed_child_and_late_hold_prevent_deletion` |
| R-09 | 消去 | 消去がリンクをたどり、対象外のファイルを消す | `tests/test_archive_attacks.py::test_erasure_does_not_follow_links` |
| R-10 | 復元の隔離 | 復元したデータに、隔離を解く前にアクセスできる | `tests/test_restore_isolation_postgres.py::test_quarantine_blocks_even_after_exclusive_lock_released` |
| R-11 | 復元の隔離 | 復元中のスキーマに、アプリから書き込める | `tests/test_restore_isolation_postgres.py::test_restore_lock_excludes_application_before_restored_schema` |
| R-12 | 監査 | 監査イベントの再送で、別の ID が付いて二重に記録される | `tests/test_planning_lifecycle.py::test_outbox_failure_replays_identical_event_id` |
| R-13 | 監査 | 旧来の監査ファイルや標準出力に、個人情報が書き出される | `tests/test_legacy_storage_boundary.py::test_legacy_audit_file_and_stdout_are_blocked_before_any_personal_bytes` |
| R-14 | マイグレーション | 空のデータベースから最新のスキーマまで移行できない（フィクスチャで Alembic の head まで適用） | `tests/test_planning_postgres.py::test_concurrent_publication_has_one_winner` |
| R-15 | マイグレーション | モデルと移行後のスキーマの既定値が食い違う | `tests/test_remediation_schema.py::test_non_json_server_default_uses_alembic_native_comparison` |
| R-16 | CI | 外部 Action の固定漏れ、時間の上限の欠落、危険なトリガーの混入 | `tests/test_ci_workflow_policy.py::test_repository_workflows_comply` |
