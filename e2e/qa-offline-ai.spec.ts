// QA (docs/11 §3.13): what each AI tool does offline before its model was ever downloaded (v1.4.6).
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test('offline first use of the AI tools: each one says what to do within 25 s, none waits forever', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright WebKit does not run service workers');
  test.setTimeout(400_000);
  await page.addInitScript(() => { localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.locale', 'en'); localStorage.setItem('kadr.hint.move', '1'); });
  await page.goto('./');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles([fx('person.jpg'), fx('walk.mp4'), fx('speech_en.mp4')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(3);
  const toasts: string[] = [];
  const watch = setInterval(() => void page.locator('.toast').allTextContents().then((t) => t.forEach((x) => { if (!toasts.includes(x)) toasts.push(x); })).catch(() => undefined), 300);
  await context.setOffline(true);
  const report: string[] = [];
  const step = async (name: string, act: () => Promise<void>, done: () => Promise<boolean>) => {
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 }); // the previous step's message is gone
    toasts.length = 0;
    const t0 = Date.now();
    await act();
    let ok = false;
    while (Date.now() - t0 < 25_000) {
      if (toasts.length) break;
      // "Done" only if no error toast follows: a failed sound job leaves its switch on (export retries it).
      if (await done()) { await page.waitForTimeout(1500); ok = !toasts.length; break; }
      await page.waitForTimeout(500);
    }
    report.push(`${name}: ${ok ? 'worked' : toasts.length ? 'message' : 'NOTHING after 25 s'} ${((Date.now() - t0) / 1000).toFixed(1)} s | ${toasts.join(' | ')}`);
  };
  const clips = page.locator('.tl-row.main .clip');
  await clips.nth(0).click();
  await step('Cutout (photo)', () => tool(page, 'Cutout').click(), async () => (await tool(page, 'Cutout').getAttribute('aria-pressed')) === 'true');
  await clips.nth(0).click();
  await step('Hide faces (photo)', async () => { await tool(page, 'Hide faces').click(); await page.getByRole('switch', { name: 'Hide faces automatically' }).click(); },
    async () => page.getByRole('switch', { name: 'Hide faces automatically' }).isChecked());
  await page.getByRole('button', { name: 'Done' }).click();
  await clips.nth(1).click();
  await step('Auto reframe (video)', () => tool(page, 'Auto reframe').click(), async () => page.getByText(/Reframed/).isVisible());
  await clips.nth(2).click();
  const denoise = page.getByRole('switch', { name: 'Reduce background noise' });
  await step('Noise reduction (voice)', async () => { await tool(page, 'Volume').click(); await denoise.click(); }, async () => denoise.isChecked());
  clearInterval(watch);
  await context.setOffline(false);
  console.log(`offline AI tools:\n${report.join('\n')}`);
  for (const r of report) expect(r, 'every tool answers').not.toContain('NOTHING');
  for (const r of report) expect(r).toMatch(/worked|No internet/);
});
