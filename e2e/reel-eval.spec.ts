// "Reel in one tap" eval (docs/08 A): on a reference talk with pauses, an "эээ" and a repeat, how much speech the
// pipeline keeps, how much silence it removes and how long it takes on this machine.
// Run: EVAL=1 npx playwright test --project=eval reel-eval  (needs `npm run fixtures`). Prints a table.
import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

/** Seconds of silence (stretches ≥ 0.2 s below -50 dB): conservative, so short natural gaps count as "not removed". */
function silence(file: string): number {
  const out = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'silencedetect=noise=-50dB:d=0.2', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  return [...out.matchAll(/silence_duration: ([\d.]+)/g)].reduce((s, m) => s + Number(m[1]), 0);
}

async function srtWords(page: Page): Promise<string[]> {
  await page.locator('.clip-caption').click();
  await page.getByRole('button', { name: 'Edit captions', exact: true }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save as .srt' }).click();
  const srt = fs.readFileSync((await (await dl).path())!, 'utf8');
  await page.getByRole('button', { name: 'Done' }).click();
  return norm(srt.split('\n').filter((l) => l && !/^\d+$/.test(l) && !l.includes('-->')).join(' '));
}

test('reel eval: speech kept, silence removed, time', async ({ page }, info) => {
  test.setTimeout(900_000);
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.reel', JSON.stringify({ music: null })); // music would hide the silence; language: Auto
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false })); // the eval picks its export settings
    Object.defineProperty(navigator, 'canShare', { value: undefined });
  });
  await page.goto('./');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Reel in 1 tap/ }).click();
  await (await chooser).setFiles(fx('reel_ru.mp4'));
  const done = page.locator('.reel-done');
  let t0 = Date.now();
  await expect(done).toBeVisible({ timeout: 840_000 });
  const cold = (Date.now() - t0) / 1000; // with the model download
  await page.getByRole('button', { name: 'Undo all' }).click();
  t0 = Date.now();
  await page.getByRole('button', { name: 'Make the reel' }).click();
  await expect(done).toBeVisible({ timeout: 840_000 });
  const warm = (Date.now() - t0) / 1000;
  const [before, after] = (await done.locator('.reel-length b').allTextContents());
  await page.getByRole('button', { name: 'Done' }).click();

  const kept = await srtWords(page);
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Audio', exact: true }).click();
  await page.getByRole('switch', { name: /Even loudness/ }).uncheck();
  await page.getByRole('button', { name: 'Export audio' }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 120_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const audio = info.outputPath((await dl).suggestedFilename());
  await (await dl).saveAs(audio);
  await page.getByRole('button', { name: 'Done' }).click();

  // Back to the captions before the cuts (steps: captions, cuts, zooms, title): the words the speech had.
  const main = page.locator('.tl-row.main .clip');
  while ((await main.count()) > 1) await page.getByRole('button', { name: 'Undo' }).click();
  const spoken = await srtWords(page);

  const s0 = silence(fx('reel_ru.mp4')), s1 = silence(audio);
  const keptShare = kept.length / spoken.length, removed = 1 - s1 / s0;
  const lost = [...kept].reduce((rest, w) => { const i = rest.indexOf(w); if (i >= 0) rest.splice(i, 1); return rest; }, [...spoken]);
  const out = [
    '| Метрика | Значение | Порог |', '|---|---|---|',
    `| Сохранено слов речи | ${(keptShare * 100).toFixed(1)}% (${kept.length} из ${spoken.length})${lost.length ? `, потеряны: ${lost.join(', ')}` : ''} | ≥ 95% |`,
    `| Удалено тишины | ${(removed * 100).toFixed(1)}% (${s0.toFixed(2)} → ${s1.toFixed(2)} с) | ≥ 70% |`,
    `| Длительность | ${before} → ${after} | — |`,
    `| Время конвейера | ${warm.toFixed(1)} с (первый запуск с загрузкой модели ${cold.toFixed(1)} с) | — |`,
  ].join('\n');
  console.log(`\n${out}\n\nspoken: ${spoken.join(' ')}\nkept:   ${kept.join(' ')}\n`);
  fs.mkdirSync(path.join(import.meta.dirname, '..', 'test-results'), { recursive: true });
  fs.writeFileSync(path.join(import.meta.dirname, '..', 'test-results', 'reel-eval.md'), out);
  expect(keptShare).toBeGreaterThanOrEqual(0.95);
  expect(removed).toBeGreaterThanOrEqual(0.7);
});
