import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import DayCell from '@/components/DayCell';
import HolidayRequestEditor from '@/components/HolidayRequestEditor';
import ManualAssignmentEditor from '@/components/ManualAssignmentEditor';
import ScheduleMatrixView from '@/components/ScheduleMatrixView';
import ScheduleWarningsPanel from '@/components/ScheduleWarningsPanel';
import ShiftDetailDrawer from '@/components/ShiftDetailDrawer';
import type { CalendarMonthData, HolidayRequestKind } from '@/lib/types';

import { PEOPLE, scheduleResponse, scheduleRoutes, WARNINGS } from '../scheduleFixtures';

const meta: Meta = { title: '部品/シフト表の部品', parameters: { layout: 'padded', fetchRoutes: scheduleRoutes } };
export default meta;

const month = (): CalendarMonthData => {
  const r = scheduleResponse();
  const days = Array.from({ length: 31 }, (_, i) => {
    const isoDate = `2026-01-${String(i + 1).padStart(2, '0')}`;
    return { isoDate, dayNumber: i + 1, assignments: r.assignments.filter((a) => a.assignmentDate === isoDate) };
  });
  return { year: 2026, month: 1, days };
};
const KINDS: (HolidayRequestKind | undefined)[] = [undefined, 'PUBLIC_HOLIDAY_REQUEST', 'PAID_LEAVE_REQUEST', 'SUMMER_LEAVE_REQUEST', 'REFRESH_LEAVE_REQUEST'];

export const DayCells: StoryObj = {
  name: '日付のセル（休日・申請・警告・手動調整）',
  render: () => (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {month().days.slice(0, 14).map((d, i) => (
        <DayCell key={d.isoDate} isoDate={d.isoDate} dayNumber={d.dayNumber} assignments={d.assignments}
          requestKind={KINDS[i % KINDS.length]} isManuallyEdited={i % 5 === 3} isSelected={i === 2}
          warningSeverity={i % 6 === 1 ? 'critical' : i % 6 === 4 ? 'warning' : i % 6 === 5 ? 'info' : undefined} />
      ))}
    </div>
  ),
};

export const Warnings: StoryObj = { name: '警告の一覧', render: () => <ScheduleWarningsPanel warnings={WARNINGS} /> };

export const Matrix: StoryObj = { name: '職員×日付の表', render: () => <ScheduleMatrixView data={month()} availablePeople={PEOPLE} /> };

export const Detail: StoryObj = {
  name: '日付の詳細（申請・警告・手動調整）',
  render: () => {
    const day = month().days[7];
    return <ShiftDetailDrawer day={day} onClose={() => {}} holidayRequest={{ personId: 'synthetic-a', date: day.isoDate, kind: 'PAID_LEAVE_REQUEST', order: 1, isApproved: false }}
      onSaveHolidayRequest={() => {}} onDeleteHolidayRequest={() => {}} manualAssignments={day.assignments} baselineAssignments={day.assignments}
      onSaveManualAssignments={() => {}} onResetManualAssignments={() => {}} isManuallyEdited dayWarnings={WARNINGS.slice(0, 2)} availablePeople={PEOPLE} />;
  },
};

export const RequestEditor: StoryObj = {
  name: '希望休の申請',
  render: () => (
    <div className="max-w-md space-y-6">
      <HolidayRequestEditor isoDate="2026-01-08" currentRequest={null} onSave={() => {}} onDelete={() => {}} isBusy={false} error={null} />
      <HolidayRequestEditor isoDate="2026-01-09" currentRequest={{ personId: 'synthetic-a', date: '2026-01-09', kind: 'SUMMER_LEAVE_REQUEST', order: 1, isApproved: false }}
        onSave={() => {}} onDelete={() => {}} isBusy={false} error="保存できませんでした（合成の誤り）。" />
    </div>
  ),
};

export const AssignmentEditor: StoryObj = {
  name: '手動の調整',
  render: () => {
    const day = month().days[3];
    return <div className="max-w-2xl"><ManualAssignmentEditor isoDate={day.isoDate} assignments={day.assignments} baselineAssignments={day.assignments} onSave={() => {}} onReset={() => {}} isEdited availablePeople={PEOPLE} /></div>;
  },
};
