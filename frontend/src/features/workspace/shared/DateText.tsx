import { Fragment, type ReactNode } from "react";
import SoftBreaks from "./SoftBreaks";

const DAY = String.raw`\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?`;
/** A date, or a period of two dates joined by 「 〜 」, with the bracket that opens directly
 * before it and the one that closes directly after it. */
const DATED = new RegExp(String.raw`([（(]?)(${DAY})(?: 〜 (${DAY}))?([）)]?)`, "g");

/**
 * A text with each date in it ("2026-04-01", "2026-04-01 00:00") written as `<time>`: where
 * the text wraps (a cell, a heading at phone width), no date is broken inside itself
 * (primitives.css keeps a `<time>` on one line). A period ("A 〜 B") breaks, if at all, only
 * between its two dates: the dash stays with the first date and a bracket around the period
 * stays with the date it touches, so no line holds a dash or a bracket alone. The text that
 * is read is unchanged; nothing is parsed or reformatted. The text around the dates may
 * break after a 「／」 and before a 「（」 (SoftBreaks).
 */
export default function DateText({ children }: { children: string }) {
  const parts: ReactNode[] = [];
  let from = 0;
  children.replace(DATED, (whole: string, open: string, first: string, second: string | undefined, close: string, index: number) => {
    if (index > from) parts.push(<SoftBreaks key={`t${from}`}>{children.slice(from, index)}</SoftBreaks>);
    if (second) parts.push(<Fragment key={`p${index}`}><span className="ideal-v3-unbroken">{open}<time>{first}</time> 〜</span>{" "}<span className="ideal-v3-unbroken"><time>{second}</time>{close}</span></Fragment>);
    else if (open || close) parts.push(<span key={`d${index}`} className="ideal-v3-unbroken">{open}<time>{first}</time>{close}</span>);
    else parts.push(<time key={`d${index}`}>{first}</time>);
    from = index + whole.length;
    return whole;
  });
  if (from < children.length) parts.push(<SoftBreaks key={`t${from}`}>{children.slice(from)}</SoftBreaks>);
  return <>{parts}</>;
}
