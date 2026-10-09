import ThemeToggle from "@/components/ThemeToggle";

/**
 * Personal display settings. What can be chosen here is the colours: the choice is kept in
 * this browser (a cookie), reads nothing from the server and changes every screen at once.
 * The control is the established product's own, laid out here as a field of the workspace.
 * Motion, forced colours and text spacing are not chosen here: the screens follow what the
 * device or the browser is set to, and the card says so as facts beside the one field.
 */
export default function AppearanceView() {
  return <section className="ideal-panel ideal-v3-measure" aria-labelledby="appearance-title">
    <h2 id="appearance-title">配色</h2>
    <p>この画面で変えられるのは配色です。動きなどは、端末・ブラウザーの設定に合わせて表示します。</p>
    <div className="ideal-v3-appearance-field"><ThemeToggle /></div>
    <p className="ideal-note">選ぶと、すべての画面の配色がすぐに変わります。この選択が効くのはこのブラウザーだけで、ほかの端末やブラウザーには反映されません。</p>
    <section className="ideal-v3-appearance-follows" aria-labelledby="appearance-follows-title">
      <h3 id="appearance-follows-title" className="ideal-v3-heading">端末の設定に従うもの（この画面では変えられません）</h3>
      <dl className="ideal-definition-list">
        <div><dt>動き</dt><dd>端末で「動きを減らす」設定にしていると、画面の切り替えなどの動きをなくします。</dd></div>
        <div><dt>ハイコントラスト</dt><dd>端末で強制カラー（ハイコントラスト）を使っていると、その配色で表示します。</dd></div>
        <div><dt>文字の間隔</dt><dd>ブラウザーで文字や行の間隔を広げる指定をしている場合は、その指定で表示します。</dd></div>
      </dl>
    </section>
  </section>;
}
