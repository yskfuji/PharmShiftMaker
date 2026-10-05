import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import RecordEvidenceFields from "../RecordEvidenceFields";
import { EMPTY_RECORD_EVIDENCE, evidenceFacts, type RecordEvidence } from "../records/evidence";

function Owner({ initial = EMPTY_RECORD_EVIDENCE, name, seen }: { initial?: RecordEvidence; name?: string; seen: (value: RecordEvidence) => void }) {
  const [value, setValue] = useState(initial);
  seen(value);
  return <RecordEvidenceFields name={name} value={value} onChange={(patch) => setValue((old) => ({ ...old, ...patch }))} />;
}

test("the evidence of a record: a reference, its state, a verifier once verified, and an optional limit", () => {
  const seen = jest.fn();
  render(<Owner seen={seen} />);
  expect(screen.getByRole("group", { name: "原本確認" })).toBeInTheDocument();
  const reference = screen.getByLabelText("原本確認の資料名・参照先");
  expect(reference).toBeRequired();
  expect(screen.getByLabelText("原本確認の状態")).toHaveValue("unverified");
  expect(screen.queryByLabelText("原本確認の確認責任者")).toBeNull();
  expect(screen.getByLabelText("原本確認の有効期限（任意・日本時間）")).not.toBeRequired();
  fireEvent.change(reference, { target: { value: "配置表 2026-10" } });
  fireEvent.change(screen.getByLabelText("原本確認の状態"), { target: { value: "verified" } });
  const verifier = screen.getByLabelText("原本確認の確認責任者");
  expect(verifier).toBeRequired();
  fireEvent.change(verifier, { target: { value: "薬剤部長" } });
  fireEvent.change(screen.getByLabelText("原本確認の有効期限（任意・日本時間）"), { target: { value: "2027-01-01T00:00" } });
  expect(seen).toHaveBeenLastCalledWith({ reference: "配置表 2026-10", status: "verified", verified_by: "薬剤部長", valid_until: "2026-12-31T15:00:00.000Z" });
});

test("a verifier belongs to verified evidence only; a cleared limit is no limit", () => {
  const seen = jest.fn();
  render(<Owner seen={seen} name="派遣の適用根拠" initial={{ reference: "契約書", status: "verified", verified_by: "人事", valid_until: "2026-12-31T15:00:00.000Z" }} />);
  expect(screen.getByRole("group", { name: "派遣の適用根拠" })).toBeInTheDocument();
  expect(screen.getByLabelText("派遣の適用根拠の確認責任者")).toHaveValue("人事");
  expect(screen.getByLabelText("派遣の適用根拠の有効期限（任意・日本時間）")).toHaveValue("2027-01-01T00:00");
  fireEvent.change(screen.getByLabelText("派遣の適用根拠の状態"), { target: { value: "rejected" } });
  fireEvent.change(screen.getByLabelText("派遣の適用根拠の有効期限（任意・日本時間）"), { target: { value: "" } });
  expect(screen.queryByLabelText("派遣の適用根拠の確認責任者")).toBeNull();
  expect(seen).toHaveBeenLastCalledWith({ reference: "契約書", status: "rejected", verified_by: null, valid_until: null });
});

test("evidence reads as four lines, and says so when a part is missing", () => {
  expect(evidenceFacts("原本確認", { reference: "配置表", status: "verified", verified_by: "薬剤部長", valid_until: "2026-12-31T15:00:00.000Z" })).toEqual([
    { label: "原本確認の資料", text: "配置表" }, { label: "原本確認の状態", text: "確認済み" },
    { label: "原本確認の確認責任者", text: "薬剤部長" }, { label: "原本確認の有効期限", text: "2027-01-01 00:00" },
  ]);
  expect(evidenceFacts("原本確認", EMPTY_RECORD_EVIDENCE).map((fact) => fact.text)).toEqual(["（なし）", "未確認", "（なし）", "期限なし"]);
  expect(evidenceFacts("原本確認", null).map((fact) => fact.text)).toEqual(["（なし）", "（なし）", "（なし）", "期限なし"]);
});
