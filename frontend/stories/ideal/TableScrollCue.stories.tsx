import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import TableScrollCue from "@/features/workspace/shared/TableScrollCue";
import { StatusPill } from "@/ideal/ui/atoms";
import { inPartsFrame } from "./partsFrame";

// The line above a table whose columns run on past its region. Fictitious rows. The first
// table has few columns and fits where there is room; the second has eight and overflows at
// every width a card has. The line names the columns whose content is cut, by their own
// headers. Scroll the second to its end and the line is no longer drawn.
const ROWS = [
  { name: "高橋 葵", start: "2026-10-12 08:30", work: "2026-10-12 08:30 〜 2026-10-12 17:45", rest: "2026-10-12 12:00 〜 2026-10-12 13:00", place: "薬剤部・調剤室", kind: "日勤", version: 2, reviewed: true },
  { name: "鈴木 悠斗", start: "2026-10-12 10:30", work: "2026-10-12 10:30 〜 2026-10-12 19:30", rest: "なし", place: "本館・病棟", kind: "遅番", version: 1, reviewed: false },
  { name: "佐藤 美咲", start: "2026-10-13 08:30", work: "2026-10-13 08:30 〜 2026-10-13 17:30", rest: "2026-10-13 12:00 〜 2026-10-13 13:00", place: "薬剤部・調剤室", kind: "日勤", version: 3, reviewed: true },
];

function Story({ narrow = false }: { narrow?: boolean }) {
  // `narrow`: a column 44rem wide, so the second table overflows on a wide screen too, where
  // the row header is pinned and the scrolled cells pass under it.
  return <div className="ideal-v3-record" style={narrow ? { maxWidth: "44rem" } : undefined}>
    <section aria-labelledby="scroll-cue-story-narrow">
      <h3 id="scroll-cue-story-narrow" className="ideal-v3-heading">3列の表（幅があれば収まる）</h3>
      <TableScrollCue />
      <div className="ideal-table-wrap" role="region" aria-label="3列の表" tabIndex={0}><table className="ideal-table">
        <thead><tr><th scope="col">職員</th><th scope="col">区分</th><th scope="col">状態</th></tr></thead>
        <tbody>{ROWS.map((row) => <tr key={row.name}><th scope="row">{row.name}</th><td>{row.kind}</td><td><StatusPill tone={row.reviewed ? "good" : "warn"}>{row.reviewed ? "確認済み" : "未記録"}</StatusPill></td></tr>)}</tbody>
      </table></div>
    </section>
    <section aria-labelledby="scroll-cue-story-wide">
      <h3 id="scroll-cue-story-wide" className="ideal-v3-heading">8列の表（右に続く）</h3>
      <TableScrollCue />
      <div className="ideal-table-wrap" role="region" aria-label="8列の表" tabIndex={0}><table className="ideal-table">
        <thead><tr><th scope="col">職員</th><th scope="col">勤務の開始（日本時間）</th><th scope="col">実労働</th><th scope="col">休憩</th><th scope="col">業務・場所</th><th scope="col">区分</th><th scope="col">版</th><th scope="col">照合の記録</th></tr></thead>
        <tbody>{ROWS.map((row) => <tr key={row.name}>
          <th scope="row">{row.name}</th><td><time>{row.start}</time></td><td>{row.work}</td><td>{row.rest}</td><td>{row.place}</td><td>{row.kind}</td><td>第{row.version}版</td>
          <td><StatusPill tone={row.reviewed ? "good" : "warn"}>{row.reviewed ? "現在の版に記録あり" : "未記録"}</StatusPill></td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </div>;
}

const meta = {
  title: "Ideal UI v3/Parts/TableScrollCue",
  component: Story,
  decorators: [inPartsFrame],
} satisfies Meta<typeof Story>;

export default meta;
type StoryOf = StoryObj<typeof meta>;

export const Plain: StoryOf = { name: "01 右に続く表の案内", args: {} };
export const Pinned: StoryOf = { name: "02 狭い列の中（広い画面でも右に続く）", args: { narrow: true } };
export const AtEnd: StoryOf = { name: "03 右端まで動かした後（案内は描かない）", args: { narrow: true }, play: async ({ canvasElement }) => { for (const region of canvasElement.querySelectorAll<HTMLElement>(".ideal-table-wrap")) region.scrollLeft = region.scrollWidth; } };
