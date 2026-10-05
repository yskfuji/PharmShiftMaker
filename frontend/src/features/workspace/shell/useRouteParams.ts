"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

/** The query of the current URL. Next's hook has no router in Jest and Storybook and then
 * gives nothing; one stable empty query stands in, so reads keyed by it are not repeated. */
export function useRouteParams(): URLSearchParams {
  const searchParams = useSearchParams();
  return useMemo(() => searchParams ?? new URLSearchParams(), [searchParams]);
}
