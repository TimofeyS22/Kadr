// docs/20 («субтитры без вопросов»): the six complaints of the owner, 2026-11-13, as tests of what a person sees.
//   С1/С2 — the model downloads once, and the screen says "downloading" only while bytes come from the network;
//   С3    — Russian speech is read by the Russian model whatever the interface language (Auto);
//   С4    — Russian speech under music is not sent to Whisper to learn its language;
//   С6    — a caption template's tile is never empty;
//   С7    — the word under the playhead is marked; captions for a part of the video keep the rest, corrections included.
// Needs `npm run fixtures` and a build with the models mirrored (scripts/mirror-models.mjs): see e2e-local-models.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fixture = (name: string) => path.join(import.meta.dirname, '..', 'fixtures', name);

async function open(page: Page, locale: 'ru' | 'en', file: string) {
  await page.addInitScript((l) => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1'); localStorage.setItem('kadr.locale', l);
    // Every line the work panel shows, in order: what the person reads while captions are made.
    const seen: string[] = [];
    (window as unknown as { __said: string[] }).__said = seen;
    new MutationObserver(() => {
      const s = document.querySelector('.ck-work-label')?.textContent ?? '';
      if (s && seen[seen.length - 1] !== s) seen.push(s);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  }, locale);
  await page.goto('./');
  await page.getByRole('button', { name: locale === 'ru' ? 'Новый проект' : 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: locale === 'ru' ? 'Медиа' : 'Media', exact: true }).click();
  await (await chooser).setFiles(fixture(file));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: locale === 'ru' ? 'Закрыть инструменты' : 'Close tools' }).click();
}
const said = (page: Page) => page.evaluate(() => (window as unknown as { __said: string[] }).__said.slice());
const forget = (page: Page) => page.evaluate(() => { (window as unknown as { __said: string[] }).__said.length = 0; });
const lines = (page: Page) => page.locator('.caption-row input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
/** Requests for the large files of speech models (their parts on the site, or ranges of them on Hugging Face). */
function modelRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (r) => { if (/\.onnx(\.parts\/\d+)?(\?|$)/.test(r.url())) urls.push(r.url()); });
  return urls;
}

test('captions in Russian: the model downloads once and the screen says so; a part made again keeps the corrected rest; the word under the playhead is marked', async ({ page }) => {
  test.setTimeout(600_000);
  const requests = modelRequests(page);
  await open(page, 'ru', 'eval_ru.mp4');

  // The first tap: the question names the megabytes, the work says "downloading" with the same number, then "starting".
  await page.getByRole('button', { name: 'Субтитры', exact: true }).click();
  const ask = page.locator('.model-ask');
  await expect(ask).toBeVisible();
  const mb = /(\d+) МБ/.exec((await ask.textContent()) ?? '')?.[1];
  expect(Number(mb)).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Скачать и сделать субтитры', exact: true }).click();
  await expect(page.locator('.caption-row').first()).toBeVisible({ timeout: 400_000 });
  const first = await said(page);
  expect(first).toContain(`Скачиваем модель речи: ${mb} МБ, один раз…`);
  expect(first).toContain('Запускаем модель речи (она уже на устройстве)…');
  expect(first.indexOf('Запускаем модель речи (она уже на устройстве)…')).toBeGreaterThan(first.indexOf(`Скачиваем модель речи: ${mb} МБ, один раз…`));
  expect(requests.length).toBeGreaterThan(0);
  const whole = await lines(page);
  expect(whole.join(' ')).toContain('привет');

  // The word under the playhead: the line it is on is the current one, and the mark lies on its word, where the
  // field draws that word.
  await page.locator('.caption-row input').nth(3).focus();
  await page.locator('.caption-row input').nth(3).blur();
  const now = page.locator('.caption-row[data-now]');
  await expect(now).toHaveCount(1);
  await expect(now.locator('input')).toHaveAttribute('aria-current', 'true');
  expect(await page.locator('.caption-row').evaluateAll((rows) => rows.findIndex((r) => r.hasAttribute('data-now')))).toBe(3);
  const mark = await now.evaluate((row) => {
    const f = row.querySelector('input')!, m = row.querySelector('mark')!;
    const cs = getComputedStyle(f), c = document.createElement('canvas').getContext('2d')!;
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return { word: m.textContent, first: f.value.split(' ')[0], left: m.getBoundingClientRect().left - f.getBoundingClientRect().left, pad: parseFloat(cs.paddingLeft), width: m.getBoundingClientRect().width, want: c.measureText(m.textContent ?? '').width };
  });
  expect(mark.word).toBe(mark.first);
  expect(Math.abs(mark.left - mark.pad)).toBeLessThan(1.5);
  expect(Math.abs(mark.width - mark.want)).toBeLessThan(2);
  // In "Edit video by text" the same word is the current one.
  await page.getByRole('button', { name: 'Монтаж по тексту' }).click();
  await expect(page.locator('.ck-word[data-now]')).toHaveCount(1);
  expect((await page.locator('.ck-word[data-now]').textContent())?.toLowerCase()).toBe(mark.word?.toLowerCase());

  // A correction in the first line, then captions again for a part only: 10 s to 20 s.
  // (Lines are cut again after a correction: the first line may take a word of the next one.)
  await page.locator('.caption-row input').first().fill('ПРАВКА человека');
  await page.locator('.caption-row input').first().press('Enter');
  await expect(page.locator('.caption-row input').first()).toHaveValue(/^ПРАВКА человека/);
  const before = await lines(page);
  await forget(page);
  const downloaded = requests.length;
  await page.getByRole('button', { name: 'Создать заново…' }).click();
  // The model this device keeps says so on its chip.
  await expect(page.getByRole('radiogroup', { name: 'Распознавание' }).getByRole('radio', { name: /на устройстве/ })).toHaveCount(1);
  await expect(page.getByRole('radiogroup', { name: 'Распознавание' }).getByRole('radio', { name: 'Авто', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radiogroup', { name: 'Где' }).getByRole('radio', { name: 'Участок' }).click();
  await page.getByRole('slider', { name: 'Конец участка' }).fill('20');
  await page.getByRole('slider', { name: 'Начало участка' }).fill('10');
  await expect(page.locator('.ck-part-says')).toHaveText('С 0:10.0 до 0:20.0: 10 с');
  await expect(page.getByText('Субтитры в остальном видео останутся как есть.')).toBeVisible();
  await page.getByRole('button', { name: 'Создать субтитры' }).click();
  await expect(page.getByRole('button', { name: 'Создать заново…' })).toBeVisible({ timeout: 300_000 });

  // The second run: no question, no word of a download, not one request for a model file.
  const second = await said(page);
  expect(second.join(' | ')).not.toMatch(/Скачиваем|скачается/);
  expect(second).toContain('Запускаем модель речи (она уже на устройстве)…');
  expect(requests.length).toBe(downloaded);
  // Outside the part nothing changed, the correction included; inside it the speech was read again.
  const after = await lines(page);
  expect(after[0]).toBe(before[0]);
  expect(after[0]).toMatch(/^ПРАВКА человека/);
  const times = await page.locator('.caption-row > span:first-child').evaluateAll((els) => els.map((e) => e.textContent ?? ''));
  const sec = (s: string) => { const m = /(\d+):(\d+\.\d)/.exec(s)!; return +m[1] * 60 + +m[2]; };
  const outside = (all: string[], at: string[]) => all.filter((_, i) => sec(at[i]) < 9 || sec(at[i]) > 21);
  expect(outside(after, times).slice(0, 3)).toEqual(before.slice(0, 3));
  expect(after.length).toBeGreaterThan(before.length - 4);
  expect(times.some((x) => sec(x) >= 10 && sec(x) <= 20)).toBe(true);
});

test('Russian speech under music is taken for Russian by the Russian model itself: Whisper is never asked', async ({ page }) => {
  test.setTimeout(600_000);
  const requests = modelRequests(page);
  await open(page, 'ru', 'eval_ru_live_music.mp4');
  await page.getByRole('button', { name: 'Субтитры', exact: true }).click();
  const yes = page.getByRole('button', { name: 'Скачать и сделать субтитры', exact: true });
  const asked: string[] = [];
  await expect(async () => {
    if (await yes.isVisible()) { asked.push((await page.locator('.model-ask').textContent()) ?? ''); await yes.click(); }
    await expect(page.locator('.caption-row').first()).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 500_000 });
  // One question, about the Russian model; before docs/20 a second one followed, for Whisper base: "77 МБ".
  expect(asked).toHaveLength(1);
  expect(asked[0]).not.toContain('77 МБ');
  expect(requests.filter((u) => /whisper/i.test(u))).toEqual([]);
  expect((await said(page)).join(' | ')).not.toContain('77 МБ');
  await expect(page.locator('.toast', { hasText: 'Язык речи: Русский' })).toBeVisible();
});

test('Auto in an English interface: Russian speech goes to the Russian model after one question; "Not now" keeps the model at work', async ({ page }) => {
  test.setTimeout(900_000);
  const requests = modelRequests(page);
  await open(page, 'en', 'eval_ru.mp4');
  await page.getByRole('button', { name: 'Captions', exact: true }).click();
  const ask = page.locator('.model-ask');
  // The run starts with the model for the interface's language: Whisper base.
  await expect(ask).toContainText('77 MB');
  await page.getByRole('button', { name: 'Download and make captions', exact: true }).click();
  // The speech turned out to be Russian: one more question, with its reason; "Not now" does not end the run.
  await expect(ask).toContainText('This is Russian speech', { timeout: 400_000 });
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(page.locator('.caption-row').first()).toBeVisible({ timeout: 400_000 });
  expect(requests.filter((u) => /gigaam|fastconformer/i.test(u))).toEqual([]);
  await expect(page.locator('.toast', { hasText: 'choose the Russian model' })).toBeVisible();

  // Again, with a yes: the Russian model reads it, and every word of the first sentence is right.
  await page.getByRole('button', { name: 'Create again…' }).click();
  await page.getByRole('button', { name: 'Create captions' }).click();
  await expect(ask).toContainText('This is Russian speech', { timeout: 400_000 });
  await page.getByRole('button', { name: 'Download and make captions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create again…' })).toBeVisible({ timeout: 500_000 });
  expect(requests.filter((u) => /gigaam|fastconformer/i.test(u)).length).toBeGreaterThan(0);
  const text = (await lines(page)).join(' ').toLowerCase().replace(/[^\p{L}\s]/gu, '');
  expect(text).toContain('всем привет с вами снова я');
  expect(text).toContain('смонтировал ролик прямо на телефоне');
});

test('a caption template tile is never empty while its demo loops, and the tiles do not all restart together', async ({ page }) => {
  await open(page, 'en', 'speech_en.mp4');
  await page.getByRole('button', { name: 'Captions', exact: true }).click();
  await page.getByRole('button', { name: 'Settings' }).or(page.getByRole('button', { name: 'Not now', exact: true })).click();
  const strip = page.getByRole('radiogroup', { name: 'Style' });
  await strip.scrollIntoViewIfNeeded();
  await expect(page.locator('.sheet canvas[data-id][data-ready]').first()).toBeVisible();
  // Two and a half loops, sampled every 40 ms: a tile on screen always has letters on it.
  const seen = await page.evaluate(async () => {
    const tiles = [...document.querySelectorAll<HTMLCanvasElement>('.sheet canvas[data-id][data-ready]')].filter((c) => { const r = c.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.width > 0; });
    const peak = (c: HTMLCanvasElement) => { const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let m = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > m) m = d[i]; return m; };
    let samples = 0, empty = 0, allEmpty = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 6000) {
      const n = tiles.filter((c) => peak(c) < 24).length;
      samples++; empty += n; if (n === tiles.length) allEmpty++;
      await new Promise((r) => setTimeout(r, 40));
    }
    return { tiles: tiles.length, samples, empty, allEmpty };
  });
  expect(seen.tiles).toBeGreaterThanOrEqual(4);
  expect(seen.samples).toBeGreaterThan(60);
  expect(seen.allEmpty).toBe(0);
  expect(seen.empty).toBe(0);
});
