// Lane U of the sweep (docs/21), row UI-4: a landscape video in a 9:16 project sat in black bars, said only inside
// «Кадрировать» (reports/Chetko — аудит интерфейса.md §7). Rule Ж10 of docs/17; the art director's choice: once per
// project, after the first piece of the main row, a note with «Заполнить кадр» and «Формат как у видео».
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { hideOverFrame } from './over-frame';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'ru');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.undoMoved.v1', '1');
    localStorage.setItem('kadr.iosFormatCard.v1', '1');
  });
  await page.setViewportSize({ width: 375, height: 812 });
});

async function newProjectWith(page: Page, file: string, before?: () => Promise<void>) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  if (before) await before();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.toolbar .tool', { hasText: /^Медиа$/ }).click();
  await (await chooser).setFiles([fx(file)]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
}

const note = (page: Page) => page.getByRole('note').filter({ hasText: 'чёрные поля' });

/** Mean brightness (0–255) of the top and bottom tenth of the frame as drawn. */
async function edges(page: Page) {
  await page.waitForTimeout(600);
  // The frame's own pixels: the note stands on the bottom bar it speaks of, so it is hidden for the shot.
  const shot = await page.locator('.preview-canvas').screenshot({ type: 'png', style: hideOverFrame() });
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-vf', 'scale=36:64', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { input: shot, maxBuffer: 1 << 20 });
  const mean = (from: number, to: number) => { let s = 0; for (let y = from; y < to; y++) for (let x = 0; x < 36; x++) s += raw[y * 36 + x]; return s / ((to - from) * 36); };
  return { top: mean(0, 6), bottom: mean(58, 64) };
}

test('UI-4: a landscape video in 9:16 says what the black bars are, once, with the two ways out in reach of the thumb; «Заполнить кадр» fills the frame and one Undo brings the bars back', async ({ page }) => {
  await newProjectWith(page, 'landscape.mp4');
  await expect(note(page), 'said right after the video came').toBeVisible({ timeout: 2_000 });
  await expect(note(page)).toContainText('Видео шире кадра: сверху и снизу чёрные поля.');
  const fill = note(page).getByRole('button', { name: 'Заполнить кадр' });
  const format = note(page).getByRole('button', { name: 'Формат как у видео' });
  for (const b of [fill, format, note(page).getByRole('button', { name: 'Закрыть' })]) {
    const box = (await b.boundingBox())!;
    expect(Math.min(box.width, box.height), 'a finger takes it').toBeGreaterThanOrEqual(44);
    expect(box.y, 'in the lower 60% of the screen').toBeGreaterThanOrEqual(0.4 * 812);
  }
  const bars = await edges(page);
  expect(Math.max(bars.top, bars.bottom), 'before: black above and below').toBeLessThan(12);
  await fill.click();
  // Said at once and gone in seconds: read before the frame is waited for (on a loaded Mac the redraw took longer than the plate stays).
  await expect(page.locator('.toast').filter({ hasText: 'Обрезано по центру' })).toBeVisible();
  await expect(note(page), 'answered: gone').toHaveCount(0);
  // The frame is read until it is drawn: on a loaded Mac a redraw can take longer than a fixed wait.
  await expect.poll(async () => { const e = await edges(page); return Math.min(e.top, e.bottom); }, { message: 'the picture reaches the top and the bottom of the frame', timeout: 15_000 }).toBeGreaterThan(20);
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect.poll(async () => { const e = await edges(page); return Math.max(e.top, e.bottom); }, { message: 'one Undo: the bars are back', timeout: 15_000 }).toBeLessThan(12);
  await expect(note(page), 'and the note is not said again').toHaveCount(0);
  await page.reload();
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.waitForTimeout(800);
  await expect(note(page), 'nor after a reload').toHaveCount(0);
});

test('UI-4: «Формат как у видео» gives the project the video\'s format; a closed note stays closed', async ({ page }) => {
  await newProjectWith(page, 'landscape.mp4');
  await note(page).getByRole('button', { name: 'Формат как у видео' }).click();
  await expect(note(page)).toHaveCount(0);
  await expect.poll(() => page.locator('.preview-canvas').evaluate((c) => { const r = c.getBoundingClientRect(); return Math.round((r.width / r.height) * 100) / 100; })).toBeCloseTo(16 / 9, 1);
  await newProjectWith(page, 'landscape.mp4');
  await note(page).getByRole('button', { name: 'Закрыть' }).click();
  await expect(note(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(note(page)).toHaveCount(0);
});

test('UI-4: no note where there are no bars to speak of — a portrait video in 9:16, a blurred background, a project opened with pieces in it', async ({ page }) => {
  await newProjectWith(page, 'portrait.mp4');
  await page.waitForTimeout(1_000);
  await expect(note(page), 'a portrait video fills 9:16').toHaveCount(0);
  await newProjectWith(page, 'landscape.mp4', async () => {
    await page.locator('.toolbar .tool', { hasText: /^Холст$/ }).click();
    await page.locator('.sheet').getByRole('radio', { name: 'Размытие' }).click();
    await page.locator('.sheet').getByRole('button', { name: 'Готово' }).click();
  });
  await page.waitForTimeout(1_000);
  await expect(note(page), 'a blurred copy fills the bars already').toHaveCount(0);
  await page.goto('./');
  await page.getByRole('button', { name: 'Открыть пример' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_000);
  await expect(note(page), 'a project opened with its pieces is never told').toHaveCount(0);
});

// SW-U-7: the note was placed once, above the row under the frame as it stood when the note came. A text or a sound then
// gave the timeline a row, the row under the frame rose, and the note lay over Undo and Redo (lead of the sweep: a tap on
// «Повторить» went into the note).
test('UI-4 (SW-U-7): the note never lies over the controls — when Redo brings a row of the timeline back, Undo, Redo, Play and Export still take a finger', async ({ page }) => {
  await newProjectWith(page, 'landscape.mp4');
  await expect(note(page)).toBeVisible({ timeout: 2_000 });
  const rowTop = async () => (await page.locator('.transport').boundingBox())!.y;
  const projectTools = async () => { const back = page.locator('.toolbar .tool-back'); if (await back.isVisible()) await back.click(); };
  // A text, a sound and an overlay give the timeline rows; Undo takes them away; the note is placed again (a sheet opened
  // and closed) without them; Redo brings them back without the note being placed again — as in the history of a camera
  // take and a voice-over (editor.spec «history and persistence…»).
  await projectTools();
  await page.locator('.toolbar .tool', { hasText: /^Текст$/ }).click();
  await page.locator('.sheet').getByRole('button', { name: 'Готово' }).click();
  for (const [name, file] of [['Звук', 'music.m4a'], ['Наложение', 'portrait.mp4']] as const) {
    await projectTools();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.toolbar .tool', { hasText: new RegExp(`^${name}$`) }).click();
    await (await chooser).setFiles([fx(file)]);
    await page.waitForTimeout(800);
  }
  const withRows = await rowTop();
  const undo = page.locator('.transport').getByRole('button', { name: 'Отменить' }), redo = page.locator('.transport').getByRole('button', { name: 'Повторить' });
  for (let i = 0; i < 3; i++) { await undo.click(); await page.waitForTimeout(300); }
  await projectTools();
  await page.locator('.toolbar .tool', { hasText: /^Холст$/ }).click();
  await page.locator('.sheet').getByRole('button', { name: 'Готово' }).click();
  await expect(note(page), 'the note is back once the sheet is gone').toBeVisible();
  const without = await rowTop();
  for (let i = 0; i < 3; i++) { await redo.click({ timeout: 10_000 }); await page.waitForTimeout(300); }
  await page.waitForTimeout(800);
  console.log(`SW-U-7: the row under the frame ${Math.round(without)} without the rows, ${Math.round(withRows)} with them, ${Math.round(await rowTop())} after Redo`);
  const row = (await page.locator('.transport').boundingBox())!;
  const card = (await note(page).boundingBox())!;
  expect(card.y + card.height, 'the note ends above the row under the frame').toBeLessThanOrEqual(row.y + 0.5);
  const controls = [
    page.locator('.transport').getByRole('button', { name: 'Отменить' }),
    page.locator('.transport').getByRole('button', { name: 'Повторить' }),
    page.locator('.transport').getByRole('button', { name: /^(Воспроизвести|Пауза)$/ }),
    page.locator('.topbar').getByRole('button', { name: 'Экспорт', exact: true }),
  ];
  for (const c of controls) {
    const hit = await c.evaluate((el) => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (h === el || el.contains(h)); });
    expect(hit, `${await c.getAttribute('aria-label') ?? await c.textContent()}: a tap on it reaches it`).toBe(true);
  }
});
