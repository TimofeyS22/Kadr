// V-148: an iPhone never lists Kadr under «Share» (Safari has no share_target), but a video dragged out of Photos into
// Safari arrives whole as a drop (the lead's probe on an iPhone 15, Safari 26.5.2: video/quicktime, the file read to
// its end). Home takes such a drop the way Android's «Share → Kadr» takes a share: a new vertical project, the video on
// the timeline, the editor open. The finger and Photos themselves are the L5 queue's (reports/L5 — очередь.md, U).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const video = () => fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'rotated_0.mp4')).toString('base64');

/** Drags one file over Home and lets it go, as Safari hands a drop to the page. */
async function drop(page: Page, at: string, name: string, type: string, b64: string) {
  await page.locator(at).evaluate((el, [n, t, b]) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(b), (c) => c.charCodeAt(0))], n, { type: t }));
    for (const kind of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(kind, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [name, type, b64] as const);
}

test('V-148: a video dropped on Home opens as a new project with it on the timeline, as «Share → Kadr» does on Android', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
  await expect(page.getByText('No projects yet')).toBeVisible(); // the list is read
  await drop(page, '.ck-home-in', 'IMG_0412.MOV', 'video/quicktime', video());
  await expect(page.locator('.tl-row.main .clip'), 'the dropped video is the project’s one clip').toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('.preview-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Back to projects' }).first().click();
  await expect(page.locator('.project-open'), 'one new project in the list').toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Open Project 1' })).toBeVisible();
});

test('V-148: Home shows where to let go while files are over it, and ignores a drag that holds no files', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText('No projects yet')).toBeVisible();
  const home = page.locator('.ck-home');
  const over = (files: boolean) => home.evaluate((el, f) => {
    const dt = new DataTransfer();
    if (f) dt.items.add(new File(['x'], 'a.mp4', { type: 'video/mp4' }));
    else dt.setData('text/plain', 'words');
    const e = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  }, files);
  expect(await over(false), 'a drag of words is not taken').toBe(false);
  await expect(page.locator('.ck-drop')).toHaveCount(0);
  expect(await over(true), 'a drag of files is taken').toBe(true);
  await expect(page.locator('.ck-drop')).toHaveText('Drop videos, photos or music to start a project');
});
