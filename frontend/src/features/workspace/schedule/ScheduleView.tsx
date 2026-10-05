import { Download } from "lucide-react";
import { createIdealClient } from "@/ideal/api/client";
import type { ScheduleCalendarView } from "@/ideal/types";
import { API_BASE_URL } from "@/lib/apiTarget";
import ExportPublication from "../shared/ExportPublication";
import type { RouteContext } from "../shell/routeTypes";
import { scheduleModel } from "./model";
import ScheduleBoard from "./ScheduleBoard";

/** The published schedule of the selected period: the viewer's own export links, the
 * registered department export where the server allows it, and the duties by person and
 * by day. */
export default function ScheduleView({ data, ctx }: { data: { calendar: ScheduleCalendarView | null }; ctx: RouteContext }) {
  const urls = createIdealClient("server-read");
  const model = scheduleModel(ctx, data.calendar, (id, format) => urls.personalExportUrl(API_BASE_URL, ctx.scope.scope_id, id, format));
  // An empty period is said in words, so it is not mistaken for a table that failed to load.
  const empty = ctx.role === "PHARMACIST" ? "表示期間に、あなたの公開済みの勤務はありません。" : "表示期間に、公開済みの勤務はありません。";
  return <div className="ideal-stack">
    <section className="ideal-toolbar"><div><span className="ideal-eyebrow">{model.eyebrow}</span><h2>{model.title}</h2></div>{model.personalExport && <div className="ideal-actions"><a className="ideal-button ideal-button--secondary" href={model.personalExport.print} target="_blank" rel="noopener noreferrer"><Download aria-hidden="true" />自分の予定を印刷</a><a className="ideal-button ideal-button--secondary" href={model.personalExport.ical} download><Download aria-hidden="true" />カレンダーに追加<span className="sr-only">（.ics）</span></a></div>}</section>
    <ScheduleBoard title={model.title} days={model.days} rows={model.rows} agendas={model.agendas} details={model.details} defaultDetail={model.defaultDetail} initialSelected={model.initialSelected} empty={empty}>
      <div className="ideal-schedule-summary">{model.summary.map((item) => <span key={item.label}><i className={`ideal-dot ideal-dot--${item.tone}`} />{item.label}</span>)}<span className="ideal-schedule-summary__push">{model.range}</span></div>
      {model.departmentExport && <details className="ideal-v3-disclosure ideal-department-export"><summary><Download aria-hidden="true" />部署の公開版を出力</summary><div><p>CSV・JSONを管理領域で検証し、受渡し記録と内容ハッシュを残して保存します。</p><ExportPublication scope={model.departmentExport.scope} publication={model.departmentExport.publication} version={model.departmentExport.version} /></div></details>}
    </ScheduleBoard>
  </div>;
}
