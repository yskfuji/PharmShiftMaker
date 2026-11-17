"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import PublicationExport from "@/components/PublicationExport";
import type { ScheduleModel } from "../model";
import type { IdealRole } from "../types";
import { StatusPill } from "./shared";

export default function ScheduleScreen({ role, model }: { role: IdealRole; model: ScheduleModel }) {
  const [selected, setSelected] = useState(model.initialSelected);
  const [agendaIndex, setAgendaIndex] = useState(model.agenda.dayIndex);
  const [query, setQuery] = useState("");
  const [qualification, setQualification] = useState("");
  const [changesOnly, setChangesOnly] = useState(false);
  const detail = model.details[selected] ?? model.defaultDetail;
  const agendas = model.agendas.length ? model.agendas : [model.agenda];
  const agenda = agendas[Math.min(agendaIndex, agendas.length - 1)] ?? model.agenda;
  const qualifications = Array.from(new Set(model.rows.map((row) => row.badge).filter(Boolean)));
  const visibleRows = model.rows.filter((row) => (!query.trim() || row.name.includes(query.trim())) && (!qualification || row.badge === qualification) && (!changesOnly || row.cells.some((cell) => cell.changed)));
  const visiblePeople = new Set(visibleRows.map((row) => row.id));
  const agendaItems = agenda.items.filter((item) => visiblePeople.has(item.id.slice(0, item.id.lastIndexOf("-"))));
  // An empty week is said in words, so it is not mistaken for a table that failed to load.
  const empty = role === "PHARMACIST" ? "表示期間に、あなたの公開済みの勤務はありません。" : "表示期間に、公開済みの勤務はありません。";
  return (
    <div className="ideal-stack">
      <section className="ideal-toolbar"><div><span className="ideal-eyebrow">{model.eyebrow}</span><h2>{model.title}</h2></div>{model.showcaseActions
        ? <div className="ideal-actions"><button className="ideal-button ideal-button--secondary"><Download aria-hidden="true" />{role === "PHARMACIST" ? "自分の予定を出力" : "公開版を出力"}</button>{role !== "PHARMACIST" && <button className="ideal-button ideal-button--primary">変更点を確認</button>}</div>
        : model.personalExport && <div className="ideal-actions"><a className="ideal-button ideal-button--secondary" href={model.personalExport.print} target="_blank" rel="noopener noreferrer"><Download aria-hidden="true" />自分の予定を印刷</a><a className="ideal-button ideal-button--secondary" href={model.personalExport.ical} download><Download aria-hidden="true" />カレンダーに追加<span className="sr-only">（.ics）</span></a></div>}</section>
      <section className="ideal-v3-filters" aria-label="勤務表の表示条件"><label>職員名<input className="ideal-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前で絞り込み" /></label><label>資格・担当<select className="ideal-input" value={qualification} onChange={(event) => setQualification(event.target.value)}><option value="">すべて</option>{qualifications.map((item) => <option key={item}>{item}</option>)}</select></label><label className="ideal-switch"><input type="checkbox" checked={changesOnly} onChange={(event) => setChangesOnly(event.target.checked)} /><span>直前版から変更された職員だけ</span></label><span className="ideal-v3-filter-count" role="status">{visibleRows.length}名を表示</span></section>
      <div className="ideal-schedule-summary">{model.summary.map((item) => <span key={item.label}><i className={`ideal-dot ideal-dot--${item.tone}`} />{item.label}</span>)}<span className="ideal-schedule-summary__push">{model.range}</span></div>
      {model.departmentExport && <details className="ideal-v3-disclosure ideal-department-export"><summary><Download aria-hidden="true" />部署の公開版を出力</summary><div><p>CSV・JSONを管理領域で検証し、受渡し記録と内容ハッシュを残して保存します。</p><PublicationExport scope={model.departmentExport.scope} publication={model.departmentExport.publication} version={model.departmentExport.version} /></div></details>}
      <section className="ideal-schedule-table-wrap" aria-label="月間勤務表" tabIndex={0}>
        <table className="ideal-schedule-table">
          <caption className="sr-only">{model.title}の公開済み勤務。横にスクロールして日付を確認できます。</caption>
          <thead><tr><th scope="col" className="ideal-schedule-table__person">職員・資格</th>{model.days.map((day) => <th scope="col" key={day.label} className={day.weekend ? "is-weekend" : ""}><strong>{day.label}</strong><span>{day.status}</span></th>)}</tr></thead>
          <tbody>{visibleRows.map((person) => <tr key={person.id}>
            <th scope="row" className="ideal-schedule-table__person"><span className="ideal-person"><span className="ideal-avatar">{person.initial}</span><span><strong>{person.name}</strong><small>{person.badge}</small></span></span></th>
            {person.cells.map((cell) => <td key={cell.id}><button onClick={() => setSelected(cell.id)} className={`ideal-shift ${selected === cell.id ? "is-selected" : ""} ${cell.changed ? "is-changed" : ""}`} aria-pressed={selected === cell.id}><strong>{cell.shift}</strong><span>{cell.time}</span>{cell.changed && <em>変更</em>}</button></td>)}
          </tr>)}{visibleRows.length === 0 && <tr><td colSpan={Math.max(1, model.days.length + 1)} className="ideal-schedule-grid__empty">{model.rows.length ? "条件に一致する職員はいません。" : empty}</td></tr>}</tbody>
        </table>
      </section>
      <section className="ideal-agenda" aria-label="日別勤務予定">
        <div className="ideal-agenda__head"><button type="button" className="ideal-icon-button" aria-label="前の日" disabled={agendaIndex === 0} onClick={() => setAgendaIndex((value) => Math.max(0, value - 1))}><ChevronLeft aria-hidden="true" /></button><h2>{agenda.title}</h2><button type="button" className="ideal-icon-button" aria-label="次の日" disabled={agendaIndex >= agendas.length - 1} onClick={() => setAgendaIndex((value) => Math.min(agendas.length - 1, value + 1))}><ChevronRight aria-hidden="true" /></button></div>
        <label className="sr-only" htmlFor="ideal-agenda-date">表示する日</label><select id="ideal-agenda-date" className="ideal-agenda__select" value={agendaIndex} onChange={(event) => setAgendaIndex(Number(event.target.value))}>{agendas.map((item, index) => <option value={index} key={`${item.title}-${index}`}>{item.title}</option>)}</select>
        {agendaItems.map((item) => <button type="button" className="ideal-agenda__item" key={item.id} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><span className="ideal-avatar">{item.initial}</span><div><strong>{item.name}</strong><span>{item.badge}</span></div><StatusPill tone={item.tone}>{item.status}</StatusPill></button>)}{agendaItems.length === 0 && <p className="ideal-agenda__empty">{model.rows.length ? "条件に一致する職員はいません。" : empty}</p>}
      </section>
      {/* No duty to select: the empty message above says so, and no selection hint is shown. */}
      {Object.keys(model.details).length > 0 && <aside className="ideal-detail" aria-live="polite"><div><span className="ideal-eyebrow">選択中の勤務</span><h3>{detail.title}</h3></div><div className="ideal-detail__facts">{detail.facts.map((fact) => <span key={fact}>{fact}</span>)}</div><p>{detail.note}</p></aside>}
    </div>
  );
}
