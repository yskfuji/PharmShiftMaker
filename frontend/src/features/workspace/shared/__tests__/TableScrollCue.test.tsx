import { act, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import TableScrollCue, { CUT_TOLERANCE } from "../TableScrollCue";

// jsdom lays nothing out: where each cell's content starts and ends in its table is set here,
// and a Range over the cell's content answers with that box moved by the region's scroll, as
// a browser's does. The observer is a stand-in that reports when the test says the size
// changed. The region's inner left edge is at 0.
let resized: Array<() => void> = [];
let observed: Element[] = [];
let disconnected = 0;
let ends = new Map<Node, number>();
let starts = new Map<Node, number>();
const box = (left: number, right: number) => ({ left, right, top: 0, bottom: 20, width: right > 0 ? 40 : 0, height: 20, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
const scrollOf = (node: Node) => (node instanceof Element ? node.closest<HTMLElement>('[role="region"]')?.scrollLeft ?? 0 : 0);
beforeEach(() => {
  resized = []; observed = []; disconnected = 0; ends = new Map(); starts = new Map();
  globalThis.ResizeObserver = class { constructor(private readonly report: () => void) { resized.push(report); } observe(target: Element) { observed.push(target); } unobserve() { /* not used */ } disconnect() { disconnected += 1; } } as unknown as typeof ResizeObserver;
  Range.prototype.getBoundingClientRect = function content(this: Range) {
    const end = ends.get(this.startContainer) ?? 0;
    return end > 0 ? box((starts.get(this.startContainer) ?? 0) - scrollOf(this.startContainer), end - scrollOf(this.startContainer)) : box(0, 0);
  };
});
afterEach(() => {
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
});

const HEADS = ["職員", "雇用", "適用期間（日本時間）", "原本確認", "制度の根拠", "版"];
function mount({ sequence = false, heads = HEADS, cue: named = {} as Record<string, string> } = {}) {
  const view = render(<section><h3>契約</h3><TableScrollCue sequence={sequence} /><div className="ideal-table-wrap" role="region" aria-label="契約の一覧" tabIndex={0}><table className="ideal-table">
    <thead><tr>{heads.map((head) => <th key={head} scope="col" data-cue={named[head]}>{head}</th>)}</tr></thead>
    <tbody><tr>{heads.map((head, index) => (index === 0 ? <th key={head} scope="row">高橋 葵</th> : <td key={head}>値</td>))}</tr></tbody>
  </table></div></section>);
  const cue = view.container.querySelector<HTMLElement>(".ideal-v3-scroll-cue")!;
  const region = view.getByRole("region", { name: "契約の一覧" });
  return { ...view, cue, region, heads: Array.from(region.querySelectorAll("thead th")), cells: Array.from(region.querySelectorAll("tbody tr > *")) };
}
/** The region is `room` wide; each column's header and cell content end at these offsets. */
const laid = (view: ReturnType<typeof mount>, room: number, headEnds: number[], cellEnds = headEnds) => {
  Object.defineProperty(view.region, "clientWidth", { configurable: true, value: room });
  headEnds.forEach((end, index) => ends.set(view.heads[index], end));
  cellEnds.forEach((end, index) => ends.set(view.cells[index], end));
};
const resize = () => act(() => { for (const report of resized) report(); });
const scrollTo = (region: HTMLElement, left: number) => act(() => { region.scrollLeft = left; region.dispatchEvent(new Event("scroll")); });

test("in the server HTML and while nothing is cut, it is an empty hidden line: nothing is said and nothing is reserved", () => {
  const html = renderToString(<><TableScrollCue /><div className="ideal-table-wrap" role="region" aria-label="表" tabIndex={0} /></>);
  expect(html).toBe('<p class="ideal-v3-scroll-cue" hidden="" aria-hidden="true"></p><div class="ideal-table-wrap" role="region" aria-label="表" tabindex="0"></div>');
  const view = mount();
  laid(view, 1012, [60, 160, 420, 700, 800, 960]);
  resize();
  expect(view.cue.hidden).toBe(true);
  expect(view.cue).toBeEmptyDOMElement();
  // The region and its table are watched, by their place after the cue: no id, no class, no wrapper.
  expect(observed).toEqual([view.region, view.region.querySelector("table")]);
  expect(view.cue.nextElementSibling).toBe(view.region);
  expect(view.region.className).toBe("ideal-table-wrap");
});

test("a table wider than its region only by the empty padding of its last column cuts nothing (契約と適用期間 at 1440)", () => {
  const view = mount();
  // The table is 1030 wide in a region of 1012 (scrollWidth > clientWidth by 18), but the
  // last column's content ends at 977: every value is in view.
  Object.defineProperty(view.region, "scrollWidth", { configurable: true, value: 1030 });
  laid(view, 1012, [60, 160, 520, 780, 900, 955], [70, 170, 700, 790, 880, 977]);
  resize();
  expect(view.cue.hidden).toBe(true);
});

test("the boundary: content that ends within the tolerance past the edge is not cut, one pixel more is", () => {
  const view = mount();
  laid(view, 600, [60, 160, 300, 400, 500, 600 + CUT_TOLERANCE]);
  resize();
  expect(view.cue.hidden).toBe(true);
  laid(view, 600, [60, 160, 300, 400, 500, 600 + CUT_TOLERANCE + 1]);
  resize();
  expect(view.cue.hidden).toBe(false);
  expect(view.cue.textContent).toBe("右に続く列：版横にスクロールできます。");
  // A cell's content counts as much as a header's: the header fits, a value does not.
  laid(view, 600, [60, 160, 300, 400, 500, 560], [60, 160, 300, 400, 610, 560]);
  resize();
  expect(view.cue.textContent).toBe("右に続く列：制度の根拠横にスクロールできます。");
});

test("it names the columns that are cut by their own headers, in a form that stays one short line", () => {
  const view = mount();
  laid(view, 288, [60, 160, 420, 520, 640, 700]);
  resize();
  expect(view.cue.hidden).toBe(false);
  expect(view.cue).not.toHaveClass("is-scrolled");
  // 雇用 ends at 160 and is in view; the four after it are not. Their names together are
  // longer than a line at phone width: the first and the last are named, with their number.
  // A remark in brackets at the end of a header (「（日本時間）」) is not part of its name here.
  expect(view.cue.textContent).toBe("右に続く列：適用期間 〜 版（4列）横にスクロールできます。");
  // Two items: the stylesheet drops the second at phone width, where the line is one line.
  expect(Array.from(view.cue.children).map((part) => part.tagName)).toEqual(["SPAN", "SPAN", "svg"]);
  // A hint for the eye: the region is named and scrollable by keyboard on its own.
  expect(view.cue).toHaveAttribute("aria-hidden", "true");
  expect(view.cue).not.toHaveAttribute("role");
  laid(view, 560, [60, 160, 420, 520, 640, 700]);
  resize();
  expect(view.cue.textContent).toBe("右に続く列：制度の根拠・版横にスクロールできます。");
  laid(view, 430, [60, 160, 420, 520, 640, 700]);
  resize();
  expect(view.cue.textContent).toBe("右に続く列：原本確認・制度の根拠・版横にスクロールできます。");
});

test("short names are all said, so a column of actions at the far end is named", () => {
  const view = mount({ heads: ["職員", "役割", "アカウント", "状態", "操作"] });
  laid(view, 200, [60, 150, 300, 400, 500]);
  resize();
  expect(view.cue.textContent).toBe("右に続く列：アカウント・状態・操作横にスクロールできます。");
});

test("names too long together but short at the ends: the first and the last are said, with their number", () => {
  const view = mount({ heads: ["職員", "役割", "発行者の名前", "アカウントの名前", "状態", "操作"] });
  laid(view, 200, [60, 150, 300, 400, 500, 600]);
  resize();
  expect(view.cue.textContent).toBe("右に続く列：発行者の名前 〜 操作（4列）横にスクロールできます。");
});

test("names too long even at the ends: the first is said and the rest are counted; a header that is only a remark keeps its text", () => {
  const view = mount({ heads: ["職員", "役割", "各月の時間外（週平均50時間超）の合計時間", "最終月に加える時間外", "割り当てられない時間外", "（参考）"] });
  laid(view, 200, [60, 150, 300, 400, 500, 600]);
  resize();
  expect(view.cue.textContent).toBe("右に続く列：各月の時間外（週平均50時間超）の合計時間 ほか3列横にスクロールできます。");
  laid(view, 560, [60, 150, 300, 400, 500, 600]);
  resize();
  expect(view.cue.textContent).toBe("右に続く列：（参考）横にスクロールできます。");
});

test("the first column is the pinned one and is never what lies to the right; a table without headers is only said to run on", () => {
  const view = mount();
  laid(view, 288, [900, 100, 150, 200, 240, 280]);
  resize();
  expect(view.cue.hidden).toBe(true);
  const bare = render(<div><TableScrollCue /><div className="ideal-table-wrap" role="region" aria-label="見出しのない表" tabIndex={0}><table className="ideal-table"><tbody><tr><td>一</td><td>二</td></tr></tbody></table></div></div>);
  const region = bare.getByRole("region", { name: "見出しのない表" });
  Object.defineProperty(region, "clientWidth", { configurable: true, value: 200 });
  ends.set(region.querySelectorAll("td")[1], 400);
  resize();
  expect(bare.container.querySelector(".ideal-v3-scroll-cue")?.textContent).toBe("この表は右に続きます。横にスクロールできます。");
});

test("a table's line is drawn only at the start, where its list is exact: moved, it keeps its place and its words and is not drawn", () => {
  const view = mount();
  laid(view, 288, [60, 160, 420, 520, 640, 700]);
  resize();
  const said = view.cue.textContent;
  expect(view.cue).not.toHaveClass("is-scrolled");
  // Within the tolerance the region has not been moved.
  scrollTo(view.region, CUT_TOLERANCE);
  expect(view.cue).not.toHaveClass("is-scrolled");
  // In the middle 適用期間 is in view: the list that names it is no longer shown.
  scrollTo(view.region, 300);
  expect(view.cue.hidden).toBe(false);
  expect(view.cue).toHaveClass("is-scrolled");
  expect(view.cue.textContent).toBe(said);
  scrollTo(view.region, 412);
  expect(view.cue).toHaveClass("is-scrolled");
  // Back at the start the list is exact again and is drawn.
  scrollTo(view.region, 0);
  expect(view.cue).not.toHaveClass("is-scrolled");
  expect(view.cue.textContent).toBe(said);
  // The region grows (a wider screen, a closed side panel): the line goes away.
  laid(view, 900, [60, 160, 420, 520, 640, 700]);
  resize();
  expect(view.cue.hidden).toBe(true);
  expect(view.cue).toBeEmptyDOMElement();
});

test("consecutive columns (the days of a month) are said from the first one that is cut, by its short name", () => {
  const view = mount({ sequence: true, heads: ["職員・資格", "10/21 水", "10/22 木", "10/23 金", "10/24 土"], cue: { "10/21 水": "21日", "10/22 木": "22日", "10/23 金": "23日", "10/24 土": "24日" } });
  laid(view, 300, [100, 150, 200, 310, 360]);
  resize();
  expect(view.cue.textContent).toBe("23日以降は右に続きます。横にスクロールできます。");
});

/** A month of ten days of 50px after a pinned column of names of 100px, in a region of
 * 300px: each day's content keeps 10px from its cell's edges. */
function month() {
  const days = Array.from({ length: 10 }, (_, index) => index + 1);
  const view = mount({ sequence: true, heads: ["職員・資格", ...days.map((day) => `10/${day}`)], cue: Object.fromEntries(days.map((day) => [`10/${day}`, `${day}日`])) });
  const names = view.heads[0] as HTMLElement;
  names.style.position = "sticky";
  names.getBoundingClientRect = () => ({ ...box(0, 100), width: 100 });
  Object.defineProperty(view.region, "clientWidth", { configurable: true, value: 300 });
  [view.heads, view.cells].forEach((cells) => cells.forEach((cell, index) => {
    if (index === 0) { ends.set(cell, 90); return; }
    starts.set(cell, 100 + (index - 1) * 50 + 10);
    ends.set(cell, 100 + index * 50 - 10);
  }));
  return view;
}

test("the month's line is true of where the region is now: it says the days cut on the left and on the right, and follows every scroll", () => {
  const view = month();
  resize();
  // At the start days 1 to 4 are in view (4 ends at 290 of 300).
  expect(view.cue.textContent).toBe("5日以降は右に続きます。横にスクロールできます。");
  // The owner rests the region in the middle (the month table opens on today): days 4 to 7
  // are in view, 3 is under the names and 8 is past the edge. The line never keeps the day
  // it named at the start.
  scrollTo(view.region, 150);
  expect(view.cue).not.toHaveClass("is-scrolled");
  expect(view.cue.textContent).toBe("3日以前は左に、8日以降は右に続きます。横にスクロールできます。");
  // A day partly under the names is cut: 4 starts at 260 - 170 = 90, before the names end
  // at 100. Day 8 still ends past the edge (490 - 170 = 320 of 300).
  scrollTo(view.region, 170);
  expect(view.cue.textContent).toBe("4日以前は左に、8日以降は右に続きます。横にスクロールできます。");
  // At the end nothing is cut on the right, and the line says where the first days are.
  scrollTo(view.region, 300);
  expect(view.cue.hidden).toBe(false);
  expect(view.cue.textContent).toBe("6日以前は左にあります。横にスクロールできます。");
  scrollTo(view.region, 0);
  expect(view.cue.textContent).toBe("5日以降は右に続きます。横にスクロールできます。");
});

test("a change of size is measured where the region rests, and is still said for that position", () => {
  const view = month();
  resize();
  scrollTo(view.region, 150);
  // The region becomes 100px wider while it rests in the middle: days 4 to 9 are in view.
  Object.defineProperty(view.region, "clientWidth", { configurable: true, value: 400 });
  resize();
  expect(view.cue.textContent).toBe("3日以前は左に、10日以降は右に続きます。横にスクロールできます。");
  // Wide enough for every day at the start: the region cannot rest anywhere else, and there is no line.
  scrollTo(view.region, 0);
  Object.defineProperty(view.region, "clientWidth", { configurable: true, value: 600 });
  resize();
  expect(view.cue.hidden).toBe(true);
});

test("a scroll measures nothing: it compares the position with what was measured", () => {
  const view = month();
  resize();
  const measured = jest.spyOn(Range.prototype, "getBoundingClientRect");
  const boxes = jest.spyOn(Element.prototype, "getBoundingClientRect");
  for (const left of [1, 2, 3, 150, 300]) scrollTo(view.region, left);
  expect(measured).not.toHaveBeenCalled();
  expect(boxes).not.toHaveBeenCalled();
  expect(view.cue.textContent).toBe("6日以前は左にあります。横にスクロールできます。");
  // At the end everything not shown is on the left, and the arrow points there.
  expect(view.cue.querySelector("svg")).toHaveClass("lucide-arrow-left");
  scrollTo(view.region, 150);
  expect(view.cue.querySelector("svg")).toHaveClass("lucide-arrow-right");
  measured.mockRestore(); boxes.mockRestore();
});

test("it measures again once the fonts have loaded", async () => {
  let loaded: () => void = () => undefined;
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: new Promise<void>((resolve) => { loaded = resolve; }) } });
  try {
    const view = mount();
    laid(view, 600, [60, 160, 300, 400, 500, 700]);
    expect(view.cue.hidden).toBe(true);
    await act(async () => { loaded(); await Promise.resolve(); });
    expect(view.cue.hidden).toBe(false);
  } finally {
    delete (document as { fonts?: unknown }).fonts;
  }
});

test("it stops watching when it is taken away, and does nothing where nothing follows it", () => {
  const { unmount, region } = mount();
  const remove = jest.spyOn(region, "removeEventListener");
  unmount();
  expect(disconnected).toBe(1);
  expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
  const alone = render(<div><TableScrollCue /></div>);
  expect(alone.container.querySelector(".ideal-v3-scroll-cue")).toHaveAttribute("hidden");
  expect(observed).toHaveLength(2);
});
