import { Fragment } from "react";

/**
 * A text of names joined by 「／」 (「職員／雇用主」) or followed by a bracket (「…センター（本館）」),
 * with a place to break after each 「／」 and before each 「（」. In a narrow cell whose words
 * are kept whole, a browser that finds no place to break in such a text breaks it wherever
 * the line ends, even before a long-vowel mark; given these places it breaks between the
 * names. The text that is read is unchanged.
 */
export default function SoftBreaks({ children }: { children: string }) {
  const pieces = children.replace(/／/g, "／\u0000").replace(/（/g, "\u0000（").split("\u0000").filter(Boolean);
  if (pieces.length < 2) return <>{children}</>;
  return <>{pieces.map((piece, index) => <Fragment key={index}>{index > 0 && <wbr />}{piece}</Fragment>)}</>;
}
