"use client";

import { useRef, useState, type ReactNode } from "react";
import { useEnteredBeforeMount } from "../shared/hydration";
import type { ScheduleShown } from "./model";
import ScheduleAgenda from "./ScheduleAgenda";
import ScheduleTable from "./ScheduleTable";

type Props = Pick<ScheduleShown, "title" | "days" | "rows" | "agendas" | "details" | "defaultDetail" | "initialSelected"> & {
  /** What is said when the period has no published duty. */
  empty: string;
  /** The summary and the export, shown between the filters and the table. */
  children: ReactNode;
};

/** Filters, the table, the day agenda and the selected duty. The filter choices, the day
 * shown and the selected duty are the only state; the duties arrive as props. */
export default function ScheduleBoard({ title, days, rows, agendas, details, defaultDetail, initialSelected, empty, children }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const [agendaIndex, setAgendaIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [qualification, setQualification] = useState("");
  const [changesOnly, setChangesOnly] = useState(false);
  const filters = useRef<HTMLElement>(null);
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
  return <>
    <section ref={filters} className="ideal-v3-filters" aria-label="勤務表の表示条件"><label>職員名<input className="ideal-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前で絞り込み" /></label><label>資格・担当<select className="ideal-input" value={qualification} onChange={(event) => setQualification(event.target.value)}><option value="">すべて</option>{qualifications.map((item) => <option key={item}>{item}</option>)}</select></label><label className="ideal-switch"><input type="checkbox" checked={changesOnly} onChange={(event) => setChangesOnly(event.target.checked)} /><span>直前版から変更された職員だけ</span></label><span className="ideal-v3-filter-count" role="status">{visibleRows.length}名を表示</span></section>
    {children}
    <ScheduleTable title={title} days={days} rows={visibleRows} selected={selected} onSelect={setPicked} none={none} />
    <ScheduleAgenda agendas={agendas} index={agendaIndex} onIndex={setAgendaIndex} visible={new Set(visibleRows.map((row) => row.id))} selected={selected} onSelect={setPicked} none={none} />
    {/* No duty to select: the empty message above says so, and no selection hint is shown. */}
    {Object.keys(details).length > 0 && <aside className="ideal-detail" aria-live="polite"><div><span className="ideal-eyebrow">選択中の勤務</span><h3>{detail.title}</h3></div><div className="ideal-detail__facts">{detail.facts.map((fact, position) => <span key={`${position}-${fact}`}>{fact}</span>)}</div><p>{detail.note}</p></aside>}
  </>;
}
