// A walk through the app with the console watched (QA matrix Q-2): every settings sheet of a clip and of the project,
// the export sheet, every format, Home, the sample, a template, the task pages and both languages. A console error not
// listed with its reason in EXPLAINED_CONSOLE (qa-platform-kit.ts) fails the walk. The other specs of the sweep's lane D
// hold their own scenarios to the same rule.
import { expect, test, type Page } from '@playwright/test';
import { TASK_IDS } from '../src/core/taskIds';
import { RU } from '../src/lib/locale-ru';
import { audits, exportAs, fx, importFiles, newProject, sheet } from './qa-platform-kit';

const SHEETS = ['Adjust', 'Filters', 'Effects', 'Crop', 'Transform', 'Mask', 'Chroma key', 'Speed', 'Volume', 'Voice', 'Text', 'Stickers', 'Music', 'Sounds', 'Canvas', 'Beat', 'Layers', 'Keyframes', 'Captions'];

async function everySheet(page: Page, opened: string[], tr: (s: string) => string = (x) => x) {
  for (const scope of ['clip', 'project'] as const) {
    for (const name of SHEETS.map(tr)) {
      const sel = page.locator('.tl-row.main .clip.sel');
      if (scope === 'clip' && !(await sel.count())) await page.locator('.tl-row.main .clip').first().click();
      if (scope === 'project' && (await sel.count())) await page.getByRole('button', { name: tr('Close tools') }).click();
      const button = page.locator('.toolbar .tool', { hasText: new RegExp(`^${name}$`) });
      if (!(await button.count()) || !(await button.first().isEnabled())) continue;
      await button.first().click();
      await expect(sheet(page), `${name} opens its sheet`).toBeVisible();
      await page.waitForTimeout(500);
      opened.push(`${scope} › ${name}`);
      await page.keyboard.press('Escape');
      await expect(sheet(page)).toHaveCount(0);
    }
  }
}

for (const locale of ['en', 'ru'] as const) {
  test.describe(() => {
    audits({ locale });
    test(`the console stays clean (${locale}): every sheet, each export format, Home, the sample and a template (Q-2)`, async ({ page }, info) => {
      test.setTimeout(600_000);
      const opened: string[] = [];
      if (locale === 'en') {
        await newProject(page);
        await importFiles(page, 'Media', ['landscape.mp4', 'photo.png']);
        await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
        await page.getByRole('button', { name: 'Close tools' }).click();
        await importFiles(page, 'Audio', ['music.m4a']);
        await expect(page.locator('.tl-row.audio .clip')).toHaveCount(1);
        await everySheet(page, opened);
        for (const f of ['Photo', 'GIF', 'Audio', 'Video'] as const) await exportAs(page, info, f);
        await page.getByRole('button', { name: 'Back to projects' }).first().click();
        await page.getByRole('button', { name: 'Try a sample' }).click();
        await expect(page.locator('.tl-row.main .clip').first()).toBeVisible({ timeout: 60_000 });
        await page.getByRole('button', { name: 'Play', exact: true }).click();
        await page.waitForTimeout(1500);
        await page.getByRole('button', { name: 'Pause', exact: true }).click();
        await page.getByRole('button', { name: 'Back to projects' }).first().click();
        const chooser = page.waitForEvent('filechooser');
        await page.locator('.template-card').first().click();
        await (await chooser).setFiles([fx('photo.png'), fx('person.jpg')]);
        await expect(page.locator('.tl-row .clip').first()).toBeVisible({ timeout: 60_000 });
        expect(opened.length, `sheets opened: ${opened.join(', ')}`).toBeGreaterThanOrEqual(15);
      } else {
        // Russian: the same sheets, reached by their Russian names, on one video (no music clip: no «Beat»).
        const ru = (x: string) => RU[x] ?? x;
        await page.goto('./');
        await page.getByRole('button', { name: ru('New project') }).click();
        await page.locator('.aspect-card', { hasText: '9:16' }).click();
        await expect(page.locator('.preview-canvas')).toBeVisible();
        await importFiles(page, ru('Media'), ['landscape.mp4']);
        await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
        await everySheet(page, opened, ru);
        expect(opened.length, `sheets opened: ${opened.join(', ')}`).toBeGreaterThanOrEqual(12);
      }
    });
  });
}

test.describe(() => {
  audits();
  test('every task page leads into Kadr at a task it knows, whose banner it shows; an unknown task opens Home (Q-32)', async ({ page, request }) => {
    test.setTimeout(240_000);
    const pages = new Set<string>();
    for (const lang of ['en', 'ru']) {
      const index = await (await request.get(`./${lang}/`)).text();
      for (const m of index.matchAll(/href="([\w-]+)\/"/g)) if (!['licenses', 'privacy'].includes(m[1])) pages.add(`${lang}/${m[1]}/`);
    }
    expect(pages.size, `task pages found: ${[...pages].join(' ')}`).toBeGreaterThanOrEqual(10);
    const seen = new Set<string>();
    for (const p of pages) {
      const html = await (await request.get(`./${p}`)).text();
      const task = /#\/start\/([\w-]+)/.exec(html)?.[1];
      expect(task, `${p} links into a task`).toBeTruthy();
      expect(TASK_IDS as readonly string[], `${p}: «${task}» is a task Kadr knows`).toContain(task);
      seen.add(task!);
    }
    for (const task of seen) {
      await page.goto(`./#/start/${task}`);
      await expect(page.locator('.task-banner'), `#/start/${task}`).toBeVisible();
      expect((await page.locator('.task-banner').textContent())?.trim().length, `#/start/${task} names its task`).toBeGreaterThan(10);
    }
    await page.goto('./#/start/no-such-task');
    await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
    await expect(page.locator('.task-banner')).toHaveCount(0);
  });
});
