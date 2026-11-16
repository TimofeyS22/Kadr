// Verification of audit V-124 and V-200 (docs/21 §5): the task pages promise what the app does.
// V-124: the pages put the speech download at 77 MB and named Whisper as the model, while Russian speech gets the
//        Russian model, 132–225 MB. The sizes here are read from the model manifest the app downloads by.
// V-200: the pages' instructions named controls the interface does not have («Запас вокруг слов», «Тише, когда
//        говорят», «Аудио», a GIF choice without “Settings”…). A quoted label must be one the interface shows.
import { describe, expect, it } from 'vitest';
import manifest from '../src/engine/models.json';
import { SPEECH_REPOS } from '../src/engine/modelFiles';
import { RU } from '../src/lib/locale-ru';
import { PAGES, type Lang } from './tasks';

/** Megabytes of each speech model, as the app downloads it (src/engine/models.json). */
const MB = Object.fromEntries(Object.entries(SPEECH_REPOS).map(([m, repo]) => [m, Math.round(Object.entries(manifest.files)
  .filter(([f]) => f.startsWith(`${repo}/`)).reduce((s, [, v]) => s + v.size, 0) / 1e6)])) as Record<keyof typeof SPEECH_REPOS, number>;
const text = (p: (typeof PAGES)[number], l: Lang) => [p.title[l], p.description[l], p.h1[l], p.intro[l], ...p.steps[l], ...p.faq[l].flat()].join('\n');

describe('the task pages name the speech download the app really makes (audit V-124)', () => {
  it('every size a page gives is the size of a model the app downloads', () => {
    const sizes = new Set(Object.values(MB));
    for (const p of PAGES) for (const l of ['ru', 'en'] as const) {
      for (const m of text(p, l).matchAll(/(\d+)\s*(?:МБ|MB)/g)) expect(sizes.has(Number(m[1])), `${p.task}/${l}: «${m[0]}»`).toBe(true);
    }
  });

  it('in Russian, a page that gives the download covers the Russian model, and no page says Whisper reads the speech', () => {
    for (const p of PAGES) {
      const ru = text(p, 'ru');
      expect(ru, `${p.task}/ru`).not.toMatch(/Whisper/);
      if (!/модел[а-я]* распознавания речи|модел[а-я]* для русской речи|своя модель/i.test(ru)) continue;
      const said = [...ru.matchAll(/(\d+)\s*МБ/g)].map((m) => Number(m[1]));
      expect(said.length, `${p.task}/ru names the size`).toBeGreaterThan(0);
      expect(Math.max(...said), `${p.task}/ru: up to the Russian model (${MB.ru} MB)`).toBeGreaterThanOrEqual(MB.ru);
    }
  });
});

/** Quoted words that are not controls: what the person says («эээ»), and a label in another grammatical case. */
const NOT_LABELS = new Set(['эээ', 'um']);
const CASES: Record<string, string> = { 'Настройках': 'Настройки' };
/** Quotes that are not interface labels: none since aa0386c (the music page names the «+» by words, V-200). */
const STILL_OPEN: string[] = [];

describe('the task pages\' instructions name controls the interface has (audit V-200)', () => {
  it('every label quoted in the steps and answers is one the interface shows', () => {
    const shown: Record<Lang, Set<string>> = { ru: new Set(Object.values(RU)), en: new Set(Object.keys(RU)) };
    const quote: Record<Lang, RegExp> = { ru: /«([^»]+)»/g, en: /“([^”]+)”/g };
    const missing: string[] = [];
    for (const p of PAGES) for (const l of ['ru', 'en'] as const) {
      for (const line of [...p.steps[l], ...p.faq[l].map(([, a]) => a)]) {
        for (const [q, label] of line.matchAll(quote[l])) {
          if (NOT_LABELS.has(label) || shown[l].has(CASES[label] ?? label)) continue;
          missing.push(`${p.task}/${l}: ${q}`);
        }
      }
    }
    expect([...new Set(missing)]).toEqual(STILL_OPEN);
  });
});
