import { render, screen } from "@testing-library/react";

import ScheduleMatrixView from "@/components/ScheduleMatrixView";
import { CalendarMonthData } from "@/lib/types";

const sampleCalendar: CalendarMonthData = {
  year: 2025,
  month: 4,
  days: [
    {
      isoDate: "2025-04-01",
      dayNumber: 1,
      assignments: [
        { personId: "alice", assignmentDate: "2025-04-01", shiftId: "DAY_WEEKDAY" },
        { personId: "bob", assignmentDate: "2025-04-01", shiftId: "NIGHT" },
      ],
    },
    {
      isoDate: "2025-04-02",
      dayNumber: 2,
      assignments: [
        { personId: "alice", assignmentDate: "2025-04-02", shiftId: "NIGHT" },
      ],
    },
  ],
};

describe("ScheduleMatrixView", () => {
  it("renders staff rows with localized shift labels", () => {
    render(<ScheduleMatrixView data={sampleCalendar} />);

    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getAllByText("日勤（平日）")).not.toHaveLength(0);
    expect(screen.getAllByText("夜勤")).not.toHaveLength(0);
  });

  it("shows empty state when there are no assignments", () => {
    const emptyCalendar: CalendarMonthData = { ...sampleCalendar, days: sampleCalendar.days.map((day) => ({ ...day, assignments: [] })) };
    render(<ScheduleMatrixView data={emptyCalendar} />);
    expect(screen.getByText("表示できるスタッフがありません。")).toBeInTheDocument();
  });
});
