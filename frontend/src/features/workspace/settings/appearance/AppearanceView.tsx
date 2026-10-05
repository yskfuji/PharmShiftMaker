import ThemeToggle from "@/components/ThemeToggle";

/** Personal display settings. They are kept in this browser and read nothing from the server. */
export default function AppearanceView() {
  return <section className="ideal-panel" aria-labelledby="appearance-title"><span className="ideal-eyebrow">表示</span><h2 id="appearance-title">外観と動き</h2><p>端末設定を初期値として、明るい配色と暗い配色を選べます。動きを減らす設定、強制色、文字間隔の指定は端末・ブラウザの設定を尊重します。</p><div className="ideal-actions"><ThemeToggle /></div></section>;
}
