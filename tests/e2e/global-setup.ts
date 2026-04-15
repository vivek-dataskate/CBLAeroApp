import { chromium, type FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    // Navigate to app
    await page.goto('http://localhost:3000');

    // If redirected to Microsoft login, you'll need to handle it manually for now
    // For automated tests, consider using a test account or mocking auth

    // Save signed-in state
    await page.context().storageState({ path: 'tests/e2e/.auth/user.json' });

    console.log('Auth setup complete. Signed-in state saved.');
  } catch (error) {
    console.log('Auth setup failed. You may need to sign in manually for tests.');
  } finally {
    await browser.close();
  }
}

export default globalSetup;