import { Check } from "lucide-react";

const STAGES = ["前提確認", "候補生成", "案比較", "確認・編集", "公開"];

/** Where a planning route stands among the five stages. Display only: each stage is its
 * own route, reached through the sub-navigation and the links of the views. */
export default function Stepper({ current }: { current: number }) {
  return <ol className="ideal-stepper" aria-label="計画の工程">{STAGES.map((name, index) => <li key={name} aria-current={index === current ? "step" : undefined} className={index === current ? "is-current" : index < current ? "is-done" : ""}><span>{index < current ? <Check aria-hidden="true" /> : index + 1}</span><strong>{name}</strong></li>)}</ol>;
}
