import { createIdealClient } from "../api/client";

function recording() {
  const paths: string[] = [];
  const client = createIdealClient("test", async <T,>(path: string) => { paths.push(path); return { snapshot: { people: [] }, people: [] } as T; });
  return { paths, client };
}

test("the audit timeline encodes its cursor and its category", async () => {
  const { paths, client } = recording();
  await client.timeline("hospital/pharmacy", null, "compliance");
  await client.timeline("hospital/pharmacy", "2026-01-01T00:00:00+09:00|e/1", "a&scope_id=other");
  expect(paths).toEqual([
    "/audit-timeline?scope_id=hospital%2Fpharmacy&limit=20&category=compliance",
    "/audit-timeline?scope_id=hospital%2Fpharmacy&limit=20&before=2026-01-01T00%3A00%3A00%2B09%3A00%7Ce%2F1&category=a%26scope_id%3Dother",
  ]);
});

test("an identifier is one segment or one value of the request, whatever it contains", async () => {
  const { paths, client } = recording();
  const hostile = "x/../y?scope_id=other&z=#";
  const safe = encodeURIComponent(hostile);
  await client.scheduleCalendar(hostile, hostile);
  await client.markNotificationRead("s", hostile);
  await client.changeOptions("s", hostile, hostile, "ABSENCE");
  await client.job("s", hostile);
  await client.draft("s", hostile);
  await client.comparison("s", hostile, [hostile, "d2"]);
  await client.lifecycleCases(hostile);
  expect(paths.length).toBeGreaterThan(0);
  for (const path of paths) {
    expect(path).not.toContain(hostile);
    expect(path).not.toMatch(/\.\.\/|[#]|\?.*\?/);
    expect(path).toContain(safe);
  }
});
