// What a typical BASELINE test looks like: replays clicks, barely asserts.
import { test, expect } from "@playwright/test";

test("checkout with discount", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("add-mug").click();
  await page.getByTestId("add-tee").click();
  await page.getByTestId("inc-mug").click();
  await page.getByTestId("discount-input").fill("SAVE10");
  await page.getByTestId("apply-discount").click();
  await expect(page.getByTestId("total")).toBeVisible();
});
