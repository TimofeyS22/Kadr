// Slowness as a failure (audit V-214). Tests wait up to minutes, so a screen answering in 20 s or a 6 s clip exporting
// in 2 minutes passed. These bounds are on a Mac: generous enough for a busy machine, far below what a person would call
// broken. They do not replace the phone budgets of CLAUDE.md §5, which only a phone can measure.
import { expect, test } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

const BUDGET_MS = { start: 8000, editor: 5000, import: 8000, sheet: 3000, export: 40_000 };

test('start, a new project, an import, a tool sheet and a 6 s export each fit their budget', async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined }); // headless WebKit has no share sheet
  });
  const took: Record<string, number> = {};
  const timed = async (name: keyof typeof BUDGET_MS, step: () => Promise<unknown>) => { const t = Date.now(); await step(); took[name] = Date.now() - t; };

  await timed('start', async () => { await page.goto('./'); await expect(page.getByRole('button', { name: 'New project' })).toBeVisible({ timeout: 60_000 }); });
  await timed('editor', async () => {
    await page.getByRole('button', { name: 'New project' }).click();
    await page.locator('.aspect-card', { hasText: '9:16' }).click();
    await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
  });
  await timed('import', async () => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Media', exact: true }).click();
    await (await chooser).setFiles(fx('landscape.mp4'));
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 60_000 });
  });
  const clip = page.locator('.tl-row.main .clip').first();
  await expect(async () => {
    if (!(await clip.getAttribute('class'))?.includes(' sel')) await clip.click();
    await expect(clip).toHaveClass(/ sel/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await timed('sheet', async () => {
    await page.getByRole('button', { name: 'Speed', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Speed' })).toBeVisible({ timeout: 60_000 });
  });
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await page.getByRole('radio', { name: 'Small file' }).click();
  await timed('export', async () => {
    await page.getByRole('button', { name: 'Export video' }).click();
    await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 150_000 });
  });
  console.log(`budgets, ms (${info.project.name}): ${JSON.stringify(took)}`);
  for (const k of Object.keys(BUDGET_MS) as (keyof typeof BUDGET_MS)[]) expect.soft(took[k], `${k}: budget ${BUDGET_MS[k]} ms`).toBeLessThanOrEqual(BUDGET_MS[k]);
});
