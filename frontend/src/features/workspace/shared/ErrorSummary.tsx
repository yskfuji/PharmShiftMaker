"use client";

import { useEffect, useId, useRef } from "react";

/** One thing to correct: the message, and the field it is about when that is known. */
export type SummaryIssue = { message: string; fieldId?: string };

/**
 * What stops a task from going on, listed above its fields: an entry slip found here, or
 * the server's refusal in its own words. Focus moves to the heading when the summary
 * appears and again for each attempt (`attempt` changes), so it is read first; an issue
 * that names a field is a control that moves focus to that field. It is not an alert:
 * the focus announces it.
 */
export default function ErrorSummary({ title, issues, attempt = 0, level = 4 }: { title: string; issues: SummaryIssue[]; attempt?: number; level?: 3 | 4 | 5 }) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [attempt]);
  const Heading = `h${level}` as const;
  return <section className="ideal-inline-problem" aria-labelledby={`${id}-title`}>
    <div>
      <Heading id={`${id}-title`} className="ideal-v3-heading" ref={heading} tabIndex={-1}>{title}（{issues.length}件）</Heading>
      <ul className="ideal-note-list">{issues.map((issue, index) => <li key={index}>{issue.fieldId
        ? <button type="button" className="ideal-link ideal-link--target" onClick={() => document.getElementById(issue.fieldId!)?.focus()}>{issue.message}</button>
        : issue.message}</li>)}</ul>
    </div>
  </section>;
}
