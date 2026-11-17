import { currentPublication, toWorkspaceModel } from '../api/toModel';
import type { PublicationRead } from '../api/contracts';
import type { PlanningScopeSummary } from '../types';

const duty = (id: string, person: string, start: string, end: string) => ({ duty_id: id, person_id: person, kind: '日勤', task: '調剤', location: '中央病棟', start, end });
const publication: PublicationRead = {
  publication_id: 'pub-2', version: 2, period: '2026-10-12T00:00:00+09:00|2026-10-19T00:00:00+09:00', validation_status: 'verified_at_publication',
  assignments: [duty('d1', 'p-self', '2026-10-13T08:30:00+09:00', '2026-10-13T17:15:00+09:00'), duty('d2', 'p-other', '2026-10-12T08:30:00+09:00', '2026-10-12T17:15:00+09:00')],
};
const scope = (role: PlanningScopeSummary['role']): PlanningScopeSummary => ({ scope_id: 'hospital/pharmacy', display_name: '合成病院 薬剤部', person_id: 'p-self', role, input_revision: 3 });
const build = (role: PlanningScopeSummary['role'], names: Record<string, string> = {}, pub: PublicationRead | null = publication) =>
  toWorkspaceModel({ scope: scope(role), publication: pub, names, viewerName: '合成 花子', now: new Date('2026-10-12T21:00:00+09:00'),
    exportUrl: (id, format) => `https://api.example/${id}/${format}` });

test('the model holds only what the API returned: no queue, stability or coverage figures', () => {
  const model = build('LEADER', { 'p-self': '合成 花子', 'p-other': '合成 次郎' });
  expect(model.home.team.priorities).toBeNull();
  expect(model.home.team.stability).toBeNull();
  expect(model.schedule.showcaseActions).toBe(false);
  expect(model.schedule.summary).toEqual([{ tone: 'good', label: '公開勤務 2件' }]);
  expect(model.shell.scopeLabel).toBe('合成病院 薬剤部');
  expect(model.schedule.rows.map((r) => r.name)).toEqual(['合成 次郎', '合成 花子'].sort((a, b) => a.localeCompare(b, 'ja')));
});

test('a day without a published duty is shown as "—", not as leave', () => {
  const row = build('LEADER').schedule.rows.find((r) => r.id === 'p-self')!;
  expect(row.cells[0]).toMatchObject({ shift: '—', time: '' });
  expect(row.cells[1]).toMatchObject({ shift: '日勤', time: '08:30–17:15' });
});

test('a pharmacist sees their next duty and personal export links, and no other names', () => {
  const pharmacist = { ...publication, assignments: publication.assignments.filter((d) => d.person_id === 'p-self') };
  const model = build('PHARMACIST', {}, pharmacist);
  expect(model.home.personal).toMatchObject({ title: '10月13日（火） 08:30–17:15', when: '明日', countdown: '出勤まで 12時間' });
  expect(model.schedule.rows.map((r) => r.name)).toEqual(['あなた']);
  expect(model.schedule.personalExport).toEqual({ print: 'https://api.example/pub-2/print', ical: 'https://api.example/pub-2/ical' });
});

test('without a publication nothing is invented', () => {
  const model = build('ADMIN', {}, null);
  expect(model.home.team.headline.ADMIN).toBe('公開済みの勤務表はまだありません');
  expect(model.schedule.rows).toEqual([]);
  expect(model.schedule.personalExport).toBeNull();
  // no verification claim and no "good" tone without a publication
  expect(model.shell.publication.note).toBe('未公開');
  expect(model.home.team.metrics.find((m) => m.label === '検証')).toMatchObject({ value: '—', tone: 'neutral' });
  expect(JSON.stringify(model)).not.toContain('検証済み');
  expect(model.schedule.summary.some((s) => s.tone === 'good')).toBe(false);
});

test('the publication covering now is chosen, else the latest period', () => {
  const later = { ...publication, publication_id: 'pub-3', period: '2026-11-01T00:00:00+09:00|2026-12-01T00:00:00+09:00' };
  expect(currentPublication([later, publication], new Date('2026-10-14T00:00:00+09:00'))?.publication_id).toBe('pub-2');
  expect(currentPublication([publication, later], new Date('2027-01-01T00:00:00+09:00'))?.publication_id).toBe('pub-3');
  expect(currentPublication([], new Date())).toBeNull();
});

test('two duties on one day are both shown, and a pharmacist count is labelled as their own', () => {
  const night = { ...publication.assignments[0], duty_id: 'd-night', kind: '夜勤', start: '2026-10-13T20:00:00+09:00', end: '2026-10-14T08:00:00+09:00' };
  const own = { ...publication, assignments: [...publication.assignments.filter((d) => d.person_id === 'p-self'), night] };
  const model = build('PHARMACIST', {}, own);
  const cells = model.schedule.rows[0].cells.filter((c) => c.shift.includes('夜勤'));
  expect(cells).toHaveLength(1);
  expect(cells[0].shift.split('・')).toHaveLength(2);
  expect(model.schedule.details[cells[0].id].facts.some((f) => f.startsWith('夜勤 20:00–08:00'))).toBe(true);
  expect(model.schedule.summary[0].label).toMatch(/^自分の公開勤務 /);
});
