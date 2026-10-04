import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import FlexSettlementPanel from '@/components/FlexSettlementPanel';
import MonthlySchedule from '@/components/MonthlySchedule';

// Planning parts with duties drawn (the audit app's synthetic input has no draft).
const meta: Meta = { title: '画面/勤務計画の部品', parameters: { layout: 'padded' } };
export default meta;

const people = [{ person_id: 'p0', name: '合成職員A' }, { person_id: 'p1', name: '合成職員B・長い氏名の表示確認' }, { person_id: 'p2', name: '合成職員C' }];
const duties = [0, 1, 2, 3, 5].flatMap((d) => ['p0', 'p1'].map((p, i) => ({
  duty_id: `${p}-${d}`, person_id: p, kind: i ? '日勤' : '夜勤', task: '調剤', location: '薬剤部',
  start: `2026-01-${String(5 + d).padStart(2, '0')}T0${i ? 9 : 8}:00:00+09:00`, end: `2026-01-${String(5 + d).padStart(2, '0')}T17:00:00+09:00` })));

export const Monthly: StoryObj = {
  name: '月間勤務表（下書き・フレックスの職員を含む）',
  render: () => <MonthlySchedule people={people} duties={duties} previous={duties.slice(2)} period={{ start: '2026-01-05T00:00:00+09:00', end: '2026-01-12T00:00:00+09:00' }}
    draft published={false} flexPeople={['p2']} />,
};

export const Settlement: StoryObj = {
  name: 'フレックスタイム制の清算',
  parameters: { fetchRoutes: [{ path: '/planning/compliance/flex-settlements', body: {
    input_hash: 'h', findings: [{ status: 'unverified', rule_id: 'work.v2.input', message: 'Flextime adoption work rules, agreement or filing unverified: flex-1' }],
    people: [{ person_id: 'p2', name: '合成職員C', settlements: [{ kind: 'flextime', start: '2026-04-01', end: '2026-07-01', frame_seconds: 1872000, worked_seconds: 1944000,
      monthly_overtime_seconds: { '2026-04-01': 20572 }, final_month_overtime_seconds: 51428, unattributed_seconds: 0 }] }] } }] },
  render: () => <FlexSettlementPanel scope="hospital/pharmacy" inputHash="h" />,
};
