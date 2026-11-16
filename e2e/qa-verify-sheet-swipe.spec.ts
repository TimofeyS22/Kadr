// Verification, lane E4 (docs/21 §5), row V-217: a caption line being typed is lost when a finger swipes the sheet away.
// The older test swipes with the mouse, and a mouse press on the header takes the focus off the field, which saves the
// line by itself: that test was green before the fix. A finger does not move the focus. Here the swipe is made of touch
// pointer events, as a finger makes them, and the field keeps the focus until the sheet is gone.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

async function savedProject(page: Page): Promise<string> {
  const id = /#\/p\/([^/?]+)/.exec(page.url())![1];
  return page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((ok, ko) => { const r = indexedDB.open('kadr'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    const p = await new Promise<unknown>((ok, ko) => { const r = db.transaction('kv').objectStore('kv').get(key); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    db.close();
    return JSON.stringify(p ?? '');
  }, `p:${id}`);
}

test('a caption line being typed survives a finger swiping the sheet away (audit V-217)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en'); localStorage.setItem('kadr.hint.move', '1'); localStorage.setItem('kadr.iosVideoTip.v3', '1');
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  let chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx('landscape.mp4'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const close = page.getByRole('button', { name: 'Close tools' });
  if (await close.isVisible()) await close.click();
  await page.getByRole('button', { name: 'Captions', exact: true }).click();
  chooser = page.waitForEvent('filechooser');
  const no = page.getByRole('button', { name: 'Not now', exact: true });
  await expect(async () => {
    if (await no.isVisible()) await no.click();
    await page.getByRole('button', { name: 'Import .srt or .vtt' }).click({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await (await chooser).setFiles(fx('test.srt'));
  await expect(page.locator('.clip-caption')).toHaveCount(1);

  const line = page.getByRole('textbox', { name: 'Caption line 1' });
  await line.fill('corrected line');
  await expect(line).toBeFocused();
  // A finger's swipe down the header: touch pointer events, which move no focus.
  const kept = await page.evaluate(() => {
    const head = document.querySelector('.sheet-head') as HTMLElement;
    const field = document.activeElement;
    Element.prototype.setPointerCapture = () => undefined; // the pointer is not a real one
    const r = head.getBoundingClientRect();
    const at = (type: string, y: number) => head.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: r.left + 30, clientY: y }));
    at('pointerdown', r.top + 10);
    at('pointermove', r.top + 130);
    at('pointermove', r.top + 700);
    const still = document.activeElement === field;
    at('pointerup', r.top + 700);
    return still;
  });
  expect(kept, 'the field kept the focus through the swipe, as with a finger').toBe(true);
  await expect(page.locator('.sheet-head')).toHaveCount(0);
  // Captions are kept word by word: the corrected word is in the project.
  await expect.poll(() => savedProject(page), { timeout: 5000 }).toContain('"text":"corrected"');
});
