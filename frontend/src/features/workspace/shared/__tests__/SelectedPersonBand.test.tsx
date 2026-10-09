import { render, screen, within } from "@testing-library/react";
import { routeOf, type RouteContext } from "../../shell/routeTypes";
import { syntheticContext } from "../../showcase/synthetic/context";
import SelectedPersonBand from "../SelectedPersonBand";

let mockQuery = new URLSearchParams();
jest.mock("next/navigation", () => ({ ...jest.requireActual("next/navigation"), useSearchParams: () => mockQuery }));
afterEach(() => { mockQuery = new URLSearchParams(); });

const band = () => screen.queryByRole("region", { name: "表示を絞っている職員" });
const mount = (over: Partial<RouteContext>, role: "ADMIN" | "PHARMACIST" = "ADMIN") =>
  render(<SelectedPersonBand ctx={{ ...syntheticContext(role), ...over }} route={routeOf("people/lifecycle").route} />);

test("nothing while the URL names nobody, or names the viewer", () => {
  mount({ selectedPersonId: null });
  expect(band()).toBeNull();
  mount({ selectedPersonId: "synthetic-admin" });
  expect(band()).toBeNull();
  // A pharmacist who names themself is looking at their own records, as without a name.
  mount({ selectedPersonId: "synthetic-pharmacist" }, "PHARMACIST");
  expect(band()).toBeNull();
});

test("whom the screen is narrowed to, that the account is unchanged, and the way out, in one callout", () => {
  mockQuery = new URLSearchParams("scope=s1&period=2026-10&person=synthetic-leader");
  mount({ selectedPersonId: "synthetic-leader" });
  const region = band()!;
  expect(region).toHaveClass("ideal-v3-callout");
  expect(Array.from(region.querySelectorAll(":scope > p")).map((p) => p.textContent)).toEqual([
    "表示を絞っている職員：鈴木 悠斗。この画面では、この職員の記録だけを表示し、新しく登録する記録の対象もこの職員になります。",
    "サインイン中のアカウントは 佐藤 美咲（システム管理者） のまま変わっていません。",
    "絞り込みを解除して全員の記録を表示する",
  ]);
  // The name and the account stand out; nothing else does.
  expect(Array.from(region.querySelectorAll("strong")).map((item) => item.textContent)).toEqual(["鈴木 悠斗", "佐藤 美咲（システム管理者）"]);
  // The way out is the same route, with the rest of the context and without the person.
  const link = within(region).getByRole("link", { name: "絞り込みを解除して全員の記録を表示する" });
  expect(link).toHaveAttribute("href", "/workspace/people/lifecycle?scope=s1&period=2026-10");
  expect(link).toHaveClass("ideal-inline-link");
  // Nothing in the band announces itself or is a heading: it is context, not an alert.
  expect(within(region).queryByRole("alert")).toBeNull();
  expect(within(region).queryByRole("heading")).toBeNull();
});

test("a person the context cannot name is named the way the route names them", () => {
  mount({ selectedPersonId: "p-unnamed", names: {} });
  expect(band()).toHaveTextContent("表示を絞っている職員：p-unnamed。");
});
