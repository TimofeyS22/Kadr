// The door refuses a browser that cannot keep a project or encode any video, before the first project (V-199). It
// checked only that VideoDecoder, VideoEncoder and WebGL 2 exist; storage that refuses and an encoder that takes no
// size were first met after the person had edited. The two refusals are the cases of verifier E3 (its note
// E3-V-199-qa-verify-entry.spec.ts); the third case keeps the door open where nothing is wrong.
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.locale', 'en'); });
});

const refused = async (page: Page) => {
  await page.goto('./');
  await expect(page.getByRole('alert').filter({ hasText: /can.t edit video|cannot (store|keep|encode)/i }), 'a refusal at entry').toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'New project' })).toBeDisabled();
};

test('a browser whose storage refuses: refused at the door, in its own words (V-199)', async ({ page }) => {
  // On the prototype: WebKit makes the `indexedDB` object anew now and then, and a method set on it alone is lost (seen
  // 8 times of 8 in a probe — the list was read and the door stayed open, a false red).
  await page.addInitScript(() => {
    Object.defineProperty(IDBFactory.prototype, 'open', { configurable: true, writable: true, value: () => { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
  });
  await refused(page);
  await expect(page.getByRole('alert')).toContainText('cannot keep projects');
});

test('a browser whose encoder takes no size of video: refused at the door (V-199)', async ({ page }) => {
  await page.addInitScript(() => {
    VideoEncoder.isConfigSupported = async (c) => ({ supported: false, config: c });
  });
  await refused(page);
});

test('a browser that can do it all is let in: no refusal after the checks, «New project» works (V-199)', async ({ page }) => {
  await page.goto('./');
  await page.waitForTimeout(6000); // past the encoder's 5 s to answer
  await expect(page.getByRole('alert').filter({ hasText: /can.t edit video|cannot (store|keep|encode)/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
});
