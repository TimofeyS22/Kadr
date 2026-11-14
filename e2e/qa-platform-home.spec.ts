// Home: a new project, the sample, renaming, deleting — the edges and resources the older checks left out (QA matrix
// Q-3, docs/11 §3.1, §3.5, §3.7). The templates themselves are in qa-export-templates.spec.ts (C-H1).
import { expect, test, type Page } from '@playwright/test';
import { audits, decodeErrors, exportAs, probe, toastErrors } from './qa-platform-kit';

audits();

const projectNames = (page: Page) => page.locator('.project-open').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') ?? '').replace(/^Open /, '')));

async function newProject(page: Page) {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
}
async function backHome(page: Page) {
  await page.getByRole('button', { name: 'Back to projects' }).first().click();
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
}

test('the sample project opens and exports a whole file: as long as its timeline, H.264 at 30 fps, AAC (Q-3)', async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.goto('./');
  await page.getByRole('button', { name: 'Try a sample' }).click();
  await expect(page.locator('.tl-row.main .clip').first()).toBeVisible({ timeout: 60_000 });
  const total = await page.locator('.time').textContent(); // "0:00.0 / 0:08.0"
  const want = Number(/\/\s*(\d+):([\d.]+)/.exec(total ?? '')!.slice(1).reduce((m, s) => String(Number(m) * 60 + Number(s))));
  const file = await exportAs(page, info, 'Video');
  const got = probe(file);
  expect(decodeErrors(file)).toBe('');
  expect(Math.abs(got.duration - want), `file ${got.duration} s, timeline ${want} s`).toBeLessThan(0.1);
  expect(got.video?.codec).toBe('h264');
  expect(got.video?.fps).toBeCloseTo(30, 1);
  expect(got.audio?.codec).toBe('aac');
});

test('a double tap on «Try a sample» makes one sample, not two (Q-3 §3.5)', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Try a sample' })).toBeVisible();
  const before = (await projectNames(page)).length;
  await page.getByRole('button', { name: 'Try a sample' }).dblclick();
  await expect(page.locator('.tl-row.main .clip').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2000); // a second sample, if any, is made in this time
  await backHome(page);
  await expect.poll(async () => (await projectNames(page)).length, { timeout: 10_000 }).toBe(before + 1);
});

test('names: a blank rename keeps the name; a long name with emoji, quotes and a slash keeps the 80 characters the field holds and gives safe file names (Q-3 §3.5)', async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.goto('./');
  await newProject(page);
  await backHome(page);
  const [name] = await projectNames(page);
  // Blank: the name stays.
  await page.getByRole('button', { name: `Rename ${name}` }).click();
  const sheet = page.getByRole('dialog', { name: 'Rename' });
  await sheet.getByRole('textbox', { name: 'Project name' }).fill('   ');
  const save = sheet.getByRole('button', { name: 'Save' });
  if (await save.isEnabled()) await save.click();
  else await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: `Open ${name}` })).toBeVisible();
  // Long, with emoji, quotes and a slash.
  const long = `Поездка на море 🌊 "лето" 2026/27 — ${'очень длинное название '.repeat(4).trim()}`;
  await page.getByRole('button', { name: `Rename ${name}` }).click();
  await sheet.getByRole('textbox', { name: 'Project name' }).fill(long);
  await sheet.getByRole('button', { name: 'Save' }).click();
  const kept = long.slice(0, 80).trim(); // the field holds 80 characters and counts them (Home.tsx)
  await expect(page.getByRole('button', { name: `Open ${kept}`, exact: true })).toBeVisible();
  // The row keeps inside the screen (no sideways scroll on Home).
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'no sideways scroll').toBeLessThanOrEqual(0);
  // The backup's file name has no slash or quote and is not empty.
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: `Save a backup of ${kept}`, exact: true }).click();
  const backupName = (await dl).suggestedFilename();
  expect(backupName).toMatch(/\.kadr$/);
  expect(backupName).not.toMatch(/[/\\"]/);
  expect(backupName.length).toBeGreaterThan(6);
  // The export of it too, after a reload (the name was saved).
  await page.reload();
  await page.getByRole('button', { name: `Open ${kept}`, exact: true }).click();
  await page.locator('.ck-empty, .preview-canvas').first().waitFor();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles([`${import.meta.dirname}/../fixtures/photo.png`]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const file = await exportAs(page, info, 'Photo');
  const base = file.split('/').pop()!.replace(/^\d+-/, '');
  expect(base).toMatch(/\.jpg$/);
  expect(base).not.toMatch(/[/\\"]/);
  expect(await toastErrors(page)).toEqual([]);
});

test('Home asks about WebGL once a page: its renders (renames here) make no GPU context and leave none alive (Q-3 §3.7, SW-D-3)', async ({ page }) => {
  await page.addInitScript(() => {
    const made: WebGL2RenderingContext[] = [];
    (window as unknown as { __gl: () => [number, number] }).__gl = () => [made.length, made.filter((g) => !g.isContextLost()).length];
    const get = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, id: string, o?: unknown) => RenderingContext | null;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, o?: unknown) {
      const ctx = get.call(this, id, o);
      if (id === 'webgl2' && ctx) made.push(ctx as WebGL2RenderingContext);
      return ctx;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto('./');
  await newProject(page);
  await backHome(page);
  const gl = () => page.evaluate(() => (window as unknown as { __gl: () => [number, number] }).__gl());
  const [madeBefore] = await gl();
  // Each rename saves the project and draws Home again.
  const sheet = page.getByRole('dialog', { name: 'Rename' });
  let name = (await projectNames(page))[0];
  for (let i = 1; i <= 10; i++) {
    await page.getByRole('button', { name: `Rename ${name}`, exact: true }).click();
    await sheet.getByRole('textbox', { name: 'Project name' }).fill(`Trip ${i}`);
    await sheet.getByRole('button', { name: 'Save' }).click();
    name = `Trip ${i}`;
    await expect(page.getByRole('button', { name: `Open ${name}`, exact: true })).toBeVisible();
  }
  const [made, alive] = await gl();
  // The editor's own preview context is the editor's to let go (SW-D-4, lane C); Home adds none and keeps none.
  expect(made - madeBefore, `contexts made by Home's renders (${made} in all)`).toBe(0);
  expect(alive, 'contexts alive on Home').toBeLessThanOrEqual(1);
});
