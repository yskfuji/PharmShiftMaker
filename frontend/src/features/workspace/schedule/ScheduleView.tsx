import { CalendarPlus, ChevronLeft, ChevronRight, Download, Printer } from "lucide-react";
import { createIdealClient } from "@/ideal/api/client";
import type { ScheduleCalendarView } from "@/ideal/types";
import { API_BASE_URL } from "@/lib/apiTarget";
import ExportPublication from "../shared/ExportPublication";
import { routeOf, type RouteContext } from "../shell/routeTypes";
import WorkspaceLink from "../shell/WorkspaceLink";
import { scheduleModel, shiftMonth } from "./model";
import ScheduleBoard from "./ScheduleBoard";

/** The published schedule of the selected period. Its head says what is shown (the
 * publication, the count and the period), leads to the month before and after, and holds
 * every way out of it: the viewer's own
 * print and calendar links, and the registered department export where the server allows
 * it. Below it, the duties by person and by day. */
export default function ScheduleView({ data, ctx }: { data: { calendar: ScheduleCalendarView | null }; ctx: RouteContext }) {
  const urls = createIdealClient("server-read");
  const model = scheduleModel(ctx, data.calendar, (id, format) => urls.personalExportUrl(API_BASE_URL, ctx.scope.scope_id, id, format));
  // An empty period is said in words, so it is not mistaken for a table that failed to load.
  // The months beside the one shown: the same route with another period. The server reads
  // the month again and selects its latest publication, or none.
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(ctx.period) ? ctx.period : null;
  const schedule = routeOf("schedule/index").route;
  const empty = ctx.role === "PHARMACIST" ? "表示期間に、あなたの公開済みの勤務はありません。" : "表示期間に、公開済みの勤務はありません。";
  return <div className="ideal-stack">
    <section className="ideal-toolbar ideal-v3-schedule-head">
      <div><span className="ideal-eyebrow">{model.eyebrow}</span><div className="ideal-v3-schedule-month"><h2>{model.title}</h2>
        {month && <nav aria-label="表示する月"><WorkspaceLink className="ideal-button ideal-button--secondary" route={schedule} context={{ period: shiftMonth(month, -1) }}><ChevronLeft aria-hidden="true" />前の月</WorkspaceLink><WorkspaceLink className="ideal-button ideal-button--secondary" route={schedule} context={{ period: shiftMonth(month, 1) }}>次の月<ChevronRight aria-hidden="true" /></WorkspaceLink></nav>}</div>
        <div className="ideal-schedule-summary">{model.summary.map((item) => <span key={item.label}><i className={`ideal-dot ideal-dot--${item.tone}`} />{item.label}</span>)}<span className="ideal-schedule-summary__push">{model.range}</span></div></div>
      {model.personalExport && <div className="ideal-actions"><a className="ideal-button ideal-button--secondary" href={model.personalExport.print} target="_blank" rel="noopener noreferrer"><Printer aria-hidden="true" />自分の予定を印刷</a><a className="ideal-button ideal-button--secondary" href={model.personalExport.ical} download><CalendarPlus aria-hidden="true" />カレンダーに追加<span className="sr-only">（.ics）</span></a></div>}
      {model.departmentExport && <details className="ideal-v3-disclosure ideal-department-export"><summary><Download aria-hidden="true" />部署の公開版を出力</summary><div><p className="ideal-note">部署全員の公開済みの勤務を、ファイルとして保存します。保存するたびに、受け渡しの記録が残ります。</p><ExportPublication scope={model.departmentExport.scope} publication={model.departmentExport.publication} version={model.departmentExport.version} /></div></details>}
    </section>
    <ScheduleBoard title={model.title} days={model.days} rows={model.rows} agendas={model.agendas} details={model.details} defaultDetail={model.defaultDetail} initialSelected={model.initialSelected} initialDay={model.initialDay} initialReason={model.initialReason} changeNote={model.changeNote} empty={empty} />
  </div>;
}
