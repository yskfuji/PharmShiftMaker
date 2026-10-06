import type { ReactNode } from "react";

/** A part on the surface the workspace routes use: the v3 scope, its content column and
 * one panel. Not a story file. */
export function PartsFrame({ children }: { children: ReactNode }) {
  return <div className="ideal-v3-app"><div className="ideal-v3-content" style={{ padding: "1rem" }}><section className="ideal-panel" aria-label="部品の表示例">{children}</section></div></div>;
}

export const inPartsFrame = (Story: () => ReactNode) => <PartsFrame><Story /></PartsFrame>;

/** The same scope and content column without a panel, for a story that shows panels. */
export function ContentFrame({ children }: { children: ReactNode }) {
  return <div className="ideal-v3-app"><div className="ideal-v3-content" style={{ padding: "1rem" }}>{children}</div></div>;
}

export const inContentFrame = (Story: () => ReactNode) => <ContentFrame><Story /></ContentFrame>;
