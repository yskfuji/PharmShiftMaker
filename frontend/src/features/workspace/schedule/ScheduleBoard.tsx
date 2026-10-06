"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useEnteredBeforeMount, useMounted } from "../shared/hydration";
import TableScrollCue from "../shared/TableScrollCue";
import type { ScheduleShown } from "./model";
import ScheduleAgenda from "./ScheduleAgenda";
import ScheduleTable from "./ScheduleTable";

type Props = Pick<ScheduleShown, "title" | "days" | "rows" | "agendas" | "details" | "defaultDetail" | "initialSelected" | "initialDay" | "initialReason" | "changeNote"> & {
  /** What is said when the period has no published duty. */
  empty: string;
};

/**
 * Where the table's own scroll region rests so that a day is in sight: at the start of the
 * period when the day is whole there, otherwise with the day before it as the first day
 * after the names. The region always rests where a day column begins at the edge of the
 * names, so no day is half under them; only when the day asked for is the last one, and
 * would be cut at the other edge, does the region rest at its end. Null when the table is
 * not laid out (narrow screens show the agenda instead).
 */
function restFor(wrap: HTMLElement, day: number): number | null {
  const [names, ...days] = Array.from(wrap.querySelectorAll<HTMLElement>("thead th"));
  const wanted = days[day];
  if (!names || !wanted || wanted.getClientRects().length === 0) return null;
  // Measured on screen and brought back to the region's own coordinates: a pinned cell's
  // offset parent is not the table, and its offset moves with the scroll.
  const origin = wrap.getBoundingClientRect().left + wrap.clientLeft - wrap.scrollLeft;
  const leftOf = (cell: HTMLElement) => cell.getBoundingClientRect().left - origin;
  const rightOf = (cell: HTMLElement) => cell.getBoundingClientRect().right - origin;
  const pinned = names.getBoundingClientRect().width;
  const end = wrap.scrollWidth - wrap.clientWidth;
  if (rightOf(wanted) <= wrap.clientWidth) return 0;
  let first = Math.max(0, day - 1);
  while (first > 0 && leftOf(days[first]) - pinned > end) first -= 1;
  const rest = Math.max(0, leftOf(days[first]) - pinned);
  return rightOf(wanted) <= rest + wrap.clientWidth ? rest : end;
}

/** Filters, the selected duty, the table and the day agenda, and under them what the mark of
 * a changed duty means. The filter choices, the day
 * shown and the selected duty are the only state; the duties arrive as props. The selected
 * duty is said above the table and the agenda, so it is in sight whatever their length. The
 * table and the agenda open on the day the model names (the viewer's next duty, else today),
 * and a control brings the day of the selected duty back into view. */
export default function ScheduleBoard({ title, days, rows, agendas, details, defaultDetail, initialSelected, initialDay, initialReason, changeNote, empty }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const [agendaIndex, setAgendaIndex] = useState(() => Math.min(initialDay, agendas.length - 1));
  const [query, setQuery] = useState("");
  const [qualification, setQualification] = useState("");
  const [changesOnly, setChangesOnly] = useState(false);
  const filters = useRef<HTMLElement>(null);
  const table = useRef<HTMLElement>(null);
  const mounted = useMounted();
  useEnteredBeforeMount(filters, (fields) => {
    setQuery(fields.querySelector<HTMLInputElement>('input[type="search"]')?.value ?? "");
    setQualification(fields.querySelector("select")?.value ?? "");
    setChangesOnly(fields.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked ?? false);
  });
  const selected = picked ?? initialSelected;
  const detail = details[selected] ?? defaultDetail;
  const qualifications = Array.from(new Set(rows.map((row) => row.badge).filter(Boolean)));
  const visibleRows = rows.filter((row) => (!query.trim() || row.name.includes(query.trim())) && (!qualification || row.badge === qualification) && (!changesOnly || row.cells.some((cell) => cell.changed)));
  const none = rows.length ? "条件に一致する職員はいません。" : empty;
  /** Rests the table on a day inside its own region: the page does not move, nothing is
   * focused, and there is no animation to reduce. */
  function restOn(day: number) {
    const rest = table.current ? restFor(table.current, day) : null;
    if (table.current && rest !== null) table.current.scrollLeft = rest;
  }
  // Once, after mounting: the table opens where the day it should show is in sight.
  const openOnDay = useEffectEvent(() => restOn(initialDay));
  useEffect(() => openOnDay(), []);
  /** The day of the selected duty, in both forms: the agenda shows it, and the table rests
   * on it. */
  function showSelectedDay() {
    const day = agendas.findIndex((agenda) => agenda.items.some((item) => item.id === selected));
    if (day < 0) return;
    setAgendaIndex(day);
    restOn(day);
  }
  return <>
    <section ref={filters} className="ideal-v3-filters ideal-v3-schedule-filters" aria-label="勤務表の表示条件"><label>職員名<input className="ideal-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前で絞り込み" /></label><label>資格・担当<select className="ideal-input" value={qualification} onChange={(event) => setQualification(event.target.value)}><option value="">すべて</option>{qualifications.map((item) => <option key={item}>{item}</option>)}</select></label><label className="ideal-switch"><input type="checkbox" checked={changesOnly} onChange={(event) => setChangesOnly(event.target.checked)} /><span>直前版から変更された職員だけ</span></label><span className="ideal-v3-filter-count" role="status">{visibleRows.length}名を表示</span></section>
    {/* No duty to select: the empty message below says so, and no selection hint is shown.
        The control is offered once it can answer. */}
    {Object.keys(details).length > 0 && <aside className="ideal-detail ideal-v3-schedule-selected" aria-live="polite"><div><span className="ideal-eyebrow">選択中の勤務</span><h3>{detail.who ? <><bdi data-verbatim>{detail.who}</bdi> · {detail.when}</> : detail.title}</h3>{initialReason && selected === initialSelected && <small className="ideal-v3-schedule-why">{initialReason}</small>}</div><div className="ideal-detail__facts">{detail.facts.map((fact, position) => <span key={position}>{fact.typed && <bdi data-verbatim>{fact.typed}</bdi>}{fact.typed && fact.text ? " " : ""}{fact.text}</span>)}</div><p>{detail.note}</p>{mounted && Object.hasOwn(details, selected) && <button type="button" className="ideal-button ideal-button--secondary" onClick={showSelectedDay}>この日を表示</button>}</aside>}
    <div className="ideal-v3-schedule-month-table"><TableScrollCue sequence /><ScheduleTable ref={table} title={title} days={days} rows={visibleRows} selected={selected} onSelect={setPicked} none={none} /></div>
    <ScheduleAgenda agendas={agendas} index={agendaIndex} onIndex={setAgendaIndex} visible={new Set(visibleRows.map((row) => row.id))} selected={selected} onSelect={setPicked} none={none} />
    {changeNote && <p className="ideal-note ideal-v3-schedule-legend"><i className="ideal-v3-schedule-mark" aria-hidden="true" /><span><strong>変更</strong>の印：{changeNote}</span></p>}
  </>;
}
