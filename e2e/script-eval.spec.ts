// Captions from a script (docs/09 S1), capture step: real Whisper (base) output on the four script recordings,
// through the app's own Auto captions, saved to e2e/eval/asr/*.json with speech ranges. The alignment itself is
// measured on these files by src/core/script-eval.test.ts (part of `npm run check`).
// Run: EVAL=1 npx playwright test --project=eval script-eval  (needs `npm run fixtures`); re-run when the ASR changes.
import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Recordings: the four read from one script, plus the caption-eval vlogs read verbatim (Russian under loud music, English under music). */
const SAMPLES: { name: string; file: string; language: string }[] = [
  ...['verbatim', 'adlib', 'skip', 'music'].map((v) => ({ name: `script_${v}`, file: `script_${v}.mp4`, language: 'russian' })),
  { name: 'ru_loud', file: 'eval_ru_loud.mp4', language: 'russian' },
  { name: 'en_music', file: 'eval_en_music.mp4', language: 'english' },
];
const OUT = path.join(import.meta.dirname, 'eval', 'asr');

/** Speech ranges = the gaps between stretches of silence (≥ 0.3 s below -40 dB): a stand-in for the app's VAD. */
function speechRanges(file: string): [number, number][] {
  const out = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'silencedetect=noise=-40dB:d=0.3', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const dur = Number(/Duration: (\d+):(\d+):([\d.]+)/.exec(out)!.slice(1).reduce((s, x, i) => s + Number(x) * [3600, 60, 1][i], 0));
  const starts = [...out.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...out.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const speech: [number, number][] = [];
  let t = 0;
  starts.forEach((s, i) => { if (s > t + 0.01) speech.push([t, s]); t = ends[i] ?? dur; });
  if (t < dur - 0.01) speech.push([t, dur]);
  return speech.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]);
}

/** The latest saved project, straight from the app's IndexedDB store. */
const savedProject = (page: Page) => page.evaluate(async () => {
  const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('kadr'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const st = db.transaction('kv').objectStore('kv');
  const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res) => { r.onsuccess = () => res(r.result); });
  const keys = (await req(st.getAllKeys())).filter((k) => String(k).startsWith('p:'));
  const all = await Promise.all(keys.map((k) => req(st.get(k)))) as { updatedAt: number; tracks: { clips: { kind: string; start: number; words?: { t0: number; t1: number; text: string }[] }[] }[] }[];
  return all.sort((a, b) => b.updatedAt - a.updatedAt)[0];
});

test.describe.configure({ mode: 'serial' });
let page: Page;
for (const { name, file: fileName, language } of SAMPLES) {
  test(`script eval capture: ${name}`, async ({ browser }) => {
    test.setTimeout(600_000);
    if (!page) {
      page = await (await browser.newContext({ baseURL: test.info().project.use.baseURL })).newPage();
      await page.addInitScript(() => { localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.locale', 'en'); });
    }
    const file = path.join(import.meta.dirname, '..', 'fixtures', fileName);
    await page.goto('./');
    await page.getByRole('button', { name: 'New project' }).click();
    await page.locator('.aspect-card', { hasText: '9:16' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Media', exact: true }).click();
    await (await chooser).setFiles(file);
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
    await page.getByRole('button', { name: 'Close tools' }).click();
    await page.getByRole('button', { name: 'Captions', exact: true }).click();
    await page.getByRole('combobox', { name: 'Language' }).selectOption(language);
    await page.getByRole('button', { name: 'Create captions' }).click();
    await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 540_000 });
    let words: { t0: number; t1: number; text: string }[] = [];
    await expect.poll(async () => {
      const cap = (await savedProject(page))?.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'caption');
      words = cap ? cap.words!.map((w) => ({ t0: +(cap.start + w.t0).toFixed(3), t1: +(cap.start + w.t1).toFixed(3), text: w.text })) : [];
      return words.length;
    }, { timeout: 20_000 }).toBeGreaterThan(0);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${name}.json`), `${JSON.stringify({ model: 'base', language, words, speech: speechRanges(file) }, null, 1)}\n`);
  });
}
