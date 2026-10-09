import { fireEvent, render, screen } from "@testing-library/react";
import { fromJstInput, jstOffsetText, jstText, toJstInput } from "../jst";
import JstDateTimeField from "../JstDateTimeField";

test("an instant is entered and read in Japan time, whatever the local time zone", () => {
  expect(toJstInput("2026-01-05T00:00:00.000Z")).toBe("2026-01-05T09:00");
  expect(toJstInput("2026-01-05T09:00:00+09:00")).toBe("2026-01-05T09:00");
  expect(toJstInput("2025-12-31T15:00:01Z")).toBe("2026-01-01T00:00:01");
  expect(fromJstInput("2026-01-05T09:00")).toBe("2026-01-05T00:00:00.000Z");
  expect(fromJstInput("2026-01-01T00:00:01")).toBe("2025-12-31T15:00:01.000Z");
  expect(jstText("2026-01-05T08:30:00Z")).toBe("2026-01-05 17:30");
});

test("nothing, or something that is not an instant, is empty rather than a guess", () => {
  for (const value of ["", null, undefined, 12, "not a date"]) expect(toJstInput(value)).toBe("");
  expect(fromJstInput("")).toBe("");
  expect(fromJstInput("2026-13-40T99:00")).toBe("");
  expect(jstText(null)).toBe("");
});

test("the field shows the instant in Japan time and reports the instant entered", () => {
  const onChange = jest.fn();
  render(<JstDateTimeField label="適用開始（日本時間）" value="2026-01-05T00:00:00.000Z" onChange={onChange} required />);
  const field = screen.getByLabelText("適用開始（日本時間）");
  // The form the browser reports, so React does not write the field again on every render.
  expect(field).toHaveValue("2026-01-05T09:00");
  expect(field).toBeRequired();
  expect(field).toHaveAttribute("step", "1");
  fireEvent.change(field, { target: { value: "2026-01-05T17:00" } });
  expect(onChange).toHaveBeenLastCalledWith("2026-01-05T08:00:00.000Z");
  fireEvent.change(field, { target: { value: "" } });
  expect(onChange).toHaveBeenLastCalledWith("");
});

test("an instant is written with the Japan offset to the second, as the leave and ledger records hold it", () => {
  expect(jstOffsetText("2026-01-06T00:00:00.000Z")).toBe("2026-01-06T09:00:00+09:00");
  expect(jstOffsetText(fromJstInput("2026-01-07T12:00:05"))).toBe("2026-01-07T12:00:05+09:00");
  expect(jstOffsetText("")).toBe("");
});
