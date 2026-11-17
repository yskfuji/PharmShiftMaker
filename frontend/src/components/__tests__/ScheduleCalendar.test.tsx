import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import ScheduleCalendar from "@/components/ScheduleCalendar";
import { CalendarMonthData } from "@/lib/types";

const sampleCalendar: CalendarMonthData = {
  year: 2025,
  month: 4,
  days: Array.from({ length: 30 }, (_, idx) => {
    const dayNumber = idx + 1;
    const isoDate = `2025-04-${String(dayNumber).padStart(2, "0")}`;
    return {
      isoDate,
      dayNumber,
      assignments:
        dayNumber % 2 === 0
          ? [
              {
                personId: "alice",
                assignmentDate: isoDate,
                shiftId: "DAY",
              },
            ]
          : [],
    };
  }),
};

describe("ScheduleCalendar", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ requests: [] }),
      text: async () => "",
    }) as jest.Mock;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("renders a day cell for each day in the month", async () => {
    render(<ScheduleCalendar data={sampleCalendar} />);
    const dayCells = await screen.findAllByTestId("day-cell");
    expect(dayCells).toHaveLength(sampleCalendar.days.length);
  });

  it("shows detail drawer when a day is clicked", async () => {
    render(<ScheduleCalendar data={sampleCalendar} />);
    const firstCell = (await screen.findAllByTestId("day-cell"))[0];
    fireEvent.click(firstCell);
    await waitFor(() => expect(screen.getByText(/1 日の割り当て/)).toBeInTheDocument());
  });
});
