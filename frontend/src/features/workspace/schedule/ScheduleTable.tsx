import type { Ref } from "react";
import type { ScheduleShown } from "./model";

type Props = Pick<ScheduleShown, "title" | "days" | "rows"> & { selected: string; onSelect: (id: string) => void; none: string; /** The table's scroll region, for what brings a day into view. */ ref?: Ref<HTMLElement> };

const dayClass = (day: ScheduleShown["days"][number] | undefined) => [day?.weekend ? "is-weekend" : "", day?.today ? "is-today" : ""].filter(Boolean).join(" ") || undefined;

/** The date of a column. The month is drawn where a month begins (the first column and
 * every first of a month) and is read out everywhere: "10/12" is drawn as "12". */
function DayNumber({ date, first }: { date: string; first: boolean }) {
  const [month, day] = date.split("/");
  return <strong><span className={first || day === "1" ? undefined : "sr-only"}>{month}/</span>{day}</strong>;
}

/** The month as a table: one row per person, one narrow column per day, so that three weeks
 * are in sight on a desk screen. A day's head is its day of the month over its weekday; a duty is its
 * name over its two times (the dash between them is read out, not drawn). A duty the server
 * lists among the changes carries a mark in its corner, read out as 「変更」 (the note under
 * the table says what it means). The table scrolls in its own region, under the names; the
 * line before it (shared/TableScrollCue) names the first day that is cut by `data-cue`. */
export default function ScheduleTable({ title, days, rows, selected, onSelect, none, ref }: Props) {
  return <section ref={ref} className="ideal-schedule-table-wrap" aria-label="月間勤務表" tabIndex={0}>
    <table className="ideal-schedule-table">
      <caption className="sr-only">{title}の公開済み勤務。横にスクロールして日付を確認できます。</caption>
      <thead><tr><th scope="col" className="ideal-schedule-table__person">職員・資格</th>{days.map((day, index) => <th scope="col" key={day.label} className={dayClass(day)} data-cue={`${day.date.split("/")[1]}日`}><DayNumber date={day.date} first={index === 0} />{" "}<span>{day.weekday}</span>{day.today && <>{" "}<em>今日</em></>}</th>)}</tr></thead>
      <tbody>{rows.map((person) => <tr key={person.id}>
        <th scope="row" className="ideal-schedule-table__person"><span className="ideal-person"><span className="ideal-avatar">{person.initial}</span><span><strong data-verbatim>{person.name}</strong><small>{person.badge}</small></span></span></th>
        {person.cells.map((cell, index) => <td key={cell.id} className={dayClass(days[index])}><button onClick={() => onSelect(cell.id)} className={`ideal-shift ${selected === cell.id ? "is-selected" : ""} ${cell.changed ? "is-changed" : ""} ${cell.spans.length ? "" : "is-empty"}`} aria-pressed={selected === cell.id}><strong data-verbatim>{cell.shift}</strong>{cell.spans.map((hours, position) => <span key={position}><span>{hours.start}</span><span className="sr-only">–</span><span>{hours.end}</span></span>)}{cell.changed && <em className="ideal-v3-schedule-mark"><span className="sr-only">変更</span></em>}</button></td>)}
      </tr>)}{rows.length === 0 && <tr><td colSpan={Math.max(1, days.length + 1)} className="ideal-schedule-grid__empty">{none}</td></tr>}</tbody>
    </table>
  </section>;
}
