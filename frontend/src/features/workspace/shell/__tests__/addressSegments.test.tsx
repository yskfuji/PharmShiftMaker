// A segment of the address is the visitor's text. "constructor", "toString", "__proto__" and
// "hasOwnProperty" are keys every object answers to: none of them is a screen or a view, so
// each is a 404 like any other unknown address, never an error while looking it up.
import { isValidElement } from "react";
import WorkspaceViewPage, { generateMetadata as viewMetadata } from "@/app/workspace/[screen]/[view]/page";
import WorkspacePage, { generateMetadata as screenMetadata } from "@/app/workspace/[screen]/page";
import type { IdealScreen } from "@/ideal/types";
import { defaultWorkspaceView, isWorkspaceView } from "@/ideal/views";

jest.mock("@/features/workspace/shell/WorkspaceRoutePage", () => ({ __esModule: true, default: () => null }));
jest.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

const INHERITED = ["constructor", "toString", "__proto__", "hasOwnProperty"];
const saved = process.env.IDEAL_UI;
beforeEach(() => { process.env.IDEAL_UI = "1"; });
afterEach(() => { if (saved === undefined) delete process.env.IDEAL_UI; else process.env.IDEAL_UI = saved; });

const screenPage = (screen: string) => WorkspacePage({ params: Promise.resolve({ screen }), searchParams: Promise.resolve({}) });
const viewPage = (screen: string, view: string) => WorkspaceViewPage({ params: Promise.resolve({ screen, view }), searchParams: Promise.resolve({}) });

test("the pages still answer for a screen and a view of the contract", async () => {
  expect(isValidElement(await screenPage("people"))).toBe(true);
  expect(isValidElement(await viewPage("people", "directory"))).toBe(true);
  await expect(screenMetadata({ params: Promise.resolve({ screen: "people" }) })).resolves.toEqual({ title: "職員" });
  expect((await viewMetadata({ params: Promise.resolve({ screen: "people", view: "directory" }) })).title).toMatch(/ · 職員$/);
  await expect(viewPage("people", "no-such-view")).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(viewMetadata({ params: Promise.resolve({ screen: "people", view: "no-such-view" }) })).resolves.toEqual({ title: "見つかりません" });
});

describe.each(INHERITED)("the segment %s", (segment) => {
  test("as a screen: not found, and a title without an error", async () => {
    await expect(screenPage(segment)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(screenMetadata({ params: Promise.resolve({ screen: segment }) })).resolves.toEqual({ title: "見つかりません" });
  });

  test("as a screen with a view: not found, and a title without an error", async () => {
    for (const view of ["x", "directory", segment]) {
      await expect(viewPage(segment, view)).rejects.toThrow("NEXT_NOT_FOUND");
      await expect(viewMetadata({ params: Promise.resolve({ screen: segment, view }) })).resolves.toEqual({ title: "見つかりません" });
    }
  });

  test("as a view of a real screen: not found, and a title without an error", async () => {
    for (const screen of ["people", "schedule", "home"]) {
      await expect(viewPage(screen, segment)).rejects.toThrow("NEXT_NOT_FOUND");
      await expect(viewMetadata({ params: Promise.resolve({ screen, view: segment }) })).resolves.toEqual({ title: "見つかりません" });
    }
  });

  test("the shared lookups answer that it has no views", () => {
    expect(isWorkspaceView(segment as IdealScreen, "x")).toBe(false);
    expect(isWorkspaceView(segment as IdealScreen, segment)).toBe(false);
    expect(defaultWorkspaceView(segment as IdealScreen, "ADMIN")).toBeUndefined();
    expect(isWorkspaceView("people", segment)).toBe(false);
  });
});

test("off: the same segments are not found as well", async () => {
  delete process.env.IDEAL_UI;
  for (const segment of INHERITED) {
    await expect(screenPage(segment)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(viewPage(segment, "x")).rejects.toThrow("NEXT_NOT_FOUND");
  }
});
