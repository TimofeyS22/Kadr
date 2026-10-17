import { describe, expect, it } from 'vitest';
import { alignScript, normWord, tokenize, wordCost } from './script';
import type { CaptionWord } from './types';

/** Heard words, 0.4 s each with 0.1 s between, from `t0`; a `|` adds a 1.5 s pause. */
function heard(s: string, t0 = 0): CaptionWord[] {
  const out: CaptionWord[] = [];
  let t = t0;
  for (const w of s.split(' ')) {
    if (w === '|') { t += 1.5; continue; }
    out.push({ t0: t, t1: t + 0.4, text: w });
    t += 0.5;
  }
  return out;
}
/** VAD speech: one range per run of heard words. */
const speechOf = (h: CaptionWord[]): [number, number][] => {
  const out: [number, number][] = [];
  for (const w of h) {
    const last = out[out.length - 1];
    if (last && w.t0 - last[1] < 0.3) last[1] = w.t1; else out.push([w.t0, w.t1]);
  }
  return out;
};
const texts = (w: CaptionWord[]) => w.map((x) => x.text).join(' ');

describe('captions from the script (docs/09 S1)', () => {
  it('normalizes and tokenizes like a reader would: case, ё, punctuation do not matter; bare dashes stick', () => {
    expect(normWord('Ещё,')).toBe('еще');
    expect(tokenize('Привет — как дела?').map((x) => x.text)).toEqual(['Привет —', 'как', 'дела?']);
    expect(wordCost('смонтировал', 'смонтировала')).toBe(0.3);
    expect(wordCost('15', 'пятнадцать')).toBe(0.5);
    expect(wordCost('и', 'а')).toBe(1);
  });

  it('verbatim reading: the script\'s words, including punctuation and digits, at the heard times', () => {
    const script = 'Всем привет! Сегодня покажу, как смонтировать ролик за 15 минут.';
    const h = heard('всем привет сегодня покажу как смонтировал ролик за пятнадцать минут');
    const r = alignScript(script, h, speechOf(h))!;
    expect(texts(r.words)).toBe(script);
    expect(r.words.map((w) => w.t0)).toEqual(h.map((w) => w.t0));
    expect(r.skipped).toBe(0);
    expect(r.adlibs).toBe(0);
    expect(r.matched).toBe(1);
  });

  it('improvised words stay as heard, fillers do not', () => {
    const script = 'Сначала убираем паузы, потом добавляем субтитры.';
    const h = heard('сначала убираем паузы эээ ну кстати потом добавляем субтитры');
    const r = alignScript(script, h, speechOf(h))!;
    expect(texts(r.words)).toBe('Сначала убираем паузы, ну кстати потом добавляем субтитры.');
    expect(r.adlibs).toBe(2);
  });

  it('a sentence that was not said is left out', () => {
    const script = 'Всем привет. Это предложение я пропущу целиком. Подписывайтесь на канал.';
    const h = heard('всем привет | подписывайтесь на канал');
    const r = alignScript(script, h, speechOf(h))!;
    expect(texts(r.words)).toBe('Всем привет. Подписывайтесь на канал.');
    expect(r.skipped).toBe(5);
  });

  it('words the recognizer missed inside speech are kept and get time from the gap', () => {
    const script = 'Музыка совпадает с ритмом шагов и это красиво.';
    const h = heard('музыка совпадает с ритмом шагов');
    const tail = { t0: 4.0, t1: 4.4, text: 'красиво' };
    const all = [...h, tail];
    const speech: [number, number][] = [[0, 4.4]]; // spoken all along, the recognizer lost "и это"
    const r = alignScript(script, all, speech)!;
    expect(texts(r.words)).toBe(script);
    const i = r.words.findIndex((w) => w.text === 'и');
    expect(r.words[i].t0).toBeGreaterThanOrEqual(h[h.length - 1].t1 - 1e-9);
    expect(r.words[i + 1].t1).toBeLessThanOrEqual(tail.t0 + 1e-9);
  });

  it('with a short gap the missed word shares the time of its neighbour', () => {
    const r = alignScript('один два три', [{ t0: 0, t1: 0.4, text: 'один' }, { t0: 0.4, t1: 0.9, text: 'три' }], [[0, 0.9]])!;
    expect(texts(r.words)).toBe('один два три');
    expect(r.words[1].t0).toBeGreaterThan(0);
    expect(r.words[1].t1).toBeLessThanOrEqual(0.4 + 1e-9);
  });

  it('a compound the recognizer split, even with errors, shows once ("слово паразит" for "слова-паразиты")', () => {
    const script = 'Убираем лишние паузы и слова-паразиты. Потом добавляем субтитры.';
    for (const heardAs of ['убираем лишние паузы и слово паразит потом добавляем субтитры', 'убираем лишние паузы и слово паразиты потом добавляем субтитры']) {
      const h = heard(heardAs);
      expect(texts(alignScript(script, h, speechOf(h))!.words), heardAs).toBe(script);
    }
    // Damaged beyond a split (a word lost, three edits): the heard words are shown, once — never worse than recognition.
    const h = heard('убираем лишние паузы слово паразитов потом добавляем субтитры');
    expect(texts(alignScript(script, h, speechOf(h))!.words)).toBe('Убираем лишние паузы слово паразитов Потом добавляем субтитры.');
  });

  it('a text that is not this speech (or empty) falls back to recognition', () => {
    const h = heard('всем привет сегодня покажу как смонтировать ролик');
    expect(alignScript('Hello everyone, today I will show you how to edit', h, speechOf(h))).toBeNull();
    expect(alignScript('   ', h, speechOf(h))).toBeNull();
    expect(alignScript('Всем привет', [], [])).toBeNull();
  });
});
