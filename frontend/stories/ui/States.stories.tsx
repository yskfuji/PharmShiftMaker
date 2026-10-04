import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

// Every shared control state on one page, as the business screens use them (native
// elements with the shared presentation classes). Synthetic values only.
const meta: Meta = { title: '部品/操作の状態', parameters: { layout: 'padded' } };
export default meta;

export const Controls: StoryObj = {
  name: 'ボタン・入力の状態（通常・選択・無効・処理中・誤り）',
  render: () => (
    <div className="planning max-w-4xl space-y-6">
      <section className="workflow-panel space-y-4" aria-labelledby="buttons">
        <h2 id="buttons">ボタン</h2>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="ui-button ui-button-primary">主な操作</button>
          <button type="button" className="ui-button ui-button-secondary">補助の操作</button>
          <button type="button" className="ui-button ui-button-danger">取り消す操作</button>
          <button type="button" className="ui-button ui-button-secondary" aria-pressed="true">選択中</button>
          <button type="button" className="ui-button ui-button-primary" disabled>無効（主）</button>
          <button type="button" className="ui-button ui-button-secondary" disabled>無効（補助）</button>
          <button type="button" className="ui-button ui-button-primary" aria-busy="true" disabled>保存中…</button>
          <Button>部品の主ボタン</Button>
          <Button variant="outline">部品の輪郭ボタン</Button>
        </div>
        {/* As on the business screens, a wide table scrolls inside its own named region. */}
        <div role="region" aria-label="表の中の操作の例" tabIndex={0} className="max-w-full overflow-x-auto">
          <table className="ui-data-table"><tbody><tr><td>表の中の操作</td><td><button type="button" className="ui-button ui-button-secondary ui-table-action">訂正</button></td></tr></tbody></table>
        </div>
      </section>
      <section className="workflow-panel space-y-4" aria-labelledby="inputs">
        <h2 id="inputs">入力</h2>
        <label className="block">文字（通常）<input className="ui-control block w-full" defaultValue="合成職員A" /></label>
        <label className="block">文字（無効）<input className="ui-control block w-full" defaultValue="変更できない値" disabled /></label>
        <label className="block">文字（誤り）<input className="ui-control block w-full" aria-invalid="true" aria-describedby="err" defaultValue="" /></label>
        <p id="err" className="text-danger">この項目を入力してください。</p>
        <label className="block">選択<select className="ui-control block" defaultValue="b"><option value="a">日勤</option><option value="b">夜勤</option></select></label>
        <label className="block">日付<input type="date" className="ui-control block" defaultValue="2026-01-08" /></label>
        <label className="block">日時<input type="datetime-local" className="ui-control block" defaultValue="2026-01-08T09:00" /></label>
        <label className="block">ファイル<input type="file" className="ui-control block w-full" /></label>
        <label className="block">説明<textarea className="ui-control block w-full" defaultValue={'複数行の説明。\n長い日本語の文章が折り返されることを確かめるための合成の文です。'} /></label>
        <fieldset className="workflow-fieldset border space-y-2">
          <legend>選択肢</legend>
          <label className="block"><input type="checkbox" className="ui-choice" defaultChecked />確認した</label>
          <label className="block"><input type="radio" name="kind" className="ui-choice" defaultChecked />公休</label>
          <label className="block"><input type="radio" name="kind" className="ui-choice" />有給</label>
        </fieldset>
      </section>
      <section className="workflow-panel space-y-3" aria-labelledby="status">
        <h2 id="status">状態の表示</h2>
        <div className="flex flex-wrap gap-2"><Badge>確認待ち</Badge><Badge variant="secondary">下書き</Badge><Badge variant="destructive">違反</Badge><Badge variant="outline">未確認</Badge></div>
        <p role="status">保存しました。</p>
        <p role="alert" className="text-danger">保存できませんでした。もう一度お試しください。</p>
        <details><summary>開閉の欄</summary><p>開いたときの内容です。</p></details>
      </section>
    </div>
  ),
};
