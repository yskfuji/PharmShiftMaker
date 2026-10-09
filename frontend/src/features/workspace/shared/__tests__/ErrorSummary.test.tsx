import { fireEvent, render, screen, within } from "@testing-library/react";
import ErrorSummary, { type SummaryIssue } from "../ErrorSummary";

const issues: SummaryIssue[] = [{ message: "起算日を確認してください。", fieldId: "anchor" }, { message: "サーバーが受け付けませんでした。" }];

test("the heading takes focus when the summary appears, and again for each attempt", () => {
  const view = render(<><ErrorSummary title="入力内容に誤りがあります" issues={issues} attempt={1} /><input id="anchor" aria-label="起算日" /></>);
  const heading = screen.getByRole("heading", { level: 4, name: "入力内容に誤りがあります（2件）" });
  expect(heading).toHaveFocus();
  expect(heading).toHaveAttribute("tabindex", "-1");
  screen.getByLabelText("起算日").focus();
  // The same issues after another attempt: the summary is read first again.
  view.rerender(<><ErrorSummary title="入力内容に誤りがあります" issues={issues} attempt={2} /><input id="anchor" aria-label="起算日" /></>);
  expect(heading).toHaveFocus();
  // A new render of the same attempt leaves focus where the person put it.
  screen.getByLabelText("起算日").focus();
  view.rerender(<><ErrorSummary title="入力内容に誤りがあります" issues={issues} attempt={2} /><input id="anchor" aria-label="起算日" /></>);
  expect(screen.getByLabelText("起算日")).toHaveFocus();
});

test("an issue that names a field moves focus to it; one that names none is text; nothing is an alert", () => {
  render(<><ErrorSummary title="サーバーが登録を受け付けませんでした" issues={issues} level={3} /><input id="anchor" aria-label="起算日" /></>);
  const region = screen.getByRole("region", { name: "サーバーが登録を受け付けませんでした（2件）" });
  expect(within(region).getByRole("heading", { level: 3 })).toBeInTheDocument();
  expect(within(region).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["起算日を確認してください。", "サーバーが受け付けませんでした。"]);
  expect(within(region).getAllByRole("button")).toHaveLength(1);
  fireEvent.click(within(region).getByRole("button", { name: "起算日を確認してください。" }));
  expect(screen.getByLabelText("起算日")).toHaveFocus();
  expect(screen.queryByRole("alert")).toBeNull();
});
