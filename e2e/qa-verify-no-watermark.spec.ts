// Sweep lane E2 (docs/21 §4, `C-*` rows): invariant N8 of docs/16 — no watermark (C-A1). A plain-colour picture is
// exported as a video and as a photo, and every pixel of the file is that colour: a badge, a logo or a line of text added
// only to the file would stand out by tens of levels. The frame comparisons elsewhere use a mean over the frame, which a
// small corner badge can slip under.
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const W = 360, H = 640;

// As the editor suite starts: tips seen, the iPhone format card seen, English, and the export sheet instead of the one-tap export.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.undoMoved.v1', '1'); localStorage.setItem('kadr.locale', 'en'); localStorage.setItem('kadr.hint.move', '1');
    if (!localStorage.getItem('kadr.exportPrefs')) localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
  });
  // Saving goes to the downloads, as in the editor suite: Playwright has no share sheet to hand a file to.
  await page.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: undefined }); });
});

/** Every pixel of `file` (at second `t`) as RGB, scaled to W×H. */
function pixels(file: string, t: number): Uint8Array {
  return execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 16 << 20 });
}

/** How many pixels differ from the frame's median colour by more than `by` levels in some channel. */
function offColour(px: Uint8Array, by: number): { off: number; median: number[] } {
  const median = [0, 1, 2].map((ch) => { const v: number[] = []; for (let i = ch; i < px.length; i += 3) v.push(px[i]); v.sort((a, b) => a - b); return v[v.length >> 1]; });
  let off = 0;
  for (let i = 0; i < px.length; i += 3) if (Math.max(Math.abs(px[i] - median[0]), Math.abs(px[i + 1] - median[1]), Math.abs(px[i + 2] - median[2])) > by) off++;
  return { off, median };
}

async function save(page: Page, outputPath: (n: string) => string): Promise<string> {
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 240_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const file = outputPath((await dl).suggestedFilename());
  await (await dl).saveAs(file);
  return file;
}

test('a plain-colour picture comes out plain edge to edge, as a video and as a photo: no watermark (C-A1)', async ({ page }, info) => {
  test.setTimeout(420_000);
  const png = info.outputPath('plain.png');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x3a6ea5:s=720x1280', '-frames:v', '1', png]);
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles([png]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 60_000 });

  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: 'Export video' }).click();
  const video = await save(page, (n) => info.outputPath(n));
  for (const t of [0.2, 1.5]) {
    const { off, median } = offColour(pixels(video, t), 24);
    expect(median.map((v, i) => Math.abs(v - [0x3a, 0x6e, 0xa5][i])).every((d) => d <= 12), `video at ${t} s is the picture's colour: ${median}`).toBe(true);
    expect(off, `video at ${t} s: pixels off the colour`).toBe(0);
  }

  await page.keyboard.press('Escape'); // the sheet closes; the photo is a new export
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Photo', exact: true }).click();
  await page.getByRole('button', { name: 'Save photo' }).click();
  const photo = await save(page, (n) => info.outputPath(n));
  expect(offColour(pixels(photo, 0), 24).off, 'photo: pixels off the colour').toBe(0);
});
