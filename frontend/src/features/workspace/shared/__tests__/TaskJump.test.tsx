import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import TaskDisclosure from "../TaskDisclosure";
import TaskJump from "../TaskJump";

const Route = () => <>
  <TaskJump target="task-review">照合を記録する</TaskJump>
  <TaskDisclosure summary="実績を訂正する"><p>訂正の入力欄</p></TaskDisclosure>
  <TaskDisclosure id="task-review" summary="照合内容を記録する" hint="照合した内容を記録します。"><p>照合の入力欄</p></TaskDisclosure>
</>;

beforeEach(() => { Element.prototype.scrollIntoView = jest.fn(); });

test("it opens the task it names, brings its frame into view and puts the focus on its summary", () => {
  render(<Route />);
  const task = screen.getByText("照合内容を記録する", { selector: "summary" }).closest("details")!;
  expect(task.open).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "照合を記録する" }));
  expect(task.open).toBe(true);
  expect(screen.getByText("照合内容を記録する", { selector: "summary" })).toHaveFocus();
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  expect((Element.prototype.scrollIntoView as jest.Mock).mock.contexts[0]).toBe(task.closest(".ideal-v3-task"));
  // The other task is left as it was.
  expect(screen.getByText("実績を訂正する", { selector: "summary" }).closest("details")!.open).toBe(false);
});

test("a target that is not on the route does nothing", () => {
  render(<><TaskJump target="absent">照合を記録する</TaskJump><TaskDisclosure id="task-other" summary="別の操作"><p>内容</p></TaskDisclosure></>);
  fireEvent.click(screen.getByRole("button", { name: "照合を記録する" }));
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  expect(document.querySelector("details")!.open).toBe(false);
});

test("a target that is not a task (a heading, a section) takes the focus itself and comes into view", () => {
  render(<>
    <TaskJump target="result-title">検証結果を見る</TaskJump><TaskJump target="plain-section">節へ</TaskJump>
    <details><summary>外側の開閉欄</summary><h3 id="result-title" tabIndex={-1}>サーバーの検証結果</h3></details>
    <section id="plain-section"><p>フォーカスを受けられると宣言していない節</p></section>
  </>);
  const fold = document.querySelector("details")!;
  fireEvent.click(screen.getByRole("button", { name: "検証結果を見る" }));
  // Every closed disclosure above it is opened; the heading is not turned into anything else.
  expect(fold.open).toBe(true);
  expect(screen.getByRole("heading", { level: 3, name: "サーバーの検証結果" })).toHaveFocus();
  expect((Element.prototype.scrollIntoView as jest.Mock).mock.contexts[0]).toBe(document.getElementById("result-title"));
  // What the view did not make focusable is made so (out of the tab order) when it is gone to.
  const section = document.getElementById("plain-section")!;
  expect(section).not.toHaveAttribute("tabindex");
  fireEvent.click(screen.getByRole("button", { name: "節へ" }));
  expect(section).toHaveFocus();
  expect(section).toHaveAttribute("tabindex", "-1");
  expect((Element.prototype.scrollIntoView as jest.Mock).mock.contexts[1]).toBe(section);
});

test("a task inside a closed disclosure is reached: what is above it is opened too", () => {
  render(<><TaskJump target="task-inner">内側の操作へ</TaskJump><details><summary>外側の開閉欄</summary><TaskDisclosure id="task-inner" summary="内側の操作"><p>内容</p></TaskDisclosure></details></>);
  fireEvent.click(screen.getByRole("button", { name: "内側の操作へ" }));
  expect(Array.from(document.querySelectorAll("details")).map((details) => details.open)).toEqual([true, true]);
  expect(screen.getByText("内側の操作", { selector: "summary" })).toHaveFocus();
});

test("it is a button of the page, never a link, and is absent from the server HTML", () => {
  const html = renderToString(<Route />);
  expect(html).not.toContain("照合を記録する");
  const container = document.createElement("div");
  document.body.append(container);
  container.innerHTML = html;
  expect(container.querySelectorAll("button, a")).toHaveLength(0);
  container.remove();
  act(() => { render(<Route />); });
  const button = screen.getByRole("button", { name: "照合を記録する" });
  expect(button).toHaveAttribute("type", "button");
  expect(button).toHaveClass("ideal-link", "ideal-link--target");
  expect(document.querySelector("a")).toBeNull();
});
