// What a GOOD generated test should look like: asserts after every action.
import { test, expect } from "@playwright/test";

test("checkout with discount", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("place-order")).toBeDisabled();

  await page.getByTestId("add-mug").click();
  await page.getByTestId("add-tee").click();
  await expect(page.getByTestId("cart-item-tee")).toBeVisible();
  await expect(page.getByTestId("total")).toHaveText("$32.00");

  await page.getByTestId("inc-mug").click();
  await expect(page.getByTestId("qty-mug")).toHaveText("2");
  await expect(page.getByTestId("total")).toHaveText("$44.00");

  await page.getByTestId("add-cap").click();
  await page.getByTestId("remove-cap").click();
  await expect(page.getByTestId("cart-item-cap")).toHaveCount(0);

  await page.getByTestId("discount-input").fill("BOGUS");
  await page.getByTestId("apply-discount").click();
  await expect(page.getByTestId("discount-message")).toHaveText("Invalid code");

  await page.getByTestId("discount-input").fill("SAVE10");
  await page.getByTestId("apply-discount").click();
  await expect(page.getByTestId("discount-message")).toHaveText("10% discount applied");
  await expect(page.getByTestId("total")).toHaveText("$39.60");

  await expect(page.getByTestId("place-order")).toBeEnabled();
  await page.getByTestId("place-order").click();
  await expect(page.getByTestId("confirmation")).toBeVisible();
  await expect(page.getByTestId("order-number")).toHaveText(/^TS-\d+$/);
});
