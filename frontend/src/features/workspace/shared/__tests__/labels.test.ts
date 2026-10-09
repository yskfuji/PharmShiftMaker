import { CASE_STATUS, caseStatusLabel, CATEGORY, eventLabel, labelOf, UNKNOWN_VALUE } from "../labels";

test("a code is named by its map; one the map does not have is 「未対応の値」, never the code", () => {
  const map = { SUBMITTED: "照合待ち", REVIEWED: "確認済み" };
  expect(labelOf(map, "SUBMITTED")).toBe("照合待ち");
  for (const value of ["RETURNED", "submitted", "", undefined, null, 3, "toString", "constructor"]) expect(labelOf(map, value)).toBe(UNKNOWN_VALUE);
  expect(UNKNOWN_VALUE).toBe("未対応の値");
});

test("the state of a change case is the screens' own label", () => {
  expect(caseStatusLabel("AWAITING_CONSENT")).toBe("同意待ち");
  expect(caseStatusLabel("READY")).toBe("承認待ち");
  for (const status of Object.keys(CASE_STATUS)) expect(caseStatusLabel(status)).toBe(CASE_STATUS[status]);
  // A state added on the server is not shown as a neighbouring one, nor as its code.
  expect(caseStatusLabel("ESCALATED")).toBe(UNKNOWN_VALUE);
});

test("an event is named from its recorded kind; a sentence is shown as it is", () => {
  expect(eventLabel("schedule.published")).toBe("勤務表を公開");
  expect(eventLabel("privacy.erased")).toBe("個人情報を消去");
  // An action this code does not know is what every event is: a record.
  expect(eventLabel("compliance.unheard_of")).toBe("管理記録を記録");
  // The area the server returned changes nothing for a kind that is known.
  expect(eventLabel("schedule.published", "privacy")).toBe("勤務表を公開");
  expect(eventLabel("privacy.erased", "billing")).toBe("個人情報を消去");
  // A notification's own sentence is not renamed to a record of an area.
  expect(eventLabel("公開版が更新されました")).toBe("公開版が更新されました");
  expect(eventLabel("公開版が更新されました", "schedule")).toBe("公開版が更新されました");
  // A property of every object is not a kind's own wording, a first part or an action.
  expect(eventLabel("constructor.toString")).toBe(UNKNOWN_VALUE);
  expect(eventLabel("privacy.constructor")).toBe("個人情報を記録");
});

test("a kind whose first part is not known here is named by the area the server returned, and only when that is unknown too is it 「未対応の値」", () => {
  expect(eventLabel("billing.created", "compliance")).toBe("管理記録");
  expect(eventLabel("billing.created", "other")).toBe("その他");
  // Never as a record of a neighbouring area, and never as the code.
  for (const category of [undefined, null, "", "billing", "COMPLIANCE", 7, "toString"]) expect(eventLabel("billing.created", category)).toBe(UNKNOWN_VALUE);
  // What is not a kind at all (a code in capitals, nothing, a number) is named the same way.
  for (const kind of ["PUBLISHED", "published", "", "   ", undefined, null, 7]) {
    expect(eventLabel(kind)).toBe(UNKNOWN_VALUE);
    expect(eventLabel(kind, "schedule")).toBe("計画・公開");
  }
});

test("every first part the server sorts into an area has its own word, and every area has a name", () => {
  // The server's table (prefix, area) as application/audit_timeline.py has it. That this
  // list and the maps of labels.ts are the server's is checked where the server's source is
  // (tests/test_workspace_v3_labels.py); this suite runs in a frontend-only checkout too.
  const pairs = [["change", "change"], ["membership", "membership"], ["lifecycle", "lifecycle"], ["schedule", "schedule"], ["draft", "schedule"], ["job", "schedule"], ["input", "schedule"], ["candidates", "schedule"],
    ["request", "request"], ["leave", "request"], ["compliance", "compliance"], ["actual", "compliance"], ["privacy", "privacy"], ["copy", "privacy"], ["erasure", "privacy"], ["retention", "privacy"]];
  for (const [prefix, area] of pairs) {
    expect(Object.hasOwn(CATEGORY, area)).toBe(true);
    const named = eventLabel(`${prefix}.unheard_of`);
    expect(named).toMatch(/を記録$/);
    // A part with its own word is not said as its area, except where the two are one.
    if (prefix !== area) expect(named).not.toBe(`${CATEGORY[area]}を記録`);
  }
  expect(Object.fromEntries(["draft.create", "job.enqueue", "input.register", "candidates.derived", "leave.request", "actual.corrected", "copy.erased", "erasure.executed", "retention.rule"].map((kind) => [kind, eventLabel(kind)]))).toEqual({
    "draft.create": "勤務案を記録", "job.enqueue": "候補生成の処理を記録", "input.register": "勤務入力を記録", "candidates.derived": "勤務候補を記録", "leave.request": "休暇を記録",
    "actual.corrected": "勤務実績を訂正", "copy.erased": "コピーを消去", "erasure.executed": "消去を記録", "retention.rule": "保存規則を記録",
  });
  // "other" is the server's own name for what it sorts nowhere.
  expect(Object.keys(CATEGORY).sort()).toEqual([...Array.from(new Set(pairs.map(([, area]) => area))), "other"].sort());
  expect(labelOf(CATEGORY, "schedule")).toBe("計画・公開");
  expect(labelOf(CATEGORY, "billing")).toBe(UNKNOWN_VALUE);
  // The lifecycle kinds as the server emits them (three parts), each with its own wording.
  expect(["lifecycle.onboard.created", "lifecycle.offboard.created", "lifecycle.task.completed"].map((kind) => eventLabel(kind))).toEqual(["入職の手続きを開始", "退職の手続きを開始", "入退職タスクを完了"]);
});
