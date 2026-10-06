import { ChevronLeft, ChevronRight } from "lucide-react";
import { StatusPill } from "@/ideal/ui/atoms";
import type { ScheduleShown } from "./model";

type Props = Pick<ScheduleShown, "agendas"> & { index: number; onIndex: (next: number) => void; visible: Set<string>; selected: string; onSelect: (id: string) => void; none: string };

/** One day at a time (narrow screens): the people the filters leave, and their duty. A row
 * holds a person's name, the name of their duty (each someone's own words, and each marked
 * `data-verbatim` on the element that holds it alone: 「本人」 and 「勤務なし」 are the product's),
 * its hours, and the mark of a changed duty. The day is chosen by one control, a list of the
 * days between the buttons for the day before and after; the heading that names the day is
 * for a screen reader only, so the date is drawn once. */
export default function ScheduleAgenda({ agendas, index, onIndex, visible, selected, onSelect, none }: Props) {
  const agenda = agendas[Math.min(index, agendas.length - 1)];
  const items = agenda.items.filter((item) => visible.has(item.id.slice(0, item.id.lastIndexOf("-"))));
  return <section className="ideal-agenda" aria-label="日別勤務予定">
    <div className="ideal-agenda__head"><button type="button" className="ideal-icon-button" aria-label="前の日" disabled={index === 0} onClick={() => onIndex(Math.max(0, index - 1))}><ChevronLeft aria-hidden="true" /></button><h2 className="sr-only">{agenda.title}</h2><label className="sr-only" htmlFor="ideal-agenda-date">表示する日</label><select id="ideal-agenda-date" className="ideal-agenda__select" value={index} onChange={(event) => onIndex(Number(event.target.value))}>{agendas.map((item, position) => <option value={position} key={`${item.title}-${position}`}>{item.title}</option>)}</select><button type="button" className="ideal-icon-button" aria-label="次の日" disabled={index >= agendas.length - 1} onClick={() => onIndex(Math.min(agendas.length - 1, index + 1))}><ChevronRight aria-hidden="true" /></button></div>
    {items.map((item) => <button type="button" className="ideal-agenda__item" key={item.id} aria-pressed={selected === item.id} onClick={() => onSelect(item.id)}><span className="ideal-avatar">{item.initial}</span><div><strong data-verbatim>{item.name}</strong><span>{item.badge}</span></div><span className="ideal-v3-agenda-duty"><StatusPill tone={item.tone}>{item.time ? <bdi data-verbatim>{item.status}</bdi> : item.status}</StatusPill>{item.time && <span>{item.time}</span>}{item.changed && <em className="ideal-v3-schedule-mark"><span className="sr-only">変更</span></em>}</span></button>)}{items.length === 0 && <p className="ideal-agenda__empty">{none}</p>}
  </section>;
}
