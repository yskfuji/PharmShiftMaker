// What the ideal screens display, independent of where it comes from. The synthetic
// provider fills every part; the API provider fills only the parts wired to the server.
// Screens render this model and never fetch.
import type { IdealRole, IdealScreen } from "./types";

export type Tone = "neutral" | "good" | "warn" | "danger" | "info";
export type MetricTone = "neutral" | "good" | "warn" | "danger";

export interface MetricModel { label: string; value: string; detail: string; tone?: MetricTone }

export interface ShellModel {
  /** Facility and department shown above each page title. */
  scopeLabel: string;
  publication: { version: string; note: string };
  user: { name: string; initial: string };
  notifications: number;
  footer: [string, string];
  /** Screens this viewer may open, in navigation order. */
  nav: Record<IdealRole, readonly IdealScreen[]>;
}

export interface PersonalHomeModel {
  eyebrow: string;
  title: string;
  detail: string;
  when: string;
  countdown: string;
  metrics: MetricModel[];
  request: { eyebrow: string; title: string; due: string; body: string } | null;
}

export interface TeamHomeModel {
  eyebrow: string;
  headline: Record<"ADMIN" | "LEADER", string>;
  detail: string;
  sealTime: string;
  metrics: MetricModel[];
  /** The decision queue; null where it is not wired to the API yet. */
  priorities: { number: string; title: string; detail: string; tag: string; tone: Tone }[] | null;
  stability: { value: string; label: string; bars: number[]; note: string } | null;
}

export interface HomeModel { personal: PersonalHomeModel; team: TeamHomeModel }

export interface ScheduleCell { id: string; shift: string; time: string; changed: boolean }
export interface ScheduleRow { id: string; name: string; initial: string; badge: string; cells: ScheduleCell[] }
export interface ScheduleDetail { title: string; facts: string[]; note: string }

export interface ScheduleModel {
  eyebrow: string;
  title: string;
  summary: { tone: "good" | "warn" | "new"; label: string }[];
  range: string;
  days: { label: string; status: string; weekend: boolean }[];
  rows: ScheduleRow[];
  agenda: { title: string; dayIndex: number; items: { id: string; name: string; initial: string; badge: string; status: string; tone: Tone }[] };
  agendas: { title: string; dayIndex: number; items: { id: string; name: string; initial: string; badge: string; status: string; tone: Tone }[] }[];
  initialSelected: string;
  details: Record<string, ScheduleDetail>;
  defaultDetail: ScheduleDetail;
  /** Personal print / iCalendar links (API mode, the viewer's own duties only). */
  personalExport: { print: string; ical: string } | null;
  /** Registered full-department export. The server, not this flag, authorizes preparation. */
  departmentExport: { scope: string; publication: string; version: number } | null;
  /** Showcase-only buttons (export all, review changes); not wired to the API yet. */
  showcaseActions: boolean;
}

/** A problem shown in place of a screen: conflict, permission, validation or unknown outcome. */
export interface ProblemModel {
  kind: "conflict" | "forbidden" | "validation" | "unknown" | "unauthenticated" | "notFound";
  code: string;
  title: string;
  body: string;
  action: string;
}

export interface WorkspaceModel {
  shell: ShellModel;
  home: HomeModel;
  schedule: ScheduleModel;
}
