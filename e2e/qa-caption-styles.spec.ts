// v1.5 template catalogs (docs/11 §3): every caption template is applied from the picker and the preview equals the
// export (photo for each, video for one template per new drawing feature); the pickers work one-handed at 375 px;
// every template reads on any background, in Cyrillic and Latin, and draws no slower than the styles before v1.5.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { CAPTION_CATEGORIES, CAPTION_PRESETS, TEXT_PRESETS } from '../src/core/presets';
import type { StylesReport } from '../src/ui/StylesCheck';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    if (!localStorage.getItem('kadr.locale')) localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    if (!localStorage.getItem('kadr.exportPrefs')) localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined }); // headless WebKit has no share sheet
  });
});
test.afterEach(async () => { expect(pageErrors, 'uncaught errors in the page').toEqual([]); });

const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const styles = (page: Page) => page.getByRole('radiogroup', { name: 'Style' });

/** A 9:16 project with a video and the Cyrillic + Latin captions of test_ru.srt; the caption sheet is left open. */
async function captioned(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  // The captions first: with a video selected, Captions would caption its speech in one tap.
  await tool(page, 'Captions').click();
  const srt = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import .srt or .vtt' }).click();
  await (await srt).setFiles(fx('test_ru.srt'));
  await expect(page.locator('.clip-caption')).toHaveCount(1);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('Escape');
  const close = page.getByRole('button', { name: 'Close tools' });
  if (await close.isVisible()) await close.click();
  const media = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await media).setFiles(fx('landscape.mp4'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  if (await close.isVisible()) await close.click();
}

async function openCaptions(page: Page) {
  const clip = page.locator('.clip-caption');
  await expect(async () => {
    if (!(await clip.getAttribute('class'))?.includes(' sel')) await clip.click();
    await expect(clip).toHaveClass(/ sel/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await tool(page, 'Edit captions').click();
  await expect(styles(page)).toBeVisible();
}

/** Grayscale 270×480 of a picture, or of frame `n` of a video. */
function grayAt(file: string, n?: number): Buffer {
  const pick = n === undefined ? '' : `select=eq(n\\,${n}),`;
  return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `${pick}scale=270:480`, '-fps_mode', 'passthrough', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
}
function rgbAt(file: string, n?: number): Buffer {
  const pick = n === undefined ? '' : `select=eq(n\\,${n}),`;
  return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `${pick}scale=135:240`, '-fps_mode', 'passthrough', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
}
const meanAbsDiff = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
/** The largest mean signed R, G or B difference of any 15×15 block: a wrong word lit, a missing box or shadow. */
function worstBlock(a: Buffer, b: Buffer): number {
  let worst = 0;
  for (let by = 0; by < 240; by += 15) for (let bx = 0; bx < 135; bx += 15) {
    const sum = [0, 0, 0];
    for (let y = by; y < by + 15; y++) for (let x = bx; x < bx + 15; x++) for (let c = 0; c < 3; c++) { const i = (y * 135 + x) * 3 + c; sum[c] += a[i] - b[i]; }
    worst = Math.max(worst, ...sum.map((v) => Math.abs(v) / (15 * 15)));
  }
  return worst;
}

/** The preview canvas as a picture once the playhead settles at `t` (60 px per second on the timeline). */
async function previewAt(page: Page, info: TestInfo, t: number, name: string): Promise<string> {
  // Nothing selected: a selection box lies over the preview and is not in the export. Escape every time — the box of
  // a selected caption is hidden only while the playhead is outside the caption, and comes back at `t`.
  await page.keyboard.press('Escape');
  await page.locator('.tl-scroll').evaluate((el, x) => { el.scrollLeft = x; }, t * 60);
  // While seeking the preview first shows the nearest keyframe, then the exact frame: the picture is taken from that
  // one (on a busy Mac the exact video frame came after a fixed 0.9 s wait, and the video, not the caption, differed).
  await expect.poll(() => page.evaluate((at) => {
    const l = (window as unknown as { __kadrPerf?: { last: { t: number; exact: boolean } } }).__kadrPerf?.last;
    return !!l && Math.abs(l.t - at) < 0.02 && l.exact;
  }, t), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.locator('.sel-box')).toBeHidden();
  const canvas = page.locator('.preview-canvas');
  const whole = info.outputPath(`${name}-element.png`);
  await canvas.screenshot({ path: whole, style: '.toast { visibility: hidden !important; }' });
  const b = await canvas.evaluate((c) => { const r = c.getBoundingClientRect(); return [r.x - Math.floor(r.x), r.y - Math.floor(r.y), r.width, r.height].map((v) => v * devicePixelRatio); });
  const [x, y, w, h] = b.map(Math.round);
  const shot = info.outputPath(`${name}.png`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', whole, '-vf', `crop=w='min(${w},iw-${x})':h='min(${h},ih-${y})':x=${x}:y=${y}`, shot]);
  return shot;
}

async function exportAs(page: Page, info: TestInfo, format: 'Video' | 'Photo', button: string, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: format, exact: true }).click();
  if (format === 'Video') await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: button }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 120_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const file = info.outputPath(`${name}-${(await dl).suggestedFilename()}`);
  await (await dl).saveAs(file);
  await page.getByRole('button', { name: 'Done' }).click();
  return file;
}

// test_ru.srt: "Привет из Kadr" 0.5–2 s (words 0.5–1.2, 1.2–1.5, 1.5–2.0), "Вторая строка ёж" from 2.5 s.
// 1.3 s: the second word is being said — lit, half filled (karaoke), coming in (words appear: 0.1 s of 0.2 s); with one
// word at a time, its line came in 0.1 s ago. 2.6 s: the second line came in 0.1 s ago (lines that move in).
const SAID = 1.3, NEW_LINE = 2.6;
const movesLines = (id: string) => { const p = CAPTION_PRESETS.find((x) => x.id === id)!; return !!p.motion && p.motion !== 'none' && p.layout !== 'reveal'; };

test('every caption template applies from the picker, and the preview is the photo export — mid-word, mid-motion', async ({ page }, info) => {
  test.setTimeout(1_500_000);
  await captioned(page);
  const rows: string[] = [];
  for (const pr of CAPTION_PRESETS) {
    await openCaptions(page);
    const tile = styles(page).getByRole('radio', { name: pr.name, exact: true });
    await tile.click();
    await expect(tile).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Done' }).click();
    for (const t of movesLines(pr.id) ? [SAID, NEW_LINE] : [SAID]) {
      const preview = await previewAt(page, info, t, `${pr.id}-${t}`);
      const photo = await exportAs(page, info, 'Photo', 'Save photo', `${pr.id}-${t}`);
      const [d, block] = [meanAbsDiff(grayAt(preview), grayAt(photo)), worstBlock(rgbAt(preview), rgbAt(photo))];
      rows.push(`${pr.id} @ ${t}: mean ${d.toFixed(2)}, worst block ${block.toFixed(1)}`);
      expect.soft(d, `${pr.id} @ ${t}: preview vs photo, mean`).toBeLessThan(4);
      expect.soft(block, `${pr.id} @ ${t}: preview vs photo, worst block`).toBeLessThan(20);
    }
  }
  console.log(`caption templates, preview vs photo (${info.project.name}):\n${rows.join('\n')}`);
  // Applying a template is one undo step: the one before comes back whole.
  await openCaptions(page);
  const last = CAPTION_PRESETS[CAPTION_PRESETS.length - 1], before = CAPTION_PRESETS[CAPTION_PRESETS.length - 2];
  await expect(styles(page).getByRole('radio', { name: last.name, exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await openCaptions(page);
  await expect(styles(page).getByRole('radio', { name: before.name, exact: true })).toHaveAttribute('aria-checked', 'true');
});

// One template for each new way of drawing (v1.5): the video's frames are the preview's and the photo's.
const FEATURES: { id: string; what: string }[] = [
  { id: 'hype', what: 'bigger spoken word, popping; solid shadow; line pops in' },
  { id: 'fill', what: 'karaoke fill' },
  { id: 'marker', what: 'box behind the word' },
  { id: 'popup', what: 'words appear, each popping in' },
  { id: 'zoom', what: 'one word at a time, zooming in' },
  { id: 'sunset', what: 'gradient letters' },
  { id: 'candy', what: 'double outline, springing in' },
  { id: 'news', what: 'a box per line, sliding in' },
  { id: 'block3d', what: '3D block' },
  { id: 'soft', what: 'words still to come dimmed' },
];

test('WYSIWYG in video for every new way of drawing captions: preview = photo = video frame', async ({ page }, info) => {
  test.setTimeout(1_500_000);
  await captioned(page);
  const rows: string[] = [];
  for (const { id, what } of FEATURES) {
    await openCaptions(page);
    await styles(page).getByRole('radio', { name: CAPTION_PRESETS.find((x) => x.id === id)!.name, exact: true }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    const video = await exportAs(page, info, 'Video', 'Export video', id);
    for (const t of movesLines(id) ? [SAID, NEW_LINE] : [SAID]) {
      const preview = await previewAt(page, info, t, `${id}-${t}`);
      const photo = await exportAs(page, info, 'Photo', 'Save photo', `${id}-${t}`);
      const n = Math.round(t * 30);
      const [dp, dv] = [meanAbsDiff(grayAt(preview), grayAt(photo)), meanAbsDiff(grayAt(preview), grayAt(video, n))];
      const [bp, bv] = [worstBlock(rgbAt(preview), rgbAt(photo)), worstBlock(rgbAt(preview), rgbAt(video, n))];
      rows.push(`${id} (${what}) @ ${t}: photo ${dp.toFixed(2)} / block ${bp.toFixed(1)}, video ${dv.toFixed(2)} / block ${bv.toFixed(1)}`);
      expect.soft(dp, `${id} @ ${t}: photo`).toBeLessThan(4);
      expect.soft(dv, `${id} @ ${t}: video frame`).toBeLessThan(6);
      expect.soft(bp, `${id} @ ${t}: photo, worst block`).toBeLessThan(20);
      expect.soft(bv, `${id} @ ${t}: video frame, worst block`).toBeLessThan(20);
    }
  }
  console.log(`WYSIWYG caption features (${info.project.name}):\n${rows.join('\n')}`);
});

const LEGACY_TEXT = TEXT_PRESETS.slice(0, TEXT_PRESETS.findIndex((p) => p.id === 'rounded')).map((p) => p.id);

test('every template reads on white, black, grey and a busy picture, in Cyrillic and Latin, and draws fast (?styles)', async ({ page, browserName }, info) => {
  test.setTimeout(600_000);
  // A mid-range phone, as in the perf bench (docs/04): Chromium's CPU slowed 4×. WebKit cannot be slowed.
  const slowed = browserName === 'chromium';
  if (slowed) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto('./?styles');
  await page.waitForFunction(() => (window as unknown as { __kadrStyles?: StylesReport }).__kadrStyles?.done, null, { timeout: 540_000, polling: 1000 });
  const r = await page.evaluate(() => (window as unknown as { __kadrStyles: StylesReport }).__kadrStyles);
  // Both alphabets come from Kadr's own faces, never a fallback font, for every face a template can use.
  expect(r.fonts.length).toBe(32);
  expect(r.fonts.filter((f) => f.cyrillic || f.latin).map((f) => `${f.id}: ${f.cyrillic}${f.latin}`)).toEqual([]);
  const minEdge = (x: StylesReport['rows'][number]) => Math.min(...Object.values(x.edge));
  const checked = r.rows.filter((x) => x.kind === 'caption' || !LEGACY_TEXT.includes(x.id));
  expect(checked.filter((x) => x.kind === 'caption').length).toBe(CAPTION_PRESETS.length * 2);
  expect(checked.filter((x) => minEdge(x) < 3).map((x) => `${x.kind} ${x.id} ${x.lang}: ${JSON.stringify(x.edge)}`)).toEqual([]);
  // Speed: a caption is drawn again only when it changes (a word, a karaoke step). At the preview's size every template
  // takes at most half a 30 fps frame on the slowed CPU.
  const isNew = (x: StylesReport['rows'][number]) => (x.kind === 'caption' ? CAPTION_PRESETS.findIndex((p) => p.id === x.id) >= 9 : !LEGACY_TEXT.includes(x.id));
  const stat = (xs: typeof r.rows, k: 'ms' | 'msPreview') => { const v = xs.map((x) => x[k]).sort((a, b) => a - b); return `median ${v[v.length >> 1]}, max ${v[v.length - 1]}`; };
  // WebKit cannot be slowed, and on a busy Mac its times float: there a template may take at most 2.5× the slowest style
  // before v1.5 measured in the same run (and never fails under 12 ms).
  const budget = slowed ? 16 : Math.max(12, 2.5 * Math.max(...r.rows.filter((x) => !isNew(x)).map((x) => x.msPreview)));
  console.log(`?styles (${info.project.name}${slowed ? ', CPU 4× slower' : ''}): ${r.rows.length} drawings. Preview size (540×960): before v1.5 ${stat(r.rows.filter((x) => !isNew(x)), 'msPreview')} ms, v1.5 ${stat(r.rows.filter(isNew), 'msPreview')} ms. Export size (1080×1920): before ${stat(r.rows.filter((x) => !isNew(x)), 'ms')}, v1.5 ${stat(r.rows.filter(isNew), 'ms')} ms. Slowest: ${[...r.rows].sort((a, b) => b.msPreview - a.msPreview).slice(0, 5).map((x) => `${x.kind} ${x.id} ${x.msPreview}/${x.ms}`).join(', ')}. Weakest caption edge ${Math.min(...checked.filter((x) => x.kind === 'caption').map(minEdge)).toFixed(2)}`);
  expect(r.rows.filter((x) => x.msPreview > budget).map((x) => `${x.kind} ${x.id} ${x.lang}: ${x.msPreview} ms at preview size (budget ${budget})`)).toEqual([]);
});

/** Problems of the open sheet at the current width: sideways scroll, controls without names, small targets of ours. */
async function audit(page: Page, where: string): Promise<string[]> {
  return page.evaluate((w) => {
    const out: string[] = [];
    const vw = window.innerWidth;
    if (document.scrollingElement!.scrollWidth > vw) out.push(`${w}: the page scrolls sideways`);
    const body = document.querySelector<HTMLElement>('.sheet-body');
    if (body && body.scrollWidth > body.clientWidth + 1) out.push(`${w}: the sheet scrolls sideways`);
    for (const el of document.querySelectorAll<HTMLElement>('.pick-cat, .tile, .sticker')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.width < 44 || r.height < 44)) out.push(`${w}: ${el.getAttribute('aria-label') ?? el.textContent} is ${Math.round(r.width)}×${Math.round(r.height)}`);
      if (!(el.getAttribute('aria-label') ?? el.textContent ?? '').trim()) out.push(`${w}: a control without a name`);
    }
    return out;
  }, where);
}

test('the pickers at 375 px: categories jump, one hand, no sideways scroll, targets ≥ 44 px; Russian and English', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await captioned(page);
  await openCaptions(page);
  const problems: string[] = [...await audit(page, 'captions')];
  // Every category is a button that brings its first template into view.
  for (const c of CAPTION_CATEGORIES) {
    await page.locator('.pick-cat', { hasText: new RegExp(`^${c.name}$`) }).click();
    const first = CAPTION_PRESETS.find((p) => p.cat === c.id)!;
    await expect(styles(page).getByRole('radio', { name: first.name, exact: true })).toBeInViewport({ timeout: 3000 });
    await expect(page.locator('.pick-cat.on')).toHaveText(c.name);
  }
  // Previews are drawn (not blank) for the templates on screen.
  await expect.poll(() => page.locator('.pick-strip canvas').evaluateAll((cs) => (cs as HTMLCanvasElement[])
    .filter((c) => { const r = c.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth; })
    .filter((c) => { const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; }).length), { timeout: 15_000 }).toBeGreaterThanOrEqual(4);
  await page.getByRole('button', { name: 'Done' }).click();
  // The caption settings (Create again), text styles, stickers.
  await openCaptions(page);
  await page.getByRole('button', { name: 'Create again…' }).click();
  problems.push(...await audit(page, 'create captions'));
  await page.keyboard.press('Escape');
  const close = page.getByRole('button', { name: 'Close tools' });
  if (await close.isVisible()) await close.click();
  await tool(page, 'Text').click();
  await expect(styles(page).getByRole('radio')).toHaveCount(TEXT_PRESETS.length);
  problems.push(...await audit(page, 'text'));
  await page.getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('Escape');
  if (await close.isVisible()) await close.click();
  await tool(page, 'Stickers').click();
  problems.push(...await audit(page, 'stickers'));
  expect(problems).toEqual([]);
  // A template survives a reload whole: the template, and how its spoken word stands out.
  await page.getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('Escape');
  await openCaptions(page);
  await styles(page).getByRole('radio', { name: 'Fill', exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: 'The spoken word' }).getByRole('radio', { name: 'Karaoke fill' })).toBeChecked();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(1200); // autosave
  // Russian: the same catalog with Russian names.
  await page.evaluate(() => localStorage.setItem('kadr.locale', 'ru'));
  await page.reload();
  await page.locator('.clip-caption').click();
  await tool(page, 'Субтитры').click();
  await expect(page.getByRole('radiogroup', { name: 'Стиль' }).getByRole('radio', { name: 'Караоке-заливка' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radiogroup', { name: 'Произносимое слово' }).getByRole('radio', { name: 'Караоке-заливка' })).toBeChecked();
  await expect(page.locator('.pick-cat')).toHaveText(['Блогер', 'Минимализм', 'Яркие', 'Караоке', 'Игровые', 'Деловые', 'С анимацией']);
  expect(await audit(page, 'captions, Russian')).toEqual([]);
});
