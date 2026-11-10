// A speech model never comes without the person's yes (audit V-181). The first tap on Captions or on the reel used
// to start 132–225 MB at once, on mobile data too. Now the sheet asks first, with the size; "Not now" leaves
// everything as it was; and a model this device already keeps brings no question at all: one tap, as before.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.use({ serviceWorkers: 'block' }); // the speech worker's requests must reach the request log

/** Every request for a model file, by the page or its workers: under /models/ on Kadr's site, or to Hugging Face. */
function modelRequests(context: BrowserContext): string[] {
  const urls: string[] = [];
  context.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.includes('/models/') || /(^|\.)(huggingface\.co|hf\.co)$/.test(u.hostname)) urls.push(u.host + u.pathname);
  });
  return urls;
}

interface Seen { asks: number; errors: string[] }
/** How many times the question came up, and every error toast shown (they disappear after a few seconds). */
async function watch(page: Page, locale: 'en' | 'ru') {
  await page.addInitScript((l) => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', l);
    localStorage.setItem('kadr.hint.move', '1');
    const seen: Seen = ((window as unknown as { __seen: Seen }).__seen = { asks: 0, errors: [] });
    let up = false;
    new MutationObserver(() => {
      const now = !!document.querySelector('.model-ask');
      if (now && !up) seen.asks++;
      up = now;
      document.querySelectorAll('.toast.error').forEach((el) => { if (!seen.errors.includes(el.textContent ?? '')) seen.errors.push(el.textContent ?? ''); });
    }).observe(document, { subtree: true, childList: true });
  }, locale);
}
const seen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: Seen }).__seen);

const WORDS = {
  en: { create: 'New project', media: 'Media', close: 'Close tools' },
  ru: { create: 'Новый проект', media: 'Медиа', close: 'Закрыть инструменты' },
};
/** Back to the main toolbar, when a selected clip's tools are showing. */
async function closeTools(page: Page) {
  const b = page.getByRole('button', { name: 'Close tools' });
  if (await b.isVisible()) await b.click();
}

async function speechProject(page: Page, locale: 'en' | 'ru', file: string) {
  const w = WORDS[locale];
  await page.goto('./');
  await page.getByRole('button', { name: w.create }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await tool(page, w.media).click();
  await (await chooser).setFiles([fx(file)]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: w.close }).click();
}

const ask = (page: Page) => page.locator('.model-ask');
/** Long enough for a download to have begun: before the fix the first model request left within a second of the tap. */
const QUIET_MS = 3000;

test('the first tap on Captions downloads nothing: no model request leaves before the person says yes', async ({ page, context }) => {
  test.setTimeout(120_000);
  const asked = modelRequests(context);
  await watch(page, 'en');
  await speechProject(page, 'en', 'speech_en.mp4');
  await tool(page, 'Captions').click(); // one tap: it starts by itself
  await page.waitForTimeout(QUIET_MS);
  expect(asked, 'model requests before any consent').toEqual([]);
  await expect(ask(page)).toBeVisible();
  // Yes: only now the model comes — the one that was named, and the 2 MB speech detector it works with.
  await ask(page).getByRole('button', { name: 'Download and make captions', exact: true }).click();
  await expect.poll(() => asked.filter((u) => u.includes('whisper-base_timestamped')).length, { timeout: 60_000 }).toBeGreaterThan(0);
  expect(asked.filter((u) => !/whisper-base_timestamped|silero-vad/.test(u))).toEqual([]);
});

test('Captions, the first time: the question names the size; "Not now" leaves everything as it was; with the model on the device there is no question', async ({ page, context }) => {
  test.setTimeout(500_000);
  const asked = modelRequests(context);
  await watch(page, 'en');
  await speechProject(page, 'en', 'speech_en.mp4');
  await tool(page, 'Captions').click();
  await expect(ask(page)).toBeVisible();
  await expect(ask(page)).toContainText('77 MB will be downloaded once; after that captions work offline.'); // "Accurate", Whisper base
  await expect(ask(page)).not.toContainText('mobile data'); // this browser does not say it is on one
  await expect(page.locator('[role=progressbar]')).toHaveCount(0); // nothing is running yet

  // Not now: the settings as they were, no captions, no toast of any kind, and still not one request.
  await ask(page).getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(ask(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create captions', exact: true })).toBeVisible();
  await page.waitForTimeout(QUIET_MS);
  await expect(page.locator('.toast')).toHaveCount(0);
  await expect(page.locator('.clip-caption')).toHaveCount(0);
  expect(asked).toEqual([]);

  // Captions from the person's own text run the same model: the same question, before anything is downloaded.
  await page.getByRole('radio', { name: 'From my text' }).click();
  await page.getByRole('textbox', { name: 'Your text' }).fill('Hello. This is a test of captions in the video editor.');
  await page.getByRole('button', { name: 'Create captions', exact: true }).click();
  await expect(ask(page)).toContainText('77 MB');
  await page.waitForTimeout(QUIET_MS);
  expect(asked).toEqual([]);
  await ask(page).getByRole('button', { name: 'Not now', exact: true }).click();
  // Closing the sheet with the question on it is "not now" as well: no guard asks to tap twice, nothing starts.
  await page.getByRole('radio', { name: 'Recognize speech' }).click();
  await page.getByRole('button', { name: 'Create captions', exact: true }).click();
  await expect(ask(page)).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.sheet')).toHaveCount(0);
  await page.waitForTimeout(QUIET_MS);
  expect(asked).toEqual([]);
  expect((await seen(page)).errors).toEqual([]);

  // Yes: the captions are made.
  await tool(page, 'Captions').click();
  await ask(page).getByRole('button', { name: 'Download and make captions', exact: true }).click();
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 300_000 });
  expect(asked.some((u) => u.includes('whisper-base_timestamped'))).toBe(true);
  expect((await seen(page)).asks).toBe(4);

  // The model is on the device now. One tap makes captions again, with no question and no model request…
  const before = asked.length;
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.clip-caption')).toHaveCount(0);
  await closeTools(page);
  await tool(page, 'Captions').click();
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 300_000 });
  // …and so does the reel, from the editor's tools.
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await closeTools(page);
  await tool(page, 'Reel in 1 tap').click();
  await page.getByRole('button', { name: 'Make the reel', exact: true }).click();
  await expect(page.locator('.reel-done')).toBeVisible({ timeout: 300_000 });
  expect((await seen(page)).asks).toBe(4);
  expect(asked.slice(before)).toEqual([]);
  expect((await seen(page)).errors).toEqual([]);
});

test('Russian interface: the question names the model this device would use, in Russian, and "Не сейчас" asks the network for nothing', async ({ page, context, browserName }) => {
  test.setTimeout(180_000);
  const asked = modelRequests(context);
  await watch(page, 'ru');
  await speechProject(page, 'ru', 'speech_ru.mp4');
  // An iPhone gets the compact model (132 MB); a device with memory to spare, GigaAM (225 MB).
  const mb = browserName === 'webkit' ? 132 : 225;
  await tool(page, 'Субтитры').click();
  await expect(ask(page)).toContainText(`Один раз скачается ${mb} МБ, после этого субтитры работают без интернета.`);
  await page.waitForTimeout(QUIET_MS);
  expect(asked).toEqual([]);
  await ask(page).getByRole('button', { name: 'Не сейчас', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Создать субтитры', exact: true })).toBeVisible();
  // Another model, another size: the question follows what was chosen (here "Точно", Whisper base).
  await page.getByRole('radio', { name: /, 77 / }).click();
  await page.getByRole('button', { name: 'Создать субтитры', exact: true }).click();
  await expect(ask(page)).toContainText('Один раз скачается 77 МБ');
  await ask(page).getByRole('button', { name: 'Не сейчас', exact: true }).click();
  await page.waitForTimeout(QUIET_MS);
  expect(asked).toEqual([]);
  await expect(page.locator('.toast')).toHaveCount(0);
  expect((await seen(page)).errors).toEqual([]);
  // Yes to the default: the first model request is for that model, and only after the tap.
  await page.getByRole('radio', { name: new RegExp(`, ${mb} `) }).click();
  await page.getByRole('button', { name: 'Создать субтитры', exact: true }).click();
  await ask(page).getByRole('button', { name: 'Скачать и сделать субтитры', exact: true }).click();
  const repo = mb === 132 ? 'stt_ru_fastconformer' : 'gigaam-v3-onnx';
  await expect.poll(() => asked.filter((u) => u.includes(repo)).length, { timeout: 60_000 }).toBeGreaterThan(0);
  expect(asked.filter((u) => !u.includes(repo) && !u.includes('silero-vad'))).toEqual([]);
});

test('"Reel in 1 tap" from the home screen: the question comes before any download; "Not now" leaves the video untouched', async ({ page, context }) => {
  test.setTimeout(180_000);
  const asked = modelRequests(context);
  await watch(page, 'en');
  await page.goto('./');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Reel in 1 tap/ }).click();
  await (await chooser).setFiles(fx('speech_en.mp4'));
  await expect(ask(page)).toBeVisible({ timeout: 60_000 }); // the reel starts by itself: the question is what it starts with
  await expect(ask(page)).toContainText('77 MB will be downloaded once');
  await page.waitForTimeout(QUIET_MS);
  expect(asked).toEqual([]);
  await ask(page).getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Make the reel', exact: true })).toBeVisible();
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await expect(page.locator('.clip-caption')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveCount(0);
  // From the reel's own button (the same sheet the editor's "Reel in 1 tap" tool opens): asked again, nothing sent.
  await page.getByRole('button', { name: 'Make the reel', exact: true }).click();
  await expect(ask(page)).toBeVisible();
  await page.waitForTimeout(QUIET_MS);
  expect(asked).toEqual([]);
  expect((await seen(page)).errors).toEqual([]);
  // A reel that does not listen to speech needs no model and asks nothing.
  await ask(page).getByRole('button', { name: 'Not now', exact: true }).click();
  for (const name of ['Remove “um”, “uh” and repeats', 'Captions with the spoken word highlighted', 'Title from the first phrase']) await page.getByRole('switch', { name }).click();
  await page.getByRole('radio', { name: 'No music' }).click();
  await page.getByRole('button', { name: 'Make the reel', exact: true }).click();
  await expect(page.locator('.reel-done')).toBeVisible({ timeout: 60_000 });
  expect((await seen(page)).asks).toBe(2);
  expect(asked).toEqual([]);
  // Back to a reel with captions: yes, and only then the model comes.
  await page.getByRole('button', { name: 'Undo all' }).click();
  await page.getByRole('switch', { name: 'Captions with the spoken word highlighted' }).click();
  await page.getByRole('button', { name: 'Make the reel', exact: true }).click();
  await ask(page).getByRole('button', { name: 'Download and make the reel', exact: true }).click();
  await expect.poll(() => asked.filter((u) => u.includes('whisper-base_timestamped')).length, { timeout: 60_000 }).toBeGreaterThan(0);
});

test('"Reel in 1 tap" in the editor: the same question, before any download', async ({ page, context }) => {
  test.setTimeout(120_000);
  const asked = modelRequests(context);
  await watch(page, 'en');
  await speechProject(page, 'en', 'speech_en.mp4');
  await tool(page, 'Reel in 1 tap').click();
  await page.getByRole('button', { name: 'Make the reel', exact: true }).click();
  await expect(ask(page)).toContainText('77 MB will be downloaded once');
  await page.waitForTimeout(QUIET_MS);
  expect(asked).toEqual([]);
  await ask(page).getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Make the reel', exact: true })).toBeVisible();
  await expect(page.locator('.toast')).toHaveCount(0);
  expect(asked).toEqual([]);
  expect((await seen(page)).errors).toEqual([]);
});

test('speech that is not Russian under the Russian model: Whisper is asked about before it is downloaded, and "Не сейчас" ends the run without an error', async ({ page, context, browserName }) => {
  test.setTimeout(500_000);
  // A phone's memory in Chromium too, so both engines start with the compact Russian model (an iPhone always does).
  if (browserName !== 'webkit') await page.addInitScript(() => Object.defineProperty(navigator, 'deviceMemory', { value: 4 }));
  const asked = modelRequests(context);
  await watch(page, 'ru');
  await speechProject(page, 'ru', 'speech_en.mp4'); // English speech, language "Auto"
  await tool(page, 'Субтитры').click();
  await expect(ask(page)).toContainText('Один раз скачается 132 МБ');
  await ask(page).getByRole('button', { name: 'Скачать и сделать субтитры', exact: true }).click();
  // The Russian model listens, is not sure this is Russian, and Whisper is needed: asked, not taken.
  await expect(ask(page)).toContainText('Это не похоже на русскую речь', { timeout: 400_000 });
  await expect(ask(page)).toContainText('Один раз скачается 77 МБ');
  await page.waitForTimeout(QUIET_MS);
  expect(asked.filter((u) => u.includes('whisper'))).toEqual([]);
  await ask(page).getByRole('button', { name: 'Не сейчас', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Создать субтитры', exact: true })).toBeVisible();
  await page.waitForTimeout(QUIET_MS);
  await expect(page.locator('.clip-caption')).toHaveCount(0);
  expect(asked.filter((u) => u.includes('whisper'))).toEqual([]);
  expect((await seen(page)).errors).toEqual([]);
  // Again: the Russian model is on the device (no question about it); yes to Whisper, and the captions are made.
  await page.getByRole('button', { name: 'Создать субтитры', exact: true }).click();
  await expect(ask(page)).toContainText('Один раз скачается 77 МБ', { timeout: 400_000 });
  expect((await seen(page)).asks).toBe(3);
  await ask(page).getByRole('button', { name: 'Скачать и сделать субтитры', exact: true }).click();
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 400_000 });
  expect(asked.some((u) => u.includes('whisper-base_timestamped'))).toBe(true);
  expect((await seen(page)).errors).toEqual([]);
});

test('the question fits a 375 px phone, in Russian and on mobile data: no sideways scroll, both answers at least 44 px tall', async ({ page, context }) => {
  test.setTimeout(120_000);
  const asked = modelRequests(context);
  await page.setViewportSize({ width: 375, height: 667 });
  // Chromium on Android says what network it is on; WebKit says nothing, so it is given the same answer here.
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { type: 'cellular', saveData: false }, configurable: true }));
  await watch(page, 'ru');
  await speechProject(page, 'ru', 'speech_ru.mp4');
  await tool(page, 'Субтитры').click();
  await expect(ask(page)).toBeVisible();
  await expect(ask(page)).toContainText('Сейчас вы на мобильном интернете.');
  const box = await page.evaluate(() => {
    const el = document.querySelector('.model-ask')!, body = el.closest('.sheet-body')!;
    return {
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sheet: body.scrollWidth - body.clientWidth,
      buttons: [...el.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return { h: r.height, left: r.left, right: r.right, bottom: r.bottom }; }),
      texts: [...el.querySelectorAll('p')].map((p) => { const r = p.getBoundingClientRect(); return { left: r.left, right: r.right }; }),
      height: innerHeight,
    };
  });
  expect(box.page, 'the page scrolls sideways').toBeLessThanOrEqual(0);
  expect(box.sheet, 'the sheet scrolls sideways').toBeLessThanOrEqual(0);
  expect(box.buttons).toHaveLength(2);
  for (const b of box.buttons) {
    expect(b.h).toBeGreaterThanOrEqual(44);
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(375);
    expect(b.bottom, 'both answers are on screen without scrolling').toBeLessThanOrEqual(box.height);
  }
  for (const p of box.texts) { expect(p.left).toBeGreaterThanOrEqual(0); expect(p.right).toBeLessThanOrEqual(375); }
  expect(asked).toEqual([]);
  // The reel's button is at the bottom of a sheet that scrolls: the question still starts from its first word.
  await ask(page).getByRole('button', { name: 'Не сейчас', exact: true }).click();
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await tool(page, 'Рилс в 1 тап').click();
  await page.getByRole('button', { name: 'Сделать рилс', exact: true }).click();
  await expect(ask(page)).toContainText('Сейчас вы на мобильном интернете.');
  const reel = await page.evaluate(() => {
    const el = document.querySelector('.model-ask')!, body = el.closest('.sheet-body')!;
    return { text: el.querySelector('p')!.getBoundingClientRect().top, body: body.getBoundingClientRect().top, last: [...el.querySelectorAll('button')].pop()!.getBoundingClientRect().bottom, height: innerHeight };
  });
  expect(reel.text, 'the first line is under the sheet header, not scrolled behind it').toBeGreaterThanOrEqual(reel.body);
  expect(reel.last).toBeLessThanOrEqual(reel.height);
  await ask(page).getByRole('button', { name: 'Не сейчас', exact: true }).click();
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await tool(page, 'Субтитры').click();
  // "Data saving is on" counts the same, whatever the network.
  await ask(page).getByRole('button', { name: 'Не сейчас', exact: true }).click();
  await page.evaluate(() => Object.defineProperty(navigator, 'connection', { value: { type: 'wifi', saveData: true }, configurable: true }));
  await page.getByRole('button', { name: 'Создать субтитры', exact: true }).click();
  await expect(ask(page)).toContainText('Сейчас вы на мобильном интернете.');
  // Wi-Fi without data saving: the question says nothing about the network.
  await ask(page).getByRole('button', { name: 'Не сейчас', exact: true }).click();
  await page.evaluate(() => Object.defineProperty(navigator, 'connection', { value: { type: 'wifi', saveData: false }, configurable: true }));
  await page.getByRole('button', { name: 'Создать субтитры', exact: true }).click();
  await expect(ask(page)).toBeVisible();
  await expect(ask(page)).not.toContainText('мобильном интернете');
});
