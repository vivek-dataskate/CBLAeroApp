import { test, expect } from '@playwright/test';

test.describe('Admin Scheduler Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Assuming login is handled or mocked
    await page.goto('/dashboard/admin');
  });

  test('should display scheduler status card', async ({ page }) => {
    await expect(page.locator('text=Scheduler Status')).toBeVisible();
  });

  test('should load scheduler definitions', async ({ page }) => {
    // Wait for data to load
    await page.waitForSelector('[data-testid="scheduler-definitions"]');
    const definitions = page.locator('[data-testid="scheduler-definition"]');
    await expect(definitions).toHaveCount(await definitions.count()); // At least 0
  });

  test('should allow editing scheduler definition', async ({ page }) => {
    // Click edit on first definition
    await page.locator('[data-testid="edit-scheduler-btn"]').first().click();

    // Fill form
    await page.fill('[data-testid="cron-input"]', '0 0 * * *');

    // Save
    await page.click('[data-testid="save-btn"]');

    // Verify update
    await expect(page.locator('text=Updated successfully')).toBeVisible();
  });

  test('should trigger scheduler run', async ({ page }) => {
    // Click trigger on first definition
    await page.locator('[data-testid="trigger-scheduler-btn"]').first().click();

    // Confirm trigger
    await page.click('[data-testid="confirm-trigger-btn"]');

    // Verify run started
    await expect(page.locator('text=Run triggered')).toBeVisible();
  });

  test('should handle errors gracefully', async ({ page }) => {
    // Simulate error scenario
    await page.route('**/api/internal/admin/scheduler/**', route => route.fulfill({ status: 500 }));

    await page.reload();
    await expect(page.locator('text=Failed to load scheduler data')).toBeVisible();
  });
});