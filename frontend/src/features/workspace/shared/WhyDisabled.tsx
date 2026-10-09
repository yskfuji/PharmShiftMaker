/** Said under a button that asks for the evidence of a change (EvidenceFields: a reason and a
 * reference of three characters each) while that evidence is not entered yet. */
export const EVIDENCE_NEEDED = "理由と参照を3文字以上入力すると押せます。";

/**
 * Why a button cannot be pressed yet, as one sentence about what the person has still to
 * enter or choose (「理由と参照を3文字以上入力すると押せます。」), under the buttons. The button
 * names it as its description: `aria-describedby={why ? id : undefined}` with the same `id`.
 * Nothing is drawn while there is no reason to give (the button can be pressed, or something
 * is being sent). It never states a condition the component does not itself decide: what
 * the server refuses is said in the server's words where it answers.
 */
export default function WhyDisabled({ id, children }: { id: string; children?: string | null | false }) {
  return children ? <p id={id} className="ideal-v3-why-disabled">{children}</p> : null;
}
