import type { ReactNode } from "react";
import { Activity, ArrowRight, CalendarDays, CheckCircle2, FileClock, Home, LifeBuoy, LockKeyhole, RefreshCw, Settings, ShieldCheck, Sparkles, Users } from "lucide-react";
import type { MetricTone, ProblemModel, Tone } from "../model";
import type { IdealScreen } from "../types";
import { WORKSPACE_SCREENS } from "@/features/workspace/generated/usecaseRoutes";

const icons: Record<IdealScreen, typeof Home> = { home: Home, schedule: CalendarDays, plan: Sparkles, operations: Activity, requests: FileClock, people: Users, governance: ShieldCheck, settings: Settings };

export const screenMeta = Object.fromEntries(WORKSPACE_SCREENS.map((screen) => [screen.key, {
  label: screen.label,
  hint: screen.hint,
  icon: icons[screen.key as IdealScreen],
}])) as Record<IdealScreen, { label: string; hint: string; icon: typeof Home }>;

export function StatusPill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`ideal-pill ideal-pill--${tone}`}>{children}</span>;
}

export function Metric({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: MetricTone }) {
  return (
    <article className={`ideal-metric ideal-metric--${tone}`}>
      <p>{label}</p><strong>{value}</strong><span>{detail}</span>
    </article>
  );
}

export function EmptyState({ screen, onRefresh }: { screen: IdealScreen; onRefresh?: () => void }) {
  return (
    <section className="ideal-empty" aria-labelledby="empty-title">
      <div className="ideal-empty__mark"><CheckCircle2 aria-hidden="true" /></div>
      <h2 id="empty-title">いま対応が必要な項目はありません</h2>
      <p>{screenMeta[screen].label}の新しい情報が届くと、ここに優先順で表示されます。</p>
      <button className="ideal-button ideal-button--secondary" onClick={onRefresh}><RefreshCw aria-hidden="true" />最新情報を確認</button>
    </section>
  );
}

export function LoadingState() {
  return <section className="ideal-loading" aria-busy="true" aria-label="情報を読み込んでいます">{[1, 2, 3, 4].map((v) => <div className="ideal-skeleton" key={v} />)}</section>;
}

const problemIcon: Record<ProblemModel["kind"], typeof LifeBuoy> = {
  unknown: LifeBuoy, conflict: RefreshCw, forbidden: LockKeyhole, validation: LockKeyhole, unauthenticated: LockKeyhole, notFound: LifeBuoy,
};

/** Conflict, permission, validation and unknown outcome are shown apart; none is a plain "failure". */
export function ProblemState({ problem, onAction }: { problem: ProblemModel; onAction?: () => void }) {
  const Icon = problemIcon[problem.kind];
  return (
    <section className="ideal-problem" role="alert" aria-labelledby="problem-title">
      <Icon aria-hidden="true" />
      <div><StatusPill tone={problem.kind === "forbidden" ? "neutral" : "warn"}>{problem.code}</StatusPill><h2 id="problem-title">{problem.title}</h2><p>{problem.body}</p><button className="ideal-button ideal-button--primary" onClick={onAction}>{problem.action}<ArrowRight aria-hidden="true" /></button></div>
    </section>
  );
}
