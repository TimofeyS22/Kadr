// Caption quality eval (docs/06 M5): word error rate and coverage of auto captions on reference speech, per model.
// Run: EVAL=1 npx playwright test --project eval  (needs `npm run fixtures`). Prints a table; asserts nothing but completion.
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const texts = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'eval', 'texts.json'), 'utf8')) as Record<string, string>;
const models = (process.env.EVAL_MODELS ?? 'tiny,base,small').split(',');
const samples = (process.env.EVAL_SAMPLES ?? 'ru,ru_music,en,en_music').split(',');
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

/** Word-level Levenshtein: errors and the number of reference words matched exactly (coverage). */
function wer(ref: string[], hyp: string[]): { wer: number; coverage: number } {
  const d = Array.from({ length: ref.length + 1 }, (_, i) => Array.from({ length: hyp.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= ref.length; i++) for (let j = 1; j <= hyp.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  }
  let i = ref.length, j = hyp.length, hits = 0;
  while (i > 0 && j > 0) {
    if (ref[i - 1] === hyp[j - 1] && d[i][j] === d[i - 1][j - 1]) { hits++; i--; j--; }
    else if (d[i][j] === d[i - 1][j - 1] + 1) { i--; j--; }
    else if (d[i][j] === d[i - 1][j] + 1) i--;
    else j--;
  }
  return { wer: d[ref.length][hyp.length] / ref.length, coverage: hits / ref.length };
}

const rows: string[] = [];
test.afterAll(() => {
  const out = ['| Модель | Образец | WER | Покрытие | Время, с |', '|---|---|---|---|---|', ...rows].join('\n');
  console.log(`\n${out}\n`);
  fs.writeFileSync(path.join(import.meta.dirname, '..', 'test-results', 'captions-eval.md'), out);
});

// One page per model, so the model downloads once (the browser cache lives as long as the context).
test.describe.configure({ mode: 'serial' });
let page: Page;
let pageModel = '';
for (const model of models) for (const sample of samples) {
  test(`captions eval: ${model} on ${sample}`, async ({ browser }) => {
    test.setTimeout(Number(process.env.EVAL_TIMEOUT ?? 900_000));
    const lang = sample.split('_')[0];
    if (pageModel !== model) {
      await page?.context().close();
      page = await (await browser.newContext({ baseURL: test.info().project.use.baseURL })).newPage();
      await page.addInitScript(() => { localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.locale', 'en'); });
      pageModel = model;
    }
    await page.goto('./');
    await page.getByRole('button', { name: 'New project' }).click();
    await page.locator('.aspect-card', { hasText: '9:16' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Media', exact: true }).click();
    await (await chooser).setFiles(path.join(import.meta.dirname, '..', 'fixtures', `eval_${sample}.mp4`));
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
    await page.getByRole('button', { name: 'Close tools' }).click();
    await page.getByRole('button', { name: 'Captions', exact: true }).click();
    await page.getByRole('combobox', { name: 'Language' }).selectOption(lang === 'ru' ? 'russian' : 'english');
    await page.locator('.sheet .chip', { hasText: new RegExp(`${model === 'tiny' ? 'Fast' : model === 'base' ? 'Accurate' : 'Most accurate'},`) }).first().click();
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Create captions' }).click();
    await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 840_000 });
    const seconds = (Date.now() - t0) / 1000;
    if (!(await page.locator('.sheet').isVisible())) await page.getByRole('button', { name: 'Edit captions', exact: true }).click();
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save as .srt' }).click();
    const srt = fs.readFileSync(await (await dl).path()!, 'utf8');
    const hyp = srt.split('\n').filter((l) => l && !/^\d+$/.test(l) && !l.includes('-->')).join(' ');
    const r = wer(norm(texts[lang]), norm(hyp));
    rows.push(`| ${model} | ${sample} | ${(r.wer * 100).toFixed(1)}% | ${(r.coverage * 100).toFixed(1)}% | ${seconds.toFixed(0)} |`);
    fs.writeFileSync(test.info().outputPath('captions.txt'), hyp);
  });
}
