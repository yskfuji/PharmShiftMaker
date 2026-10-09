import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import SectionNav from "../SectionNav";
import TaskJump from "../TaskJump";

const ITEMS = [
  { target: "section-current", label: "現在の状態", meta: "職員3名・契約2件" },
  { target: "section-folded", label: "施設の記録" },
  { target: "section-absent", label: "この画面にない節" },
];
const Route = () => <>
  <TaskJump target="section-folded">施設の記録へ</TaskJump>
  <SectionNav items={ITEMS} />
  <section><h2 id="section-current" tabIndex={-1}>現在の状態</h2></section>
  <details><summary>外側の開閉欄</summary>
    <details><summary>内側の開閉欄</summary><h3 id="section-folded" tabIndex={-1}>施設の記録</h3></details>
  </details>
  <details><summary>別の開閉欄</summary><p>関係のない内容</p></details>
</>;

beforeEach(() => { Element.prototype.scrollIntoView = jest.fn(); });

test("a button puts the focus on the heading it names and brings it into view", () => {
  render(<Route />);
  const nav = within(screen.getByRole("navigation", { name: "この画面の内容" }));
  expect(nav.getAllByRole("button").map((button) => button.textContent)).toEqual(["現在の状態 職員3名・契約2件", "施設の記録", "この画面にない節"]);
  fireEvent.click(nav.getByRole("button", { name: "現在の状態 職員3名・契約2件" }));
  const heading = screen.getByRole("heading", { level: 2, name: "現在の状態" });
  expect(heading).toHaveFocus();
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  expect((Element.prototype.scrollIntoView as jest.Mock).mock.contexts[0]).toBe(heading);
});

test("it opens every closed disclosure the heading is inside, and no other", () => {
  render(<Route />);
  const [outer, inner, other] = Array.from(document.querySelectorAll("details"));
  expect([outer.open, inner.open, other.open]).toEqual([false, false, false]);
  fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "施設の記録" }));
  expect([outer.open, inner.open, other.open]).toEqual([true, true, false]);
  expect(document.getElementById("section-folded")).toHaveFocus();
});

test("a heading that is not on the route does nothing", () => {
  render(<Route />);
  fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "この画面にない節" }));
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  expect(Array.from(document.querySelectorAll("details")).map((details) => details.open)).toEqual([false, false, false]);
});

test("the buttons are in the server HTML and disabled there; they are buttons of the page, never links", () => {
  const container = document.createElement("div");
  document.body.append(container);
  container.innerHTML = renderToString(<Route />);
  const served = Array.from(container.querySelectorAll("nav button")) as HTMLButtonElement[];
  expect(served.map((button) => button.textContent)).toEqual(["現在の状態 職員3名・契約2件", "施設の記録", "この画面にない節"]);
  expect(served.every((button) => button.disabled)).toBe(true);
  // The single button beside a badge is not in the server HTML at all.
  expect(container.textContent).not.toContain("施設の記録へ");
  expect(container.querySelectorAll("a")).toHaveLength(0);
  container.remove();
  render(<Route />);
  for (const button of within(screen.getByRole("navigation")).getAllByRole("button")) { expect(button).toBeEnabled(); expect(button).toHaveAttribute("type", "button"); }
  expect(document.querySelector("a")).toBeNull();
});

test("the single button beside a badge (TaskJump) goes to its section in the same way", () => {
  render(<Route />);
  const jump = screen.getByRole("button", { name: "施設の記録へ" });
  expect(jump).toHaveClass("ideal-link", "ideal-link--target");
  fireEvent.click(jump);
  expect(document.getElementById("section-folded")).toHaveFocus();
  expect(Array.from(document.querySelectorAll("details")).map((details) => details.open)).toEqual([true, true, false]);
});

test("the row can be named for what it leads to", () => {
  render(<SectionNav label="契約・資格の内容" items={ITEMS.slice(0, 1)} />);
  expect(screen.getByRole("navigation", { name: "契約・資格の内容" })).toBeInTheDocument();
});
