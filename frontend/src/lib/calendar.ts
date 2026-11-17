import {
  CalendarMonthData,
  DayAssignments,
  ScheduleAssignment,
  ScheduleGenerateResponse,
} from "@/lib/types";

/** Presentation intervals only: no work-time or entitlement calculation. */
export function monthInterval(month: string): {start: string; end: string} | undefined {
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000-') || month === '9999-12') return undefined;
  const [year, number] = month.split('-').map(Number);
  const next = `${String(year + (number === 12 ? 1 : 0)).padStart(4,'0')}-${String(number % 12 + 1).padStart(2,'0')}`;
  return {start:`${month}-01T00:00:00+09:00`, end:`${next}-01T00:00:00+09:00`};
}

export function overlapsDisplay(a: {start:string;end:string}, b: {start:string;end:string}): boolean {
  return Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
}

/** Publication IDs are presentation provenance; business duty IDs stay intact.
 * Only the same planning period is a draft comparison baseline. Other periods'
 * overlapping duties remain fixed context, never additions or deletions. */
export function publicationCalendar<T extends {duty_id:string;start:string;end:string}>(
  publications: {publication_id:string;period:string;assignments:T[]}[],
  period?: {start:string;end:string},
) {
  const all: (T & {display_key:string})[] = [], comparison: (T & {display_key:string})[] = [], fixed: (T & {display_key:string})[] = [];
  for (const publication of publications) {
    const [start,end] = publication.period.split('|');
    const same = !!period && Date.parse(start) === Date.parse(period.start) && Date.parse(end) === Date.parse(period.end);
    for (const duty of publication.assignments) {
      if (period && !overlapsDisplay(duty,period)) continue;
      const displayed = {...duty,display_key:JSON.stringify(['publication',publication.publication_id,duty.duty_id])};
      all.push(displayed); (same ? comparison : fixed).push(displayed);
    }
  }
  return {all,comparison,fixed};
}

export function buildCalendarData(response: ScheduleGenerateResponse): CalendarMonthData {
  const assignmentsByDate: Record<string, ScheduleAssignment[]> = {};
  for (const assignment of response.assignments) {
    assignmentsByDate[assignment.assignmentDate] ??= [];
    assignmentsByDate[assignment.assignmentDate].push(assignment);
  }

  const daysInMonth = new Date(response.year, response.month, 0).getDate();
  const days: DayAssignments[] = Array.from({ length: daysInMonth }, (_, index) => {
    const dayNumber = index + 1;
    const isoDate = new Date(Date.UTC(response.year, response.month - 1, dayNumber))
      .toISOString()
      .slice(0, 10);
    return {
      isoDate,
      dayNumber,
      assignments: assignmentsByDate[isoDate] ?? [],
    };
  });

  return {
    year: response.year,
    month: response.month,
    days,
  };
}
