import type { ScheduleShown } from "./model";

type Props = Pick<ScheduleShown, "title" | "days" | "rows"> & { selected: string; onSelect: (id: string) => void; none: string };

/** The month as a table: one row per person, one column per day (wide screens). */
export default function ScheduleTable({ title, days, rows, selected, onSelect, none }: Props) {
  return <section className="ideal-schedule-table-wrap" aria-label="月間勤務表" tabIndex={0}>
    <table className="ideal-schedule-table">
      <caption className="sr-only">{title}の公開済み勤務。横にスクロールして日付を確認できます。</caption>
      <thead><tr><th scope="col" className="ideal-schedule-table__person">職員・資格</th>{days.map((day) => <th scope="col" key={day.label} className={day.weekend ? "is-weekend" : ""}><strong>{day.label}</strong><span>{day.status}</span></th>)}</tr></thead>
      <tbody>{rows.map((person) => <tr key={person.id}>
        <th scope="row" className="ideal-schedule-table__person"><span className="ideal-person"><span className="ideal-avatar">{person.initial}</span><span><strong>{person.name}</strong><small>{person.badge}</small></span></span></th>
        {person.cells.map((cell) => <td key={cell.id}><button onClick={() => onSelect(cell.id)} className={`ideal-shift ${selected === cell.id ? "is-selected" : ""} ${cell.changed ? "is-changed" : ""}`} aria-pressed={selected === cell.id}><strong>{cell.shift}</strong><span>{cell.time}</span>{cell.changed && <em>変更</em>}</button></td>)}
      </tr>)}{rows.length === 0 && <tr><td colSpan={Math.max(1, days.length + 1)} className="ideal-schedule-grid__empty">{none}</td></tr>}</tbody>
    </table>
  </section>;
}
