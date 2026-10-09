import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StatusPill } from "@/ideal/ui/atoms";
import { inContentFrame } from "./partsFrame";

// What a heading, a list of facts, a table, a callout, a button, a link and a pill look
// like on every workspace route. Fictitious content; nothing is sent and nothing is decided.
const PEOPLE = [
  { name: "高橋 葵", start: "2026-10-12 08:30", work: "2026-10-12 08:30 〜 2026-10-12 17:45", rest: "2026-10-12 12:00 〜 2026-10-12 13:00", place: "薬剤部・調剤室", kind: "日勤", version: 2, reviewed: true },
  { name: "鈴木 悠斗", start: "2026-10-12 10:30", work: "2026-10-12 10:30 〜 2026-10-12 19:30", rest: "なし", place: "本館・病棟", kind: "遅番", version: 1, reviewed: false },
  { name: "佐藤 美咲", start: "2026-10-13 08:30", work: "2026-10-13 08:30 〜 2026-10-13 17:30", rest: "2026-10-13 12:00 〜 2026-10-13 13:00", place: "薬剤部・調剤室", kind: "日勤", version: 3, reviewed: true },
  { name: "田中 蓮", start: "2026-10-13 16:30", work: "2026-10-13 16:30 〜 2026-10-14 09:00", rest: "2026-10-14 01:00 〜 2026-10-14 03:00", place: "本館・救急", kind: "夜勤", version: 1, reviewed: false },
];

function Headings() {
  return <section className="ideal-panel" aria-labelledby="primitives-headings">
    <h2 id="primitives-headings">見出し（パネルの題）</h2>
    <p>パネルの中の文章は、表や注記と同じ大きさです。1行が長くなりすぎないように、幅に上限があります。この段落は、その上限を確かめるために、わざと長く書いてあります。</p>
    <div className="ideal-v3-record">
      <section aria-labelledby="primitives-h3-a">
        <h3 id="primitives-h3-a" className="ideal-v3-heading">節の見出し（h3）</h3>
        <p className="ideal-note">節の中身は、見出しより少し内側に置きます。これは注記の文です。</p>
        <h4 className="ideal-v3-heading">小見出し（h4）</h4>
        <p className="ideal-note">登録されている記録はありません。</p>
        <h4 className="ideal-v3-heading">小見出し（h4）その2</h4>
        <ul className="ideal-note-list"><li>印の付いた一覧の1行目です。</li><li>印の付いた一覧の2行目です。</li></ul>
        <h4 className="ideal-v3-heading">1項目だけの一覧</h4>
        <ul className="ideal-note-list"><li>氏名・職員IDは表示しません。</li></ul>
      </section>
      <section aria-labelledby="primitives-h3-b">
        <h3 id="primitives-h3-b" className="ideal-v3-heading">次の節（罫線で区切る）</h3>
        <p className="ideal-done" role="status">完了の表示：第3版として保存しました。</p>
      </section>
    </div>
  </section>;
}

function Facts() {
  return <section className="ideal-panel" aria-labelledby="primitives-facts">
    <h2 id="primitives-facts">項目と値の一覧</h2>
    <dl className="ideal-definition-list">
      <div><dt>対象</dt><dd>東都医療センター・薬剤部</dd></div>
      <div><dt>適用期間</dt><dd>2026-10-01 から 2027-03-31 まで</dd></div>
      <div><dt>変更内容</dt><dd><ul><li>所定労働時間：7時間45分 → 8時間</li><li>休憩：45分 → 60分</li></ul></dd></div>
      <div><dt>長い値</dt><dd>synthetic-manifest-sha256-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef</dd></div>
    </dl>
    <div className="ideal-v3-measure">
      <label className="ideal-field-label" htmlFor="primitives-search">職員を検索</label>
      <input id="primitives-search" className="ideal-input" type="search" defaultValue="" />
      <p role="status">3名を表示</p>
    </div>
  </section>;
}

function Tables() {
  return <section className="ideal-panel" aria-labelledby="primitives-tables">
    <h2 id="primitives-tables">表</h2>
    <div className="ideal-table-wrap" role="region" aria-label="8列の表" tabIndex={0}><table className="ideal-table">
      <thead><tr><th scope="col">職員</th><th scope="col">勤務の開始（日本時間）</th><th scope="col">実労働</th><th scope="col">休憩</th><th scope="col">業務・場所</th><th scope="col">区分</th><th scope="col">版</th><th scope="col">照合の記録</th></tr></thead>
      <tbody>{PEOPLE.map((row) => <tr key={row.name}>
        <th scope="row">{row.name}</th><td>{row.start}</td><td>{row.work}</td><td>{row.rest}</td><td>{row.place}</td><td>{row.kind}</td><td>第{row.version}版</td>
        <td><StatusPill tone={row.reviewed ? "good" : "warn"}>{row.reviewed ? "現在の版に記録あり" : "未記録"}</StatusPill></td>
      </tr>)}</tbody>
    </table></div>
    <div className="ideal-table-wrap" role="region" aria-label="3列の表" tabIndex={0}><table className="ideal-table">
      <thead><tr><th scope="col">項目</th><th scope="col">状態</th><th scope="col">操作</th></tr></thead>
      <tbody>
        <tr><th scope="row">本人アカウント</th><td><StatusPill tone="good">有効</StatusPill></td><td><button type="button" className="ideal-button ideal-button--secondary">無効にする</button></td></tr>
        <tr><th scope="row">自分自身の所属</th><td><StatusPill>変更不可</StatusPill></td><td>自分自身の所属は無効にできません。別の管理者に依頼してください。この文は、表の中の長い文章が折り返す幅を確かめるためのものです。</td></tr>
      </tbody>
    </table></div>
    <details className="ideal-v3-disclosure ideal-v3-disclosure--info"><summary>識別情報</summary><ul className="ideal-note-list"><li>高橋 葵：原本の識別子 synthetic-clock-1</li><li>鈴木 悠斗：原本の識別子 synthetic-clock-2</li></ul></details>
  </section>;
}

function Callouts() {
  return <section className="ideal-panel" aria-labelledby="primitives-callouts">
    <h2 id="primitives-callouts">注意書き</h2>
    <p className="ideal-v3-callout">知らせ：サーバーが返したあなたの権限は部署管理者です。</p>
    <p className="ideal-v3-callout ideal-v3-callout--warn">注意：確認が済んでいない採用が1件あります。</p>
    <section className="ideal-note" role="alert"><h3>指定されたケースを表示できません</h3><p>この施設・部署で参照できないか、状態が変わりました。一覧から選び直してください。</p><button type="button" className="ideal-button ideal-button--secondary">一覧の先頭を開く</button></section>
    <section className="ideal-partial-problems" role="status" aria-labelledby="primitives-partial"><h2 id="primitives-partial">一部の情報を更新できませんでした</h2><p>取得できた情報は表示しています。判断前に不足箇所を確認してください。</p><ul><li><strong>people</strong>（503）: 合成の応答です。</li></ul><button type="button" className="ideal-button ideal-button--secondary">不足情報を再読込み</button></section>
    <div className="ideal-confirm"><h3>公開取消の確認</h3><p>勤務の再調整と関係者への通知が必要です。取消前の版と監査記録は残ります。</p><label>理由<textarea className="ideal-input" defaultValue="" /></label><div className="ideal-actions"><button type="button" className="ideal-button ideal-button--danger">公開を取り消す</button><button type="button" className="ideal-button ideal-button--danger" disabled>公開を取り消す（無効）</button><button type="button" className="ideal-button ideal-button--secondary">やめる</button></div></div>
  </section>;
}

function Controls() {
  return <section className="ideal-panel" aria-labelledby="primitives-controls">
    <h2 id="primitives-controls">ボタン・リンク・札</h2>
    <div className="ideal-actions">
      <button type="button" className="ideal-button ideal-button--primary">保存する</button>
      <button type="button" className="ideal-button ideal-button--secondary">入力に戻る</button>
      <button type="button" className="ideal-button ideal-button--danger">公開を取り消す</button>
    </div>
    <div className="ideal-actions">
      <button type="button" className="ideal-button ideal-button--primary" disabled>保存する（無効）</button>
      <button type="button" className="ideal-button ideal-button--secondary" disabled>入力に戻る（無効）</button>
      <button type="button" className="ideal-button ideal-button--danger" disabled>公開を取り消す（無効）</button>
    </div>
    <p>文中のリンクは1色です：<a className="ideal-inline-link" href="#primitives-controls">監査の履歴を開く</a>。ボタンの形のリンクもあります。</p>
    <div className="ideal-actions"><a className="ideal-button ideal-button--secondary" href="#primitives-controls">監査の履歴を開く</a><button type="button" className="ideal-link ideal-link--target">照合を記録する</button></div>
    <article className="ideal-v3-detail"><span className="ideal-eyebrow">選択中の職員</span><h3>佐藤 美咲</h3><nav aria-label="選択職員の詳細"><a href="#primitives-controls">本人アカウント</a><a href="#primitives-controls">契約・資格</a><a href="#primitives-controls">入職・退職</a></nav></article>
    <div className="ideal-actions">
      <StatusPill>変更なし</StatusPill><StatusPill tone="good">確認済み</StatusPill><StatusPill tone="warn">確認待ち 2件</StatusPill><StatusPill tone="danger">指摘あり</StatusPill><StatusPill tone="info">進行中</StatusPill>
    </div>
    <div className="ideal-schedule-summary">
      <span><i className="ideal-dot ideal-dot--neutral" />変更なし</span><span><i className="ideal-dot ideal-dot--good" />確認済み</span><span><i className="ideal-dot ideal-dot--warn" />確認待ち</span><span><i className="ideal-dot ideal-dot--danger" />指摘あり</span><span><i className="ideal-dot ideal-dot--info" />進行中</span><span><i className="ideal-dot ideal-dot--new" />新規</span>
    </div>
  </section>;
}

// A check box and a radio button in each state, in the three places the routes put them: a
// check with its sentence, a switch of a filter, a radio of a choice. Uncontrolled; nothing
// is decided by them.
function Choices() {
  return <section className="ideal-panel" aria-labelledby="primitives-choices">
    <h2 id="primitives-choices">チェックと選択</h2>
    <label className="ideal-switch"><input type="checkbox" /><span>無効も表示</span></label>
    <div className="ideal-form">
      <div className="ideal-inline-field"><span className="ideal-check-target"><input id="primitives-check-off" type="checkbox" /></span><label htmlFor="primitives-check-off">未選択のチェック：就業規則の該当条項を確認しました。</label></div>
      <div className="ideal-inline-field"><span className="ideal-check-target"><input id="primitives-check-on" type="checkbox" defaultChecked /></span><label htmlFor="primitives-check-on">選択済みのチェック：長い文は、チェックの横で折り返します。この文は、その折り返しを確かめるために、わざと長く書いてあります。</label></div>
      <div className="ideal-inline-field"><span className="ideal-check-target"><input id="primitives-check-disabled" type="checkbox" disabled /></span><label htmlFor="primitives-check-disabled">選べないチェック（無効）</label></div>
      <div className="ideal-inline-field"><span className="ideal-check-target"><input id="primitives-check-disabled-on" type="checkbox" disabled defaultChecked /></span><label htmlFor="primitives-check-disabled-on">選べないチェック（無効・選択済み）</label></div>
      <fieldset className="ideal-fieldset"><legend>手続きの種類</legend>
        <label className="ideal-radio"><input type="radio" name="primitives-radio" />入職</label>
        <label className="ideal-radio"><input type="radio" name="primitives-radio" defaultChecked />退職</label>
        <label className="ideal-radio"><input type="radio" name="primitives-radio" disabled />選べない種類（無効）</label>
        <label className="ideal-radio"><input type="radio" name="primitives-radio-fixed" disabled defaultChecked />選べない種類（無効・選択済み）</label>
      </fieldset>
    </div>
  </section>;
}

function Story() {
  return <div className="ideal-stack"><Headings /><Facts /><Tables /><Callouts /><Controls /><Choices /></div>;
}

const meta = {
  title: "Ideal UI v3/Parts/Primitives",
  component: Story,
  decorators: [inContentFrame],
} satisfies Meta<typeof Story>;

export default meta;
type StoryOf = StoryObj<typeof meta>;

export const All: StoryOf = { name: "01 見出し・一覧・表・注意書き・ボタン・チェック" };
