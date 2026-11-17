"""Export physical keys from SQLAlchemy; conceptual JSON references stay separate."""

import json
from pathlib import Path

from shift_scheduler.db import models  # noqa: F401
from shift_scheduler.db.base import Base
from shift_scheduler.domain.planning import content_hash


def main():
    target = Path("audit/completion-2026-09-22")
    target.mkdir(exist_ok=True)
    metadata = {}
    for table in Base.metadata.sorted_tables:
        metadata[table.name] = {
            "columns": [
                {
                    "name": c.name,
                    "type": str(c.type),
                    "nullable": c.nullable,
                    "primary": c.primary_key,
                }
                for c in table.columns
            ],
            "foreign_keys": sorted(
                [
                    {"column": fk.parent.name, "target": fk.target_fullname}
                    for fk in table.foreign_keys
                ],
                key=lambda f: f["column"],
            ),
        }
    (target / "physical-schema.json").write_text(
        json.dumps(
            {"schema_hash": content_hash(metadata), "tables": metadata},
            ensure_ascii=False,
            indent=2,
        )
    )

    def er(names, before=False):
        lines = ["erDiagram"]
        for name in names:
            lines.append("    " + name + " {")
            for c in metadata[name]["columns"]:
                if (
                    before
                    and name == "planning_jobs"
                    and c["name"] in {"claimed_at", "completed_at", "stage_seconds"}
                ):
                    continue
                kind = "json" if c["type"] == "JSON" else "value"
                flag = (
                    " PK"
                    if c["primary"]
                    else (
                        " FK"
                        if any(
                            f["column"] == c["name"]
                            for f in metadata[name]["foreign_keys"]
                        )
                        else ""
                    )
                )
                lines.append("        " + kind + " " + c["name"] + flag)
            lines.append("    }")
        for name in names:
            for fk in metadata[name]["foreign_keys"]:
                parent = fk["target"].split(".")[0]
                if parent in names:
                    nullable = next(
                        c["nullable"]
                        for c in metadata[name]["columns"]
                        if c["name"] == fk["column"]
                    )
                    cardinality = "|o" if nullable else "||"
                    lines.append(
                        f'    {parent} {cardinality}--o{{ {name} : "FK {fk["column"]}"'
                    )
        return "\n".join(lines) + "\n"

    before = [
        n
        for n in metadata
        if n
        not in {
            "compliance_entities",
            "compliance_revisions",
            "retention_rules",
            "legal_holds",
            "privacy_cases",
            "erasure_plans",
            "erasure_markers",
            "restore_gates",
        }
    ]
    (target / "physical-before.mmd").write_text(er(before, before=True))
    (target / "physical-after.mmd").write_text(er(list(metadata)))
    (target / "architecture.md").write_text("""# 構造・処理・状態の対応

物理ERは `physical-schema.json` の主キー・外部キーから生成。`physical-before.mmd` は追加8表とjobの追加3列を除いた比較図であり、旧版を逆変換したDBではない。旧版DBの実検査を代替しない。外部キーのnullableを図示し、JSON内の関連はDB外部キーと区別した。複合unique等の全制約はER図だけでは表さない。

## 画面・API・正本
```mermaid
flowchart LR
 UI[月間勤務表・契約・休暇・本人対応] --> AUTH[OIDC／所属権限・CSRF]
 AUTH --> API[planning／compliance API]
 API --> CAS[版番号・冪等キー・施設ロック]
 CAS --> PG[(PostgreSQL)]
 PG --> W[永続job・lease・worker 1個]
 W --> CP[CP-SAT 辞書式最適化]
 CP --> IV[独立検証器]
 IV --> D[検証済み下書き保存]
 D --> PG
 API --> IV
 PG --> OB[監査・通知outbox]
```

## 概念参照（物理外部キーと区別）
```mermaid
flowchart LR
 P[不変職員ID] -. JSON参照 .-> E[雇用改定・契約順]
 E -. 改定ID .-> T[所定内外の勤務区分]
 T -. duty ID .-> S[不変入力v2]
 A[雇用主別協定] -. 規則ID .-> S
 L[付与・休暇イベント] -. 原イベントID .-> S
 S -. 入力ハッシュ .-> V[公開版JSON]
 R[保存規則・保全] -. 対象照合 .-> X[消去計画]
 X -. 消去前ハッシュ .-> M[消去証跡]
 M -. 独立署名manifest .-> B[隔離復元gate]
```

## 公開
```mermaid
stateDiagram-v2
 [*] --> 入力固定
 入力固定 --> 生成待ち
 生成待ち --> 計算中: lease取得
 計算中 --> 未確定: UNKNOWN／中断／不能
 計算中 --> 下書き: 独立検証通過
 下書き --> 下書き: 手編集・版更新・確認解除
 下書き --> 確認済み: 同じ入力・案の検証
 確認済み --> 下書き: 入力変更で無効
 確認済み --> 公開: 再検証＋版CAS＋同一transaction
 公開 --> 取消: 理由・版・休暇台帳照合
 公開 --> 下書き: 新たな入力・改版
```

## 年休（イベントは削除せず補償）
```mermaid
stateDiagram-v2
 [*] --> 付与: 外部人事の根拠照合
 付与 --> 予約: 残高・単位・適用規則照合
 予約 --> 取得: 実績確認
 予約 --> 解放: 取消イベント
 取得 --> 訂正: reverseイベント
 付与 --> 失効: 期限経過・未予約を照合
 付与 --> 換算: 改定前後の規則・切上げ式を記録
```

## 消去・復元
```mermaid
stateDiagram-v2
 [*] --> プレビュー
 プレビュー --> 保全: 期限前／現行参照／hold
 プレビュー --> 実行済み: 権限・fingerprint・実行時再照合
 実行済み --> 証跡: 対象識別子・消去前ハッシュ
 [*] --> 復元隔離
 復元隔離 --> 復元隔離: 署名不正／最新版hash不一致
 復元隔離 --> 再適用済み: 最新消去・利用停止manifestを再生
```

## コード・試験

|対象|実装|反例試験|
|---|---|---|
|兼業配分|validation/work_accounting.py|test_compliance_v2.py（契約順・日週二重・管理モデル）|
|年休|validation/leave_accounting.py、application/compliance.py|test_compliance_v2.py（半日／時間・予約・取消・換算）|
|CAS・本人範囲|api/routers/compliance.py|test_compliance_api.py|
|公開・取消|application/planning.py|test_compliance_v2.py、test_planning_postgres.py|
|削除・復元|application/privacy.py、ops/erasure_replay.py|test_privacy_workflow.py|
|画面|CompliancePanel、SchemaFields、MonthlySchedule|tests/completion-e2e/evaluation.spec.ts|

有限の試験ケースに対応する図であり、アプリ全体の形式証明ではない。
""")


if __name__ == "__main__":
    main()
