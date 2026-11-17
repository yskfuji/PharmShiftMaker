// Synthetic schedule data for stories (no real staff; names are 合成職員…).
import type { ScheduleGenerateResponse, ScheduleWarning } from '@/lib/types';
import { identityRoute } from './fixtures';

export const PEOPLE = ['synthetic-a', 'synthetic-b', 'synthetic-c', 'synthetic-d'];
const SHIFTS = ['DAY_SHIFT', 'EVENING_SHIFT', 'NIGHT_DUTY', 'OFF', 'DAY_SHIFT', 'WARD', 'ON_CALL'];

export const WARNINGS: ScheduleWarning[] = [
  { code: 'coverage', severity: 'critical', message: '1月8日の夜勤が1人不足しています。', context: { date: '2026-01-08' } },
  { code: 'consecutive', severity: 'warning', message: '合成職員Bの連続勤務が6日に達しています。', context: { date: '2026-01-12', person_id: 'synthetic-b' } },
  { code: 'info', severity: 'info', message: '希望休を3件反映しました。', context: {} },
];

export const scheduleResponse = (): ScheduleGenerateResponse => {
  const assignments = [];
  for (let day = 1; day <= 31; day++) {
    const date = `2026-01-${String(day).padStart(2, '0')}`;
    for (let i = 0; i < PEOPLE.length; i++) assignments.push({ personId: PEOPLE[i], assignmentDate: date, shiftId: SHIFTS[(day + i) % SHIFTS.length] });
  }
  return { year: 2026, month: 1, trialMode: true, generatedAt: '2026-09-28T00:00:00Z', totalAssignments: assignments.length, assignments, warnings: WARNINGS, lockVersion: 3 };
};

export const staff = { total: 4, items: PEOPLE.map((id, i) => ({ person_id: id, name: `合成職員${'ABCD'[i]}`, role: i === 3 ? 'パート薬剤師' : '薬剤師', current_status: 'active' })) };
export const holidayRequests = { requests: [
  { person_id: 'synthetic-a', date: '2026-01-05', kind: 'PAID_LEAVE_REQUEST', order: 1, is_approved: false },
  { person_id: 'synthetic-a', date: '2026-01-14', kind: 'SUMMER_LEAVE_REQUEST', order: 2, is_approved: false },
  { person_id: 'synthetic-a', date: '2026-01-21', kind: 'REFRESH_LEAVE_REQUEST', order: 3, is_approved: true },
  { person_id: 'synthetic-a', date: '2026-01-27', kind: 'PUBLIC_HOLIDAY_REQUEST', order: 4, is_approved: false },
] };
export const leaveQuotas = { year: 2026, month: 1, items: PEOPLE.flatMap((id, i) => (['PAID_LEAVE_REQUEST', 'SUMMER_LEAVE_REQUEST', 'REFRESH_LEAVE_REQUEST'] as const).map((kind, k) => ({
  person_id: id, person_name: `合成職員${'ABCD'[i]}`, year: 2026, month: 1, kind, total_days: 10 - k * 3, used_days: (i + k) % 3, used_before_month: k, remaining_days: 10 - k * 3 - ((i + k) % 3) - k }))) };

export const scheduleRoutes = [
  identityRoute,
  // The legacy (unscoped) screens resolve the viewer's person through this projection.
  { path: '/auth/legacy-context', body: { person_id: 'synthetic-a' } },
  { path: /\/holiday-requests\//, body: holidayRequests },
  { path: /\/staff$/, body: staff },
  { path: /\/leave-quotas$/, body: leaveQuotas },
];
