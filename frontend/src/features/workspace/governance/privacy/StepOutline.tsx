/**
 * The steps of one task that cannot be undone, shown before its first field: what the task
 * will ask in order, and at which step something is erased or fixed for good. The steps
 * and the sentence are written where the task is declared and say what its component does
 * (their numbers are the numbers of its headings); nothing here is read from the data.
 * The last step is the one that cannot be undone and is marked as such in words. A step
 * before it at which a record that cannot be taken back may be written (an outside
 * custodian's confirmation) carries its own words (`mark`), so that "nothing is erased until
 * the last step" is not read as "nothing before it is for good".
 *
 * The sentence under the steps is what is needed before the first field: when something is
 * erased, and that it cannot be restored. What a marked step writes, and whether that can be
 * recorded again or taken back (`more`), is read at that step and not before the first one:
 * it stands in a reveal under the sentence, and the step's mark is what points to it. The
 * steps are the outline's only list: what the reveal holds is sentences.
 */
export default function StepOutline({ steps, last, children, more }: {
  /** Every step but the last, in order; with `mark`, the words it carries beside it. */
  steps: Array<string | { step: string; mark: string }>;
  /** The step that cannot be undone. */
  last: string;
  /** What happens, and when: one or two sentences. */
  children: string;
  /** What a step before the last one leaves behind: a sentence each, shown on request. */
  more?: string[];
}) {
  return <div className="ideal-v3-governance-outline">
    <p className="ideal-v3-governance-outline__title">この操作の流れ</p>
    <ol className="ideal-v3-governance-outline__steps" aria-label="この操作の流れ">
      {steps.map((item, index) => { const [step, mark] = typeof item === "string" ? [item, null] : [item.step, item.mark]; return <li key={step}><span className="ideal-v3-governance-outline__number" aria-hidden="true">{index + 1}</span><span>{step}</span>{mark && <span className="ideal-pill ideal-pill--warn">{mark}</span>}</li>; })}
      <li className="is-final"><span className="ideal-v3-governance-outline__number" aria-hidden="true">{steps.length + 1}</span><span>{last}</span><span className="ideal-pill ideal-pill--danger">取り消せない手順</span></li>
    </ol>
    <p className="ideal-v3-governance-outline__note">{children}</p>
    {more && more.length > 0 && <details className="ideal-v3-disclosure ideal-v3-disclosure--info"><summary>最後の手順より前に残る記録</summary>
      {more.map((line) => <p key={line} className="ideal-v3-governance-outline__note">{line}</p>)}
    </details>}
  </div>;
}
