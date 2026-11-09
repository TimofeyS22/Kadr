// "Hide faces" against the truth (audit V-179). The older checks ask whether something changed near a face, so a face
// left in sight on some frames, or a box beside it, passed. Here fixtures/walk.mp4 has a person whose eyes, nose and mouth
// are at a known place on every frame; on every frame of the file that whole area must lose its detail, and the rest stay.
// Every frame, not a sample: a control that misses one frame in three got past five samples spaced a multiple of three apart.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const W = 1280, H = 720;
/** Eyes to chin in person.jpg, read off the picture and scaled as the fixture scales it (height 640), plus its y = 80. */
const FACE = { x: 196, w: 84, y: 191, h: 80 };
/** The head with hair and the margin the hiding adds (it reaches x 105-370, y 95-360); anything outside must stay as it was. */
const HEAD = { x: 90, w: 320, y: 60, h: 320 };
const FPS = 30, FRAMES = 150; // 5 s
const faceAt = (n: number) => ({ ...FACE, x: Math.round(50 + (n / FPS) * 150 + FACE.x) });

/** Hidden if at most this share of the detail is left between eyes and chin. */
const MAX_DETAIL_LEFT = 0.5;
/** Pixels outside the head that may change by more than a compression error. */
const MAX_OUTSIDE_CHANGED = 0.02;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
  });
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: undefined })); // headless WebKit has no share sheet
});

/** Every frame of a file, gray, one after another. */
const allFrames = (file: string) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 512 << 20 });
const frameOf = (all: Buffer, n: number) => all.subarray(n * W * H, (n + 1) * W * H);

/** Sum of differences between neighbouring pixels in a box: how much detail it holds. */
function detail(g: Buffer, b: { x: number; y: number; w: number; h: number }) {
  let sum = 0;
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) sum += Math.abs(g[y * W + x] - g[y * W + x + 1]) + Math.abs(g[y * W + x] - g[(y + 1) * W + x]);
  return sum;
}
function outsideChanged(a: Buffer, b: Buffer, n: number) {
  const left = Math.round(50 + (n / FPS) * 150 + HEAD.x);
  let changed = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x >= left && x < left + HEAD.w && y >= HEAD.y && y < HEAD.y + HEAD.h) continue;
    if (Math.abs(a[y * W + x] - b[y * W + x]) > 24) changed++;
  }
  return changed / (W * H);
}
function problems(before: Buffer, after: Buffer): string[] {
  const out: string[] = [];
  const count = Math.min(before.length, after.length) / (W * H);
  if (count !== FRAMES) out.push(`${count} frames, ${FRAMES} expected`);
  for (let n = 0; n < count; n++) {
    const a = frameOf(before, n), b = frameOf(after, n);
    const left = detail(b, faceAt(n)) / detail(a, faceAt(n));
    if (left > MAX_DETAIL_LEFT) out.push(`frame ${n}: the face keeps ${Math.round(left * 100)}% of its detail`);
    const moved = outsideChanged(a, b, n);
    if (moved > MAX_OUTSIDE_CHANGED) out.push(`frame ${n}: ${(moved * 100).toFixed(1)}% of the frame outside the head changed`);
  }
  return out;
}

async function exportVideo(page: Page, info: TestInfo, name: string) {
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: 'Export video' }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 240_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const file = info.outputPath(name);
  await (await dl).saveAs(file);
  await page.getByRole('button', { name: 'Done' }).click();
  return file;
}

test('on every sampled frame of a moving person the face is hidden from eyes to chin, and only the head changes', async ({ page }, info) => {
  test.setTimeout(420_000);
  test.skip(!fs.existsSync(fx('walk.mp4')), 'needs npm run fixtures');
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '16:9' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx('walk.mp4'));
  const clip = page.locator('.tl-row.main .clip').first();
  await expect(clip).toHaveCount(1);
  const before = await exportVideo(page, info, 'before.mp4');
  await expect(async () => {
    if (!(await clip.getAttribute('class'))?.includes(' sel')) await clip.click();
    await expect(clip).toHaveClass(/ sel/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Hide faces', exact: true }).click();
  const hide = page.getByRole('switch', { name: 'Hide faces automatically' });
  await hide.click();
  await expect(hide).toBeChecked({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  const after = await exportVideo(page, info, 'after.mp4');
  const plain = allFrames(before), hidden = allFrames(after);
  const left = Array.from({ length: FRAMES }, (_, n) => detail(frameOf(hidden, n), faceAt(n)) / detail(frameOf(plain, n), faceAt(n)));
  console.log(`face detail left over ${FRAMES} frames (${info.project.name}): worst ${Math.round(Math.max(...left) * 100)}%`);
  expect(problems(plain, hidden)).toEqual([]);
  // The control: the same analysis on a file with nothing hidden has to complain about every frame.
  expect(problems(plain, plain).length, 'nothing hidden is seen as nothing hidden').toBe(FRAMES);
});
