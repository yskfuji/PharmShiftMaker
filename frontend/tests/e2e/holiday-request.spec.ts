import { test, expect, APIRequestContext, Page } from "@playwright/test";

const TARGET_YEAR = 2025;
const TARGET_MONTH = 11;
const BACKEND_BASE_URL = process.env.E2E_BACKEND_BASE_URL ?? "http://127.0.0.1:8000";

async function acquireAdminToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${BACKEND_BASE_URL}/auth/login`, {
    data: { username: "admin", password: "pass-admin" },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return payload.access_token as string;
}

async function resetHolidayRequests(request: APIRequestContext, token: string, year: number, month: number): Promise<void> {
  const listResponse = await request.get(`${BACKEND_BASE_URL}/holiday-requests/${year}/${month}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(listResponse.ok()).toBeTruthy();
  const payload = (await listResponse.json()) as { requests: Array<{ date: string; person_id: string }> };
  for (const entry of payload.requests) {
    await request.delete(`${BACKEND_BASE_URL}/holiday-requests/${year}/${month}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: { date: entry.date, person_id: entry.person_id },
    });
  }
}

async function gotoWithRetry(page: Page, path: string, attempts = 5, delayMs = 500): Promise<void> {
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    lastStatus = response?.status();
    if (!response || response.ok()) {
      return;
    }
    await page.waitForTimeout(delayMs * (attempt + 1));
  }
  throw new Error(`Failed to load ${path}. Last status: ${lastStatus}`);
}

test.describe("Schedule UX happy path", () => {
  test("allows login, warning review, and holiday request management", async ({ page }) => {
    const token = await acquireAdminToken(page.request);
    await resetHolidayRequests(page.request, token, TARGET_YEAR, TARGET_MONTH);

    await gotoWithRetry(page, `/login?redirectTo=/schedule/${TARGET_YEAR}/${TARGET_MONTH}`);
    await expect(page.getByLabel("ユーザーID")).toBeVisible();
    await page.getByLabel("ユーザーID").fill("admin");
    await page.getByLabel("パスワード").fill("pass-admin");
    await page.getByRole("button", { name: "サインイン" }).click();

    await expect(page).toHaveURL(new RegExp(`/schedule/${TARGET_YEAR}/${TARGET_MONTH}`));
    await expect(
      page.getByRole("heading", { name: `${TARGET_YEAR}年 ${TARGET_MONTH}月 シフト` }).first(),
    ).toBeVisible();
    await expect(page.getByText("総割当")).toBeVisible();

    const dayCell = page.getByTestId("day-cell").first();
    await dayCell.click();
    await expect(page.getByRole("heading", { name: /日の割り当て/ })).toBeVisible();

    await page.getByRole("button", { name: "公休を希望する" }).click();
    await expect(page.getByText(/現在の希望:\s*公休/)).toBeVisible();

    await page.getByRole("button", { name: "取り消す" }).click();
    await expect(page.getByText("現在この日には希望休が登録されていません")).toBeVisible();

    const rowDropTargets = page.locator("[data-testid^='manual-row-'][data-testid$='-drop']");
    if ((await rowDropTargets.count()) === 0) {
      await page.getByRole("button", { name: "割当を追加" }).click();
      const newShiftInput = page.locator("[data-testid^='manual-row-'][data-testid$='-shift']").last();
      await newShiftInput.fill("DAY");
    }

    const personChip = page.getByTestId("person-chip").first();
    await expect(personChip).toBeVisible();
    const dropTarget = rowDropTargets.first();
    await expect(dropTarget).toBeVisible();
    const personId = (await personChip.getAttribute("data-person-id")) ?? "";
    await personChip.dragTo(dropTarget);
    if (personId) {
      const personInputs = page.locator("[data-testid^='manual-row-'][data-testid$='-person']");
      await expect(personInputs.first()).toHaveValue(personId, { timeout: 3000 });
    }

  const saveButton = page.getByTestId("manual-save-button");
  await expect(saveButton).toBeEnabled({ timeout: 5000 });
  await saveButton.click();
    await expect(page.getByText("手動調整済み")).toBeVisible();

    await page.getByRole("button", { name: "閉じる" }).click();

    const trialButton = page.getByTestId("trial-button");
    await trialButton.click();
    await expect(trialButton).toHaveText("試行中...", { timeout: 2000 });
    await expect(trialButton).toHaveText("試行で再計算", { timeout: 15000 });

    await expect(dayCell.locator('[title="手動調整済み"]')).toBeVisible();
    await expect(page.getByTestId("warnings-panel")).toBeVisible();
  });
});
