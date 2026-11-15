// The task pages' steps say what the screen shows at that step (V-200). The music sheet adds a track with a «+», no
// word on it; the captions sheet starts recognition by itself, so no later step asks to start it.
import { describe, expect, it } from 'vitest';
import { RU } from '../src/lib/locale-ru';
import { PAGES, type Lang } from './tasks';

const page = (task: string) => PAGES.find((p) => p.task === task)!;
const quotes = (line: string, l: Lang) => [...line.matchAll(l === 'ru' ? /«([^»]+)»/g : /“([^”]+)”/g)].map((m) => m[1]);
const shown: Record<Lang, Set<string>> = { ru: new Set(Object.values(RU)), en: new Set(Object.keys(RU)) };

describe('task pages: each step as the screen shows it (V-200)', () => {
  it('music: every control a step names is one the interface shows', () => {
    for (const l of ['ru', 'en'] as const) {
      for (const step of page('music').steps[l]) for (const q of quotes(step, l)) expect(shown[l].has(q), `music/${l}: «${q}» in «${step}»`).toBe(true);
    }
  });
  it('captions: once a step says recognition starts by itself, no later step asks to start it', () => {
    for (const l of ['ru', 'en'] as const) {
      const steps = page('captions').steps[l];
      const at = steps.findIndex((s) => (l === 'ru' ? /начн[её]тся (сразу|само)/ : /starts at once/).test(s));
      expect(at, `captions/${l}: the step that says it starts by itself`).toBeGreaterThanOrEqual(0);
      for (const s of steps.slice(at + 1)) expect(s, `captions/${l}`).not.toMatch(l === 'ru' ? /Нажмите «Создать субтитры»/ : /Tap “Create captions”/);
    }
  });
});
