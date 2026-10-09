import { fireEvent, render, screen } from "@testing-library/react";
import WorkspaceError from "@/app/workspace/error";
import WorkspaceNotFound, { metadata } from "@/app/workspace/not-found";

jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("scope=hospital%2Fpharmacy&period=2026-01&publication=pub-1") }));

const before = process.env.IDEAL_UI;
afterEach(() => { process.env.IDEAL_UI = before; });

const links = () => screen.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")]);
const classes = (root: HTMLElement) => Array.from(root.querySelectorAll("[class]")).flatMap((node) => Array.from(node.classList));

test("on: an unknown workspace address is answered in the workspace's own frame, with one way on", () => {
  process.env.IDEAL_UI = "1";
  const shown = render(<WorkspaceNotFound />);
  expect(screen.getAllByRole("heading", { level: 1 }).map((item) => item.textContent)).toEqual(["ページが見つかりません"]);
  expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  // The entry of the workspace, with the scope and period of the address that was asked for.
  expect(links()).toEqual([["今日へ", "/workspace/home?scope=hospital%2Fpharmacy&period=2026-01&publication=pub-1"]]);
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(classes(shown.container).filter((name) => !name.startsWith("ideal-"))).toEqual([]);
  expect(metadata).toEqual({ title: "ページが見つかりません", robots: { index: false, follow: false } });
});

test.each([undefined, "0", "true"])("off (IDEAL_UI=%s): the workspace does not exist, and the page leads only to the site's entry", (value) => {
  if (value === undefined) delete process.env.IDEAL_UI; else process.env.IDEAL_UI = value;
  render(<WorkspaceNotFound />);
  expect(screen.getAllByRole("heading", { level: 1 }).map((item) => item.textContent)).toEqual(["ページが見つかりません"]);
  expect(links()).toEqual([["トップページへ", "/"]]);
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(document.body.innerHTML).not.toMatch(/\/workspace|\/planning|\/dashboard|\/settings|\/requests|\/schedule/);
});

test("a failed route: the digest but never the message, a retry and the way to the site's entry", () => {
  const reset = jest.fn();
  const shown = render(<WorkspaceError error={Object.assign(new Error("internal detail: table x"), { digest: "digest-42" })} reset={reset} />);
  expect(screen.getAllByRole("heading", { level: 1 }).map((item) => item.textContent)).toEqual(["画面を表示できませんでした"]);
  expect(screen.getByRole("alert")).toHaveTextContent("予期しない問題が起きました。");
  expect(shown.container).toHaveTextContent("問い合わせ番号：digest-42");
  expect(shown.container).not.toHaveTextContent("internal detail");
  fireEvent.click(screen.getByRole("button", { name: "もう一度試す" }));
  expect(reset).toHaveBeenCalledTimes(1);
  // The boundary cannot know whether the workspace exists: it names the site's entry only.
  expect(links()).toEqual([["トップページへ", "/"]]);
  expect(shown.container.innerHTML).not.toMatch(/\/workspace|\/planning|\/dashboard|\/settings|\/requests|\/schedule|今日へ/);
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(classes(shown.container).filter((name) => !name.startsWith("ideal-"))).toEqual([]);
});

test("an error without a digest shows no empty reference", () => {
  const shown = render(<WorkspaceError error={new Error("x")} reset={() => undefined} />);
  expect(shown.container).not.toHaveTextContent("問い合わせ番号");
});

test.each(["1", undefined])("the error page is the same whether the workspace is on or off (IDEAL_UI=%s)", (value) => {
  if (value === undefined) delete process.env.IDEAL_UI; else process.env.IDEAL_UI = value;
  render(<WorkspaceError error={Object.assign(new Error("x"), { digest: "d-1" })} reset={() => undefined} />);
  expect(links()).toEqual([["トップページへ", "/"]]);
  expect(screen.getByRole("button", { name: "もう一度試す" })).toBeInTheDocument();
});
