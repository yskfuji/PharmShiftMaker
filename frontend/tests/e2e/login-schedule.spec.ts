import { test, expect, Page } from "@playwright/test";

const TARGET_YEAR = 2025;
const TARGET_MONTH = 11;

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

test.describe("Login to schedule view", () => {
  test("allows admin to sign in and inspect the calendar", async ({ page }) => {
    await gotoWithRetry(page, `/login?redirectTo=/schedule/${TARGET_YEAR}/${TARGET_MONTH}`);

    const userField = page.getByLabel("ユーザーID");
    await expect(userField).toBeVisible();
    await userField.fill("admin");

    const passwordField = page.getByLabel("パスワード");
    await expect(passwordField).toBeVisible();
    await passwordField.fill("pass-admin");

    await page.getByRole("button", { name: "サインイン" }).click();

    await expect(page).toHaveURL(new RegExp(`/schedule/${TARGET_YEAR}/${TARGET_MONTH}`));
    await expect(
      page.getByRole("heading", { name: `${TARGET_YEAR}年 ${TARGET_MONTH}月 シフト` }).first(),
    ).toBeVisible();

    await expect(page.getByText("総割当")).toBeVisible();
    await expect(page.getByText("警告数")).toBeVisible();

    const dayCell = page.getByTestId("day-cell").first();
    await expect(dayCell).toBeVisible();

    const warningPanel = page.getByTestId("warnings-panel");
    await expect(warningPanel).toBeVisible();

    const trialsButton = page.getByTestId("trial-button");
    await expect(trialsButton).toBeVisible();
  });
});
