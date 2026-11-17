import type { ReactNode } from "react";

import NotFound from "@/app/not-found";
import { parseMonth } from "@/lib/scheduleMonth";

/**
 * An invalid year or month shows the not-found view here, above the month's loading view,
 * rendered on the server (see app/not-found.tsx for why this is not a thrown notFound()).
 */
export default async function ScheduleMonthLayout({ children, params }: { children: ReactNode; params: Promise<{ year: string; month: string }> }) {
  const { year, month } = await params;
  return parseMonth(year, month) ? children : <NotFound />;
}
