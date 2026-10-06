import { render, screen } from "@testing-library/react";
import Identifiers, { IdentifierList } from "../Identifiers";

test("identifiers are one list of what each is of and the identifier as code, inside a reveal that is closed", () => {
  const { container } = render(<Identifiers items={[{ label: "職員の識別子", value: "p-1" }, { label: "保存物 1", value: "copy-1", note: "（第2版）" }]} />);
  const reveal = screen.getByText("識別情報").closest("details")!;
  expect(reveal).toHaveClass("ideal-v3-disclosure", "ideal-v3-disclosure--info");
  expect(reveal.open).toBe(false);
  expect(reveal.querySelector("dl")).toHaveClass("ideal-definition-list", "ideal-v3-identifiers");
  // A line reads as "label：identifier"; the colon is for a screen reader and for the text.
  expect(Array.from(container.querySelectorAll("dl > div")).map((row) => row.textContent)).toEqual(["職員の識別子：p-1", "保存物 1：copy-1（第2版）"]);
  expect(Array.from(container.querySelectorAll("dt > span")).map((colon) => colon.className)).toEqual(["sr-only", "sr-only"]);
  expect(Array.from(container.querySelectorAll("dd code")).map((code) => code.textContent)).toEqual(["p-1", "copy-1"]);
});

test("several identifiers of one kind follow one another; none is said in words; an owner may name the reveal and add to it", () => {
  const { container } = render(<Identifiers summary="採用した勤務の識別子" items={[{ label: "編集中", values: ["a", "b"] }, { label: "現在", values: [], none: "割当なし" }, { label: "原本", value: null }]}><p>制御記録</p></Identifiers>);
  expect(screen.getByText("採用した勤務の識別子", { selector: "summary" })).toBeInTheDocument();
  expect(Array.from(container.querySelectorAll("dl > div")).map((row) => row.textContent)).toEqual(["編集中：a、b", "現在：割当なし", "原本：（なし）"]);
  expect(container.querySelectorAll("dd code")).toHaveLength(2);
  expect(screen.getByText("制御記録").closest("details")).not.toBeNull();
});

test("with nothing to list nothing is drawn; the list alone can be named", () => {
  const empty = render(<Identifiers items={[]} />);
  expect(empty.container).toBeEmptyDOMElement();
  empty.unmount();
  render(<IdentifierList label="識別子" items={[{ label: "入力", value: "h" }]} />);
  expect(screen.getByLabelText("識別子").tagName).toBe("DL");
});
