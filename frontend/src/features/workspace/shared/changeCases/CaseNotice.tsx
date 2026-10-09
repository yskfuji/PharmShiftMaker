"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

const NoticeContext = createContext<(message: string) => void>(() => undefined);

/** Puts a confirmation into the notice of the route it is used in. */
export const useCaseNotice = () => useContext(NoticeContext);

/** One confirmation per route, kept while the lists below it change: a case may leave its
 * list as soon as the change is made. The text is the only thing kept here. */
export default function CaseNotice({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<string | null>(null);
  return <NoticeContext.Provider value={setNotice}>
    {/* Always present, so the confirmation is announced when it is put in. */}
    <p className="ideal-done" role="status">{notice ?? ""}</p>
    {children}
  </NoticeContext.Provider>;
}
