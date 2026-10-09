"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** A column as it lies in its region when the region has not been scrolled: the name of its
 * header, and where what it holds starts and ends (from the region's left inner edge). */
type Column = { name: string; start: number; end: number };
/** The region as measured: its columns after the first, how wide its view is, and how much
 * of that view the first column keeps while the others scroll under it (0: not pinned). */
type Layout = { columns: Column[]; room: number; pinned: number };
/** What the line says, and whether it is drawn. */
/** `back`: everything not shown is on the left, so the arrow points there. */
type Line = { text: string; away: boolean; back?: boolean };

/** How far past the region's edge content must reach to count as cut. A table that is a few
 * pixels wider than its region only by the empty padding of its last column cuts nothing. */
export const CUT_TOLERANCE = 4;
/** How long the names in the line may be together, in full-width characters: with the
 * words before them that is one line of small print at phone width (about twenty). */
const NAMES_ROOM = 14;
const NOTHING: Line = { text: "", away: false };

/** Where what a cell holds lies on screen: the box of its content, not of the cell (a short
 * value in a wide column ends well before the cell does). Nothing drawn (an empty cell, a
 * table inside a closed reveal) lies nowhere. */
function contentBox(cell: Element): DOMRect | null {
  const range = cell.ownerDocument.createRange();
  range.selectNodeContents(cell);
  const box = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : cell.getBoundingClientRect();
  return box.width > 0 ? box : null;
}

/** Measures the region as if it had not been scrolled (what is on screen, brought back by
 * the region's scroll). The first column is left out: it is the one that is pinned while
 * the others scroll, so it is never what lies to either side. */
function layoutOf(region: HTMLElement): Layout {
  const table = region.querySelector("table");
  const none: Layout = { columns: [], room: region.clientWidth, pinned: 0 };
  if (!table) return none;
  const origin = region.getBoundingClientRect().left + region.clientLeft - region.scrollLeft;
  const heads = table.tHead?.rows[table.tHead.rows.length - 1]?.cells;
  const spans: Array<{ start: number; end: number }> = [];
  const take = (cell: HTMLTableCellElement) => {
    if (cell.cellIndex === 0 || cell.colSpan > 1) return;
    const box = contentBox(cell);
    if (!box) return;
    const known = spans[cell.cellIndex];
    spans[cell.cellIndex] = { start: Math.min(known?.start ?? Infinity, box.left - origin), end: Math.max(known?.end ?? 0, box.right - origin) };
  };
  Array.from(heads ?? []).forEach(take);
  for (const row of Array.from(table.rows)) if (row.parentElement?.tagName === "TBODY") Array.from(row.cells).forEach(take);
  // A header's name for the line: its `data-cue` when it has one, else its text without a
  // remark in brackets at its end (「適用期間（日本時間）」 is named 「適用期間」).
  const name = (index: number) => { const head = heads?.[index]; const text = (head?.textContent ?? "").replace(/\s+/g, " ").trim(); return head?.dataset.cue?.trim() || text.replace(/（[^（）]*）$/, "") || text; };
  const first = heads?.[0] ?? table.rows[0]?.cells[0];
  const pinned = first && region.ownerDocument.defaultView?.getComputedStyle(first).position === "sticky" ? first.getBoundingClientRect().width : 0;
  const columns: Column[] = [];
  spans.forEach((span, index) => { if (span) columns.push({ name: name(index), ...span }); });
  return { columns, room: region.clientWidth, pinned };
}

/** The columns that are cut when the region is scrolled by `left`: those whose content ends
 * past its right edge, and those whose content starts under the pinned column (or before the
 * left edge). */
function cutAt(layout: Layout, left: number): { before: Column[]; after: Column[] } {
  return {
    before: layout.columns.filter((column) => column.start - left < layout.pinned - CUT_TOLERANCE),
    after: layout.columns.filter((column) => column.end - left > layout.room + CUT_TOLERANCE),
  };
}

/** How wide a text is, in full-width characters: a Latin letter, a digit or a space is about
 * half of one. Only for choosing between the forms below; nothing is laid out by it. */
const widthOf = (text: string) => Array.from(text).reduce((sum, letter) => sum + (letter.charCodeAt(0) < 0x2000 ? 0.55 : 1), 0);

/** The columns to the right, for a table that has not been scrolled: every one by its name
 * while that is one short line; else the first and the last with their number, so that a
 * column of actions at the far end is still named; else the first and how many follow. */
function columnsSentence(after: Column[]): string {
  const names = after.map((column) => column.name).filter(Boolean);
  if (!names.length) return "この表は右に続きます。";
  const [first, last] = [names[0], names[names.length - 1]];
  const all = names.join("・");
  if (names.length === 1 || widthOf(all) <= NAMES_ROOM) return `右に続く列：${all}`;
  const ends = `${first} 〜 ${last}（${names.length}列）`;
  if (names.length > 2 && widthOf(ends) <= NAMES_ROOM) return `右に続く列：${ends}`;
  return `右に続く列：${first} ほか${names.length - 1}列`;
}

/** Consecutive columns (the days of a month), at the position the region is in now: the
 * last one that is cut on the left and the first one that is cut on the right say the rest. */
function sequenceSentence(before: Column[], after: Column[]): string {
  const last = before[before.length - 1]?.name;
  const first = after[0]?.name;
  if (last && first) return `${last}以前は左に、${first}以降は右に続きます。`;
  if (last) return `${last}以前は左にあります。`;
  if (first) return `${first}以降は右に続きます。`;
  return before.length || after.length ? "この表は横に続きます。" : "";
}

/**
 * The line above a table that says its columns run on past the region: placed as the
 * sibling directly before the table's scroll region (`<div className="ideal-table-wrap" …>`,
 * or the month table's own region; the table and its region keep their exact tags, this
 * neither wraps them nor gives them a class). Once React has attached it measures that next
 * sibling, and again when the region or its table changes size and when the fonts have
 * loaded. A scroll measures nothing: it only compares the region's position with what was
 * measured.
 *
 * The line exists only where what a column holds is really cut when the region is at its
 * start: a column counts when its content (the text or control of its header or of one of
 * its cells, not the cell's padding) ends more than a few pixels past the region's edge. A
 * region that can be moved by a few pixels of empty padding cuts nothing and has no line.
 * The columns it names are the ones that are cut, by the text of their own column headers
 * (without a remark in brackets at the end of a header; `data-cue` on a header gives another
 * short name).
 *
 * What it says is true of where the region is now:
 * - A table names the columns to its right, and is drawn only while the region is at its
 *   start, which is where that list is exact. Once the region has been moved (by the hand
 *   that then knows it scrolls, or by focus going to a control in a later column), the line
 *   keeps its place and its words and is not drawn, so the table does not move under the
 *   hand and nothing stale is shown; back at the start it is drawn again.
 * - `sequence` is for columns that are consecutive (the days of a month) in a region its
 *   owner moves by itself (the month table opens on today). There the line is always drawn
 *   and says both sides for the current position: the last day that is cut on the left and
 *   the first day that is cut on the right.
 *
 * It decides nothing but that: no column is hidden, moved or chosen here, and nothing is
 * read from the data. It is a hint for the eye and is hidden from assistive technology: the
 * region has its own name and is focusable and scrollable by keyboard, and a screen reader
 * reads every cell whether it is in view or not. In the server HTML and wherever nothing is
 * cut, it is an empty hidden element (its place in the tree is how it finds the region).
 */
export default function TableScrollCue({ sequence = false }: { sequence?: boolean }) {
  const line = useRef<HTMLParagraphElement>(null);
  const [said, setSaid] = useState<Line>(NOTHING);
  useEffect(() => {
    const region = line.current?.nextElementSibling;
    if (!(region instanceof HTMLElement)) return undefined;
    let live = true;
    let layout: Layout | null = null;
    /** The sentence for a table at its start; measured once per layout. */
    let resting = "";
    const say = () => {
      if (!live || !layout) return;
      const left = Math.abs(region.scrollLeft);
      let next = NOTHING;
      if (resting) {
        if (sequence) { const now = cutAt(layout, left); next = { text: sequenceSentence(now.before, now.after), away: false, back: now.before.length > 0 && now.after.length === 0 }; }
        else next = { text: resting, away: left > CUT_TOLERANCE };
      }
      setSaid((last) => (last.text === next.text && last.away === next.away && Boolean(last.back) === Boolean(next.back) ? last : next));
    };
    const measure = () => {
      if (!live) return;
      layout = layoutOf(region);
      const atStart = cutAt(layout, 0).after;
      resting = atStart.length ? columnsSentence(atStart) : "";
      say();
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(region);
    if (region.firstElementChild) observer?.observe(region.firstElementChild);
    region.addEventListener("scroll", say, { passive: true });
    // A web font that arrives after the first measure changes every width.
    void region.ownerDocument.fonts?.ready.then(measure);
    return () => { live = false; observer?.disconnect(); region.removeEventListener("scroll", say); };
  }, [sequence]);
  const shown = said.text !== "";
  return <p ref={line} className={said.away ? "ideal-v3-scroll-cue is-scrolled" : "ideal-v3-scroll-cue"} hidden={!shown} aria-hidden="true">
    {shown && <><span>{said.text}</span><span>横にスクロールできます。</span>{said.back ? <ArrowLeft aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}</>}
  </p>;
}
