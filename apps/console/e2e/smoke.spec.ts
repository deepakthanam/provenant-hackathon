import { expect, test } from '@playwright/test';

test('queue → dispute → approve → status changes', async ({ page }) => {
  const id = process.env.SMOKE_DISPUTE_ID!;
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dispute queue' })).toBeVisible();

  // The fresh dispute is in the grid with its stamped verdict, awaiting approval.
  const row = page.locator('.ag-row', { hasText: id });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Within mandate');
  await expect(row).toContainText('Awaiting approval');

  // Row click opens the label panel; from there, the evidence bag.
  await row.click();
  await expect(page.getByRole('complementary', { name: `Dispute ${id}` })).toBeVisible();
  await page.getByRole('link', { name: 'Open the evidence bag' }).click();
  await expect(page).toHaveURL(new RegExp(`/disputes/${id}$`));
  await expect(page.getByText('SEAL INTACT')).toBeVisible();
  await expect(page.getByText('Provide evidence').first()).toBeVisible();

  await page.getByRole('button', { name: 'Approve and send' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sent to PayPal.' })).toBeVisible();
  await expect(page.getByText('Under PayPal review')).toBeVisible({ timeout: 15_000 });

  // Back in the queue the row has moved on.
  await page.goto('/');
  await expect(page.locator('.ag-row', { hasText: id })).toContainText('Sent to PayPal');
});
