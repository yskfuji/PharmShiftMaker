import { recordRisk, RECORD_SAVE_NOTICE } from "../notices";
import { stagedRecords } from "../staged";

type Rule = { rule_id: string; hours: number };
const row = (entity_id: string, revision: number, payload: Rule, kind = "rule") => ({ kind, entity_id, revision, payload });

test("a staged value carries the revision of its saved record, whose content wins; a value only the input holds has none", () => {
  const staged: Rule[] = [{ rule_id: "r1", hours: 8 }, { rule_id: "r2", hours: 6 }];
  const rows = [row("r1", 3, { rule_id: "r1", hours: 7 }), row("r3", 1, { rule_id: "r3", hours: 4 }), row("r2", 9, { rule_id: "r2", hours: 1 }, "another kind")];
  expect(stagedRecords(staged, rows, "rule", (rule) => rule.rule_id)).toEqual([
    { key: "r1", revision: 3, payload: { rule_id: "r1", hours: 7 } },
    { key: "r2", revision: 0, payload: { rule_id: "r2", hours: 6 } },
    // A saved record the input does not stage is listed after the staged ones.
    { key: "r3", revision: 1, payload: { rule_id: "r3", hours: 4 } },
  ]);
  expect(stagedRecords<Rule>(undefined, [], "rule", (rule) => rule.rule_id)).toEqual([]);
});

test("the confirmation of a record's save says that nobody is notified and what the server checks", () => {
  expect(RECORD_SAVE_NOTICE).toBe("誰にも通知されません。保存の記録（操作した役割・版・時刻）は監査の履歴に残ります。");
  expect(recordRisk("契約")(0)).toContain("この契約がまだ登録されていないことを照合します。");
  expect(recordRisk("契約")(4)).toContain("この契約が第4版のままであることを照合します。違っていれば保存せず、競合として知らせます。");
});
