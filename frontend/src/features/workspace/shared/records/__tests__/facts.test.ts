import { changedFacts, threeWayRows, type Fact } from "../facts";

const a: Fact[] = [{ label: "業務", text: "調剤" }, { label: "人数", text: "1名" }];
const b: Fact[] = [{ label: "業務", text: "調剤" }, { label: "人数", text: "2名" }, { label: "場所", text: "薬剤部" }];

test("the changes are the lines that differ; a record that does not exist yet has none of them", () => {
  expect(changedFacts(a, a)).toEqual([]);
  expect(changedFacts(a, b)).toEqual([{ label: "人数", before: "1名", after: "2名" }, { label: "場所", before: "（なし）", after: "薬剤部" }]);
  expect(changedFacts(null, a)).toEqual([{ label: "業務", before: "（なし）", after: "調剤" }, { label: "人数", before: "（なし）", after: "1名" }]);
});

test("three-way rows follow the edited record's lines", () => {
  expect(threeWayRows(a, null, b)).toEqual([
    { label: "業務", base: "調剤", current: "（なし）", proposed: "調剤" },
    { label: "人数", base: "1名", current: "（なし）", proposed: "2名" },
    { label: "場所", base: "（なし）", current: "（なし）", proposed: "薬剤部" },
  ]);
});

test("a line a person typed stays marked as typed in the changes and in the three-way rows; the others carry no mark", () => {
  const typed: Fact[] = [{ label: "業務", text: "調剤" }, { label: "理由", text: "合成判断 VERIFIED（API）", verbatim: true }];
  expect(changedFacts(null, typed)).toStrictEqual([{ label: "業務", before: "（なし）", after: "調剤" }, { label: "理由", before: "（なし）", after: "合成判断 VERIFIED（API）", verbatim: true }]);
  expect(threeWayRows(typed, null, typed)).toStrictEqual([
    { label: "業務", base: "調剤", current: "（なし）", proposed: "調剤" },
    { label: "理由", base: "合成判断 VERIFIED（API）", current: "（なし）", proposed: "合成判断 VERIFIED（API）", verbatim: true },
  ]);
});
