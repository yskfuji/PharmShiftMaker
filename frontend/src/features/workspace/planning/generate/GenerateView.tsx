import { useId } from "react";
import { StatusPill } from "@/ideal/ui/atoms";
import Stepper from "../Stepper";
import GenerateJobs from "./GenerateJobs";

export type GenerateData = { revision: number; inputHash: string; stale: boolean };

/** Three plans from one input version. A stale input is said here and cannot be used. */
export default function GenerateView({ data }: { data: GenerateData }) {
  const id = useId();
  return <div className="ideal-stack">
    <Stepper current={1} />
    <section className="ideal-toolbar"><div><span className="ideal-eyebrow">入力版 {data.revision}</span><h2>同じ前提から3案を作成</h2><p>優先順は固定し、探索の乱数種だけを変えます。同じ案は重複として表示します。</p></div><StatusPill tone={data.stale ? "warn" : "good"}>{data.stale ? "入力が古い" : "生成可能"}</StatusPill></section>
    <section className="ideal-panel" aria-labelledby={`${id}-generate`}><h2 id={`${id}-generate`}>候補生成</h2>
      <GenerateJobs inputHash={data.inputHash} stale={data.stale} />
    </section>
  </div>;
}
