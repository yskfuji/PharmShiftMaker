import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { PlanningError } from "@/lib/planningTransport";
import TaskDisclosure, { OnDemandTask, useOnDemand } from "../TaskDisclosure";

function Tasks({ load }: { load: () => Promise<string[]> }) {
  const resource = useOnDemand(load);
  return <>
    <OnDemandTask summary="付与を訂正する" resource={resource}>{(rows) => <p>訂正できる付与 {rows.length}件</p>}</OnDemandTask>
    <OnDemandTask summary="取得を取り消す" resource={resource}>{(rows) => <p>取り消せる記録 {rows.join("・")}</p>}</OnDemandTask>
    <button type="button" onClick={() => void resource.reload()}>保存後に読み直す</button>
  </>;
}
const open = (summary: string) => { const details = screen.getByText(summary).closest("details")!; details.open = true; fireEvent(details, new Event("toggle")); return details; };

test("a task is closed until it is opened, and its content is the owner's", () => {
  render(<TaskDisclosure summary="申告を取り下げる"><label>取り下げる申告<input /></label></TaskDisclosure>);
  const details = screen.getByText("申告を取り下げる").closest("details")!;
  expect(details).toHaveClass("ideal-v3-disclosure");
  expect(details.open).toBe(false);
  expect(screen.getByLabelText("取り下げる申告")).not.toBeVisible();
  // What the task holds is a group named by its summary.
  details.open = true;
  expect(within(screen.getByRole("group", { name: "申告を取り下げる" })).getByLabelText("取り下げる申告")).toBeInTheDocument();
});

test("a control elsewhere on the route can open a task through its ref", () => {
  let details: HTMLDetailsElement | null = null;
  render(<TaskDisclosure summary="契約を登録する" ref={(element) => { details = element; }}><p>契約の内容</p></TaskDisclosure>);
  expect(details).toBe(screen.getByText("契約を登録する").closest("details"));
  details!.open = true;
  expect(screen.getByText("契約の内容")).toBeVisible();
});

test("what only a task needs is read when a task is first opened, once for the tasks that share it", async () => {
  const load = jest.fn(async () => ["g1", "g2"]);
  render(<Tasks load={load} />);
  expect(load).not.toHaveBeenCalled();
  expect(screen.getAllByText("開くと、この操作に必要な記録を読み込みます。")).toHaveLength(2);
  const first = open("付与を訂正する");
  expect(within(first).getByRole("status")).toHaveTextContent("この操作に必要な記録を読み込んでいます。");
  expect(await within(first).findByText("訂正できる付与 2件")).toBeInTheDocument();
  open("取得を取り消す");
  expect(screen.getByText("取り消せる記録 g1・g2")).toBeInTheDocument();
  expect(load).toHaveBeenCalledTimes(1);
  // Read again on demand; what was read stays on screen meanwhile.
  fireEvent.click(screen.getByRole("button", { name: "保存後に読み直す" }));
  expect(screen.getByText("訂正できる付与 2件")).toBeInTheDocument();
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
});

test("a read that fails is the task's own problem and can be tried again", async () => {
  let fail = true;
  const load = jest.fn(async () => { if (fail) throw new PlanningError(403, "Administrator membership required"); return ["g1"]; });
  render(<Tasks load={load} />);
  const details = open("付与を訂正する");
  expect(await within(details).findByRole("alert")).toHaveTextContent("403この画面は表示できません");
  expect(within(details).queryByText(/訂正できる付与/)).toBeNull();
  fail = false;
  fireEvent.click(within(details).getByRole("button", { name: "もう一度読み込む" }));
  expect(await within(details).findByText("訂正できる付与 1件")).toBeInTheDocument();
  expect(within(details).queryByRole("alert")).toBeNull();
});

describe("before React attaches", () => {
  let root: Root | null = null;
  let container: HTMLElement;
  afterEach(() => { act(() => root?.unmount()); root = null; container.remove(); });

  test("the server HTML has the summary and no field; a task opened there stays open, gets its content and reads what it needs", async () => {
    const load = jest.fn(async () => ["g1"]);
    const node = <><TaskDisclosure summary="申告を取り下げる"><label>取り下げる申告<input /></label></TaskDisclosure><Tasks load={load} /></>;
    container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToString(node);
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container).toHaveTextContent("この操作を準備しています。");
    const plain = within(container).getByText("申告を取り下げる").closest("details")!;
    const reading = within(container).getByText("付与を訂正する").closest("details")!;
    plain.open = true; reading.open = true;
    await act(async () => { root = hydrateRoot(container, node); });
    expect(plain.open).toBe(true);
    expect(within(plain).getByLabelText("取り下げる申告")).toBeVisible();
    expect(await within(reading).findByText("訂正できる付与 1件")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
