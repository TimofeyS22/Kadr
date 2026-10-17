// Captions from a script, measured (docs/09 S1, gate D2): real Whisper base output on four TTS recordings
// (captured by e2e/script-eval.spec.ts into e2e/eval/asr/) aligned to the script, scored against what was said.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { alignScript } from './script';
import type { CaptionWord } from './types';

const root = path.join(import.meta.dirname, '..', '..', 'e2e', 'eval');
const texts = JSON.parse(fs.readFileSync(path.join(root, 'texts.json'), 'utf8')) as Record<string, string>;
/** Scoring form: what a reader compares (case, ё, punctuation and hyphens do not matter; the number reads either way). */
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean)
  .map((w) => (w === 'пятнадцать' ? '15' : w));

/** Word errors against the reference, and how many shown words were never said (insertions). */
function score(ref: string[], hyp: string[]): { wer: number; unsaid: number } {
  const d = Array.from({ length: ref.length + 1 }, (_, i) => Array.from({ length: hyp.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= ref.length; i++) for (let j = 1; j <= hyp.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  }
  let i = ref.length, j = hyp.length, unsaid = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) { i--; j--; }
    else if (j > 0 && d[i][j] === d[i][j - 1] + 1) { unsaid++; j--; }
    else i--;
  }
  return { wer: d[ref.length][hyp.length] / ref.length, unsaid };
}

const rows: string[] = [];
afterAll(() => {
  const out = ['| Запись | WER распознавания | WER по тексту | Несказанных слов показано | Совпало слов |', '|---|---|---|---|---|', ...rows].join('\n');
  console.log(`\n${out}\n`);
});

describe('captions from the script on real recognition output (eval)', () => {
  const cases = [
    ...['verbatim', 'adlib', 'skip', 'music'].map((v) => ({ name: v, file: `script_${v}`, script: texts.script_ru, said: texts[`script_${v}_said`] })),
    { name: 'ru_loud', file: 'ru_loud', script: texts.ru, said: texts.ru },
    { name: 'en_music', file: 'en_music', script: texts.en, said: texts.en },
  ];
  for (const { name, file: base, script, said: saidText } of cases) {
    const file = path.join(root, 'asr', `${base}.json`);
    it.skipIf(!fs.existsSync(file))(`${name}: as good as or better than recognition, nothing unsaid shown`, () => {
      const { words, speech } = JSON.parse(fs.readFileSync(file, 'utf8')) as { words: CaptionWord[]; speech: [number, number][] };
      const said = norm(saidText);
      const r = alignScript(script, words, speech);
      expect(r, 'the script must be recognized as this speech').not.toBeNull();
      const asr = score(said, norm(words.map((w) => w.text).join(' ')));
      const own = score(said, norm(r!.words.map((w) => w.text).join(' ')));
      rows.push(`| ${name} | ${(asr.wer * 100).toFixed(1)}% | ${(own.wer * 100).toFixed(1)}% | ${own.unsaid} | ${(r!.matched * 100).toFixed(0)}% |`);
      expect(own.wer).toBeLessThanOrEqual(name === 'verbatim' ? 0.01 : asr.wer);
      expect(own.wer).toBeLessThanOrEqual(asr.wer);
      expect(own.unsaid).toBe(0);
      // Timing comes from speech: words stay in order and inside the recording.
      r!.words.forEach((w, i) => { expect(w.t1).toBeGreaterThan(w.t0); if (i) expect(w.t0).toBeGreaterThanOrEqual(r!.words[i - 1].t0 - 1e-6); });
    });
  }

  it.skipIf(!fs.existsSync(path.join(root, 'asr', 'script_verbatim.json')))('a different text in the same language is not forced onto the speech', () => {
    const { words, speech } = JSON.parse(fs.readFileSync(path.join(root, 'asr', 'script_verbatim.json'), 'utf8')) as { words: CaptionWord[]; speech: [number, number][] };
    expect(alignScript(texts.ru, words, speech)).toBeNull();
  });
});
