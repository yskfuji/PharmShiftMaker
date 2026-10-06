import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StatusPill } from "@/ideal/ui/atoms";
import SectionNav from "@/features/workspace/shared/SectionNav";
import TaskJump from "@/features/workspace/shared/TaskJump";
import { inContentFrame } from "./partsFrame";

// The sections of a long route as a row of buttons under its header. A button puts the focus
// on the heading of its section and brings it into view; a heading inside a closed reveal is
// reached by opening the reveal first. Nothing is sent (synthetic example).
function Story() {
  return <div className="ideal-stack">
    <section className="ideal-toolbar">
      <div><h2>記録の状態と次の操作</h2><p>長い画面の節へ、冒頭のボタンから移ります（合成の表示例）。</p></div>
      <div className="ideal-v3-badge-action"><StatusPill tone="warn">サーバーの検証で不整合 1件</StatusPill><TaskJump target="section-nav-story-result">検証結果を見る</TaskJump></div>
    </section>
    <SectionNav items={[
      { target: "section-nav-story-current", label: "現在の状態", meta: "職員3名・契約2件" },
      { target: "section-nav-story-next", label: "次の操作", meta: "登録・変更の操作 14件" },
      { target: "section-nav-story-folded", label: "施設の記録", meta: "閉じた開閉欄の中" },
    ]} />
    <section className="ideal-panel" aria-labelledby="section-nav-story-current">
      <h2 id="section-nav-story-current" className="ideal-v3-section-nav__target" tabIndex={-1}>現在の状態</h2>
      <div className="ideal-v3-record">
        <section aria-labelledby="section-nav-story-result">
          <h3 id="section-nav-story-result" className="ideal-v3-heading ideal-v3-section-nav__target" tabIndex={-1}>サーバーの検証結果</h3>
          <p className="ideal-v3-callout ideal-v3-callout--warn">編集中の記録に不整合があります（合成の表示例）。</p>
        </section>
        <section aria-label="開閉欄の中の節">
          <details className="ideal-v3-disclosure ideal-v3-disclosure--info">
            <summary>施設の記録を表で見る（2件）</summary>
            <div className="ideal-v3-record">
              <h3 id="section-nav-story-folded" className="ideal-v3-heading ideal-v3-section-nav__target" tabIndex={-1}>施設の記録</h3>
              <p className="ideal-note">開閉欄の中の見出しへは、開閉欄を開いてから移ります（合成の表示例）。</p>
            </div>
          </details>
        </section>
      </div>
    </section>
    <section className="ideal-panel" aria-labelledby="section-nav-story-next">
      <h2 id="section-nav-story-next" className="ideal-v3-section-nav__target" tabIndex={-1}>次の操作</h2>
      <p className="ideal-note">ここに操作の一覧が並びます（合成の表示例）。</p>
    </section>
  </div>;
}

const meta = {
  title: "Ideal UI v3/Parts/SectionNav",
  component: Story,
  decorators: [inContentFrame],
} satisfies Meta<typeof Story>;

export default meta;
type StoryOf = StoryObj<typeof meta>;

export const Sections: StoryOf = { name: "01 節への移動" };
