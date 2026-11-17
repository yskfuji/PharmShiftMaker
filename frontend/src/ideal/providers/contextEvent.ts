import type { PublicationRead } from "../api/contracts";

export const WORKSPACE_CONTEXT_CHANGED = "workspace-context-changed";

export type WorkspaceContextChangedDetail = {
  unreadNotifications?: number;
  period?: string;
  publication: Pick<PublicationRead, "publication_id" | "version" | "validation_status"> | null;
};

export function announceWorkspaceContext(detail: WorkspaceContextChangedDetail) {
  window.dispatchEvent(new CustomEvent<WorkspaceContextChangedDetail>(WORKSPACE_CONTEXT_CHANGED, { detail }));
}
