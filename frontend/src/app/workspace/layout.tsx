import type { ReactNode } from "react";
// The workspace's own presentation layer; every selector in it starts with .ideal-v3-app.
import "../../styles/workspace/index.css";

/**
 * Server-only route boundary for the cognitive workspace. The authenticated, request-time
 * shell is rendered by each validated route page so its h1 and context match that URL;
 * only the business control island below it hydrates on the client.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return children;
}
