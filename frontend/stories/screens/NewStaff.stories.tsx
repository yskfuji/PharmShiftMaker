import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import NewStaffTaskList from '@/components/NewStaffTaskList';
import type { StaffRecords } from '@/lib/newStaffProgress';

// The new-staff task list in each state, with synthetic records only.
const meta: Meta = { title: '画面/新しい職員の追加', parameters: { layout: 'padded' } };
export default meta;

const person = { person_id: 'p-new', name: '合成職員D・長い氏名の表示確認' };
const site = { establishment_id: 's1', employer_id: 'e1' };
const none: StaffRecords = { people: [], sites: [], employments: [], contracts: [], capabilities: [] };
const show = (records: StaffRecords, initialPersonId = '') => <div className="planning max-w-3xl"><NewStaffTaskList records={records} scope="hospital/pharmacy" busy={false} onStart={() => {}} initialPersonId={initialPersonId} /></div>;

export const NotStarted: StoryObj = { name: '未着手（事業場も未登録）', render: () => show(none) };
export const Blocked: StoryObj = { name: '途中（氏名のみ・事業場が未登録で雇用関係を始められない）', render: () => show({ ...none, people: [person] }, person.person_id) };
export const Partial: StoryObj = { name: '途中（雇用関係まで完了）', render: () => show({ ...none, people: [person], sites: [site], employments: [{ person_id: person.person_id }] }, person.person_id) };
export const Done: StoryObj = { name: '完了（反映は勤務表・計画で行う）', render: () => show({ people: [person], sites: [site], employments: [{ person_id: person.person_id }], contracts: [{ person_id: person.person_id }], capabilities: [{ person_id: person.person_id }] }, person.person_id) };
