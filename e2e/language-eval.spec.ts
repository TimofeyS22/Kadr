// Speech language detection eval: with "Auto", does Kadr pick the right language (English interface throughout,
// so a miss shows up as English or translated captions)? Prints a table; asserts every sample is detected right.
// Run: EVAL=1 npx playwright test --project=eval language-eval  (needs `npm run fixtures`).
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const texts = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'eval', 'texts.json'), 'utf8')) as Record<string, string>;
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
/** Share of reference words that appear in the captions (bag of words): near 0 when the language is wrong. */
const recall = (ref: string[], hyp: string[]) => { const h = new Set(hyp); return ref.filter((w) => h.has(w)).length / ref.length; };

const SAMPLES: { file: string; lang: string; ref?: string; note: string }[] = [
  { file: 'eval_ru.mp4', lang: 'Русский', ref: texts.ru, note: 'RU, 33 s, clean' },
  { file: 'eval_ru_music.mp4', lang: 'Русский', ref: texts.ru, note: 'RU + quiet music' },
  { file: 'eval_ru_loud.mp4', lang: 'Русский', ref: texts.ru, note: 'RU + loud music' },
  { file: 'reel_ru.mp4', lang: 'Русский', ref: texts.reel_ru, note: 'RU, pauses and fillers' },
  { file: 'speech_ru.mp4', lang: 'Русский', note: 'RU, 4 s' },
  { file: 'eval_en.mp4', lang: 'English', ref: texts.en, note: 'EN, clean' },
  { file: 'eval_en_music.mp4', lang: 'English', ref: texts.en, note: 'EN + music' },
  { file: 'speech_en.mp4', lang: 'English', note: 'EN, 6 s' },
  ...([['uk', 'Українська'], ['es', 'Español'], ['de', 'Deutsch'], ['fr', 'Français'], ['it', 'Italiano'], ['pt', 'Português'], ['tr', 'Türkçe']] as const)
    .map(([code, lang]) => ({ file: `lang_${code}.mp4`, lang, ref: texts[`lang_${code}`], note: `${code.toUpperCase()}, ≈ 8 s` })),
];

const rows: string[] = [];
test.afterAll(() => {
  const out = ['| Образец | Ожидается | Определён | Слов эталона в субтитрах |', '|---|---|---|---|', ...rows].join('\n');
  console.log(`\n${out}\n`);
  fs.mkdirSync(path.join(import.meta.dirname, '..', 'test-results'), { recursive: true });
  fs.writeFileSync(path.join(import.meta.dirname, '..', 'test-results', 'language-eval.md'), out);
});

test.describe.configure({ mode: 'serial' });
let page: Page;
for (const s of SAMPLES) {
  test(`language eval: ${s.file}`, async ({ browser }) => {
    test.setTimeout(600_000);
    if (!page) {
      page = await (await browser.newContext({ baseURL: test.info().project.use.baseURL })).newPage();
      await page.addInitScript(() => { localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.locale', 'en'); });
    }
    await page.goto('./');
    await page.getByRole('button', { name: 'New project' }).click();
    await page.locator('.aspect-card', { hasText: '9:16' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Media', exact: true }).click();
    await (await chooser).setFiles(path.join(import.meta.dirname, '..', 'fixtures', s.file));
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
    await page.getByRole('button', { name: 'Close tools' }).click();
    await page.getByRole('button', { name: 'Captions', exact: true }).click();
    await page.getByRole('combobox', { name: 'Language' }).selectOption({ label: 'Auto' });
    await page.getByRole('button', { name: 'Create captions' }).click();
    await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 540_000 });
    const toast = page.locator('.toast', { hasText: 'Speech language:' });
    await expect(toast).toBeVisible();
    const got = /Speech language: (.+?)\./.exec((await toast.textContent()) ?? '')?.[1] ?? '?';
    let words = '—';
    if (s.ref) {
      if (!(await page.locator('.sheet').isVisible())) await page.getByRole('button', { name: 'Edit captions', exact: true }).click();
      const dl = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Save as .srt' }).click();
      const srt = fs.readFileSync((await (await dl).path())!, 'utf8');
      const hyp = srt.split('\n').filter((l) => l && !/^\d+$/.test(l) && !l.includes('-->')).join(' ');
      words = `${(recall(norm(s.ref), norm(hyp)) * 100).toFixed(0)}%`;
    }
    rows.push(`| ${s.note} | ${s.lang} | ${got === s.lang ? got : `**${got}**`} | ${words} |`);
    expect(got).toBe(s.lang);
  });
}
