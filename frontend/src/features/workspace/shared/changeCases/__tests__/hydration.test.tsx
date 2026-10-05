import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { ScheduleChangeCase } from "@/ideal/types";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import { syntheticContext } from "../../../showcase/synthetic/context";
import CaseActions from "../CaseActions";
import NewCaseForm from "../NewCaseForm";

// The routes arrive as server HTML. These cases use that HTML before React attaches to it,
// the way a fast person (or a browser journey) does.
const ctx = syntheticContext("LEADER");
const waiting: ScheduleChangeCase = {
  case_id: "c1", scope_id: ctx.scope.scope_id, publication_id: "synthetic-publication-12", kind: "SWAP", status: "AWAITING_CONSENT", version: 2,
  affected_assignments: [], proposed_assignments: [], validation: null, evidence: {}, created_by: "", created_at: "", updated_at: "",
};
const options = { publication_id: "synthetic-publication-12", publication_version: 12, duty_id: "synthetic-duty-2", kind: "ABSENCE", consent_required: false, options: [] };

let root: Root | null = null;
let container: HTMLElement;
afterEach(() => { act(() => root?.unmount()); root = null; container.remove(); });

async function arrive(tree: React.ReactNode, before: () => void = () => undefined) {
  container = document.createElement("div");
  document.body.append(container);
  container.innerHTML = renderToString(tree);
  before();
  const html = container.innerHTML;
  await act(async () => { root = hydrateRoot(container, tree); });
  return html;
}

function live() {
  const paths: string[] = [];
  const client = createIdealClient("test", async <T,>(path: string) => { paths.push(path); return options as T; });
  return { paths, live: liveFrom(ctx, { client, mutate: createMutator("test"), refresh: async () => undefined }) };
}

test("a case's actions are offered only once they can answer", async () => {
  const { live: value } = live();
  const html = await arrive(<LiveProvider live={value}><CaseActions c={waiting} verbs={["consent", "decline"]} /></LiveProvider>);
  // Nothing to press in the server HTML: a press there would be lost.
  expect(html).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "同意する" }));
  expect(screen.getByRole("group", { name: "同意するの根拠" })).toBeInTheDocument();
});

test("a duty chosen and evidence typed before React attached are kept and used", async () => {
  const { paths, live: value } = live();
  const tree = <LiveProvider live={value}><NewCaseForm duties={ctx.publication!.assignments} kinds={["ABSENCE", "SWAP"]} /></LiveProvider>;
  const html = await arrive(tree, () => {
    const form = within(container);
    (form.getByLabelText("勤務") as HTMLSelectElement).value = "synthetic-duty-2";
    (form.getByRole("radio", { name: "交換（相手と入れ替え）" }) as HTMLInputElement).checked = true;
    (form.getByLabelText(/^理由/) as HTMLInputElement).value = "本人から連絡";
  });
  // The form itself is in the server HTML, as it was before.
  expect(html).toContain("申請する");
  // The options are asked for the duty and kind chosen before mounting.
  await waitFor(() => expect(paths).toEqual(["/change-cases/options?scope_id=synthetic%2Fclinical-pharmacy&publication_id=synthetic-publication-12&duty_id=synthetic-duty-2&kind=SWAP"]));
  expect(await screen.findByText("条件に合う候補はありません。")).toBeInTheDocument();
  // Typing the second field renders again: the first is not put back to empty.
  fireEvent.change(screen.getByLabelText(/^参照/), { target: { value: "TEL-1012" } });
  expect(screen.getByLabelText(/^理由/)).toHaveValue("本人から連絡");
  expect(screen.getByLabelText("勤務")).toHaveValue("synthetic-duty-2");
  expect(screen.getByRole("radio", { name: "交換（相手と入れ替え）" })).toBeChecked();
});
