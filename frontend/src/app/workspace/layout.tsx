import type { ReactNode } from "react";

/**
 * Server-only route boundary for the cognitive workspace. The authenticated, request-time
 * shell is rendered by each validated route page so its h1 and context match that URL;
 * only the business control island below it hydrates on the client.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return children;
}
