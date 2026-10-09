import * as screens from "@/ideal/live/format";
import { dutyWhen, isReadableWhen, periodText, stamp, UNREADABLE_TIME, whenText, wholeDaysText } from "../format";

test("a readable value is written by the screens' two formatters, whatever the offset it was sent in", () => {
  for (const value of ["2026-10-12T07:42:00+09:00", "2026-10-11T22:42:00Z", "2026-10-12T07:42:00.123456+09:00", "2026-10-12"]) expect(stamp(value)).toBe(screens.stamp(value));
  expect(stamp("2026-10-12T07:42:00+09:00")).toBe("10/12 07:42");
  expect(dutyWhen("2026-10-12T08:30:00+09:00", "2026-10-12T17:30:00+09:00")).toBe(screens.dutyWhen("2026-10-12T08:30:00+09:00", "2026-10-12T17:30:00+09:00"));
  expect(dutyWhen("2026-10-11T23:30:00Z", "2026-10-12T08:30:00Z")).toBe("10月12日（月） 08:30–17:30");
});

test("an unreadable value is named as unread where the screens' formatters throw", () => {
  for (const value of [undefined, "", "未定", "2026-13-45T99:00:00", {}]) expect(() => screens.stamp(value as string)).toThrow();
  // Nothing and a number are not instants either (the screens' formatter reads them as 1970).
  for (const value of [undefined, null, "", "未定", "2026-13-45T99:00:00", 20261012, {}]) {
    expect(stamp(value)).toBe(UNREADABLE_TIME);
    expect(dutyWhen(value, "2026-10-12T17:30:00+09:00")).toBe(UNREADABLE_TIME);
    expect(dutyWhen("2026-10-12T08:30:00+09:00", value)).toBe(UNREADABLE_TIME);
  }
  expect(stamp(undefined, "—")).toBe("—");
  expect(dutyWhen(null, null, "勤務の日時未確認")).toBe("勤務の日時未確認");
});

test("an instant is read in Japan time, with its weekday, whatever the offset it was sent in", () => {
  expect(whenText("2026-10-12T08:30:00+09:00")).toBe("10月12日（月）08:30");
  expect(whenText("2026-10-11T23:30:00Z")).toBe("10月12日（月）08:30");
});

test("a value that is not an instant is named as unread, and never thrown on", () => {
  for (const value of [undefined, null, "", "対象日時未確認", 20261012, {}]) expect(whenText(value)).toBe(UNREADABLE_TIME);
  expect(whenText(undefined, "対象日時未確認")).toBe("対象日時未確認");
  expect(periodText("2026-10-01T00:00:00+09:00", undefined)).toBe(UNREADABLE_TIME);
  expect(periodText(null, "2026-10-01T00:00:00+09:00", "期間未確認")).toBe("期間未確認");
});

test("a period shows both ends as they were sent; the end repeats only what differs", () => {
  // Midnight to midnight is shown as such: the end is not turned into the day before.
  expect(periodText("2026-10-01T00:00:00+09:00", "2026-11-01T00:00:00+09:00")).toBe("2026年10月1日（木）00:00 〜 11月1日（日）00:00");
  expect(periodText("2026-10-12T08:30:00+09:00", "2026-10-12T17:30:00+09:00")).toBe("2026年10月12日（月）08:30 〜 17:30");
  expect(periodText("2026-12-31T22:00:00+09:00", "2027-01-01T07:00:00+09:00")).toBe("2026年12月31日（木）22:00 〜 2027年1月1日（金）07:00");
});

test("a surface can ask whether its dates were read: exactly the values the formatters name as unread are not", () => {
  const readable = ["2026-10-12T07:42:00+09:00", "2026-10-11T22:42:00Z", "2026-10-12"];
  const unreadable = [undefined, null, "", "未定", "2026-13-45T99:00:00", 20261012, {}];
  for (const value of readable) {
    expect(isReadableWhen(value)).toBe(true);
    expect(stamp(value)).not.toBe(UNREADABLE_TIME);
  }
  for (const value of unreadable) {
    expect(isReadableWhen(value)).toBe(false);
    expect(stamp(value)).toBe(UNREADABLE_TIME);
    expect(whenText(value)).toBe(UNREADABLE_TIME);
    // One unread end is enough: a period or a duty with it is shown as unread as a whole.
    expect(isReadableWhen(readable[0], value)).toBe(false);
    expect(periodText(readable[0], value)).toBe(UNREADABLE_TIME);
    expect(dutyWhen(value, readable[0])).toBe(UNREADABLE_TIME);
  }
  expect(isReadableWhen(...readable)).toBe(true);
  // Nothing asked is nothing read: a surface that forgot to pass its dates is not told "all read".
  expect(isReadableWhen()).toBe(false);
});

test("a period of whole days is said by its first and its last day: the end the server holds is not part of it", () => {
  // A month, held as two midnights in Japan time: October ends on the 31st, not on November 1st.
  expect(wholeDaysText("2026-10-01T00:00:00+09:00", "2026-11-01T00:00:00+09:00")).toBe("2026年10月1日（木）〜10月31日（土）");
  // The same instants sent in UTC are the same days.
  expect(wholeDaysText("2026-09-30T15:00:00Z", "2026-10-31T15:00:00Z")).toBe("2026年10月1日（木）〜10月31日（土）");
  // Across a year the last day carries its year; a leap day is a day like any other.
  expect(wholeDaysText("2026-04-01T00:00:00+09:00", "2028-04-01T00:00:00+09:00")).toBe("2026年4月1日（水）〜2028年3月31日（金）");
  expect(wholeDaysText("2028-02-01T00:00:00+09:00", "2028-03-01T00:00:00+09:00")).toBe("2028年2月1日（火）〜2月29日（火）");
  // One whole day is one day, not a range.
  expect(wholeDaysText("2026-10-12T00:00:00+09:00", "2026-10-13T00:00:00+09:00")).toBe("2026年10月12日（月）");
});

test("anything that is not two midnights in Japan time is shown as it was sent, to the minute", () => {
  // A duty; a period that starts at midnight and ends at another time; midnight in UTC only;
  // a second past midnight; an end that is not after its start.
  for (const [start, end] of [
    ["2026-10-12T08:30:00+09:00", "2026-10-12T17:30:00+09:00"],
    ["2026-10-01T00:00:00+09:00", "2026-10-31T23:59:00+09:00"],
    ["2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"],
    ["2026-10-01T00:00:01+09:00", "2026-11-01T00:00:00+09:00"],
    ["2026-11-01T00:00:00+09:00", "2026-10-01T00:00:00+09:00"],
    ["2026-10-01T00:00:00+09:00", "2026-10-01T00:00:00+09:00"],
  ]) expect(wholeDaysText(start, end)).toBe(periodText(start, end));
  expect(wholeDaysText("2026-10-01T00:00:00+09:00", "2026-10-31T23:59:00+09:00")).toBe("2026年10月1日（木）00:00 〜 10月31日（土）23:59");
  // What cannot be read is named as unread, as by every other formatter here.
  expect(wholeDaysText("not a date", "2026-11-01T00:00:00+09:00")).toBe(UNREADABLE_TIME);
  expect(wholeDaysText(undefined, null, "期間未確認")).toBe("期間未確認");
});
