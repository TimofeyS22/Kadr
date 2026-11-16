// Verification, lane E4 (docs/21 §5), row V-199: a browser without the video functions Kadr needs is refused at the
// door, not after the person has started editing. The row had no test of its own ("checked by regression"). Here the
// page loads in a browser with no VideoEncoder: the home screen says why, and nothing that starts a project can be
// pressed.
import { expect, test } from '@playwright/test';

test('a browser with no video encoder is told so on the home screen, and no project can be started (audit V-199)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.locale', 'en');
    delete (window as unknown as { VideoEncoder?: unknown }).VideoEncoder;
  });
  await page.goto('./');
  await expect(page.getByRole('alert').filter({ hasText: 'can’t edit video yet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New project' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Try a sample' })).toBeDisabled();
});
