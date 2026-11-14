// Verification of audit V-191 (docs/21 §5): Russian speech under an English phone language was read by Whisper base —
// a third of the words wrong, the reel's title garbled — though the Russian model was there. The model a run starts
// with is chosen by the speech's language when it is known, not by the interface's (docs/20 ADR-С2): a person who
// names Russian gets the Russian model in any interface. (With the language unknown, the run starts with the interface's
// model and the speech decides after detection: that half is in e2e/qa-captions-honest.spec.ts.)
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { useLocale } from '../lib/i18n';

let startingModel: typeof import('./captions').startingModel;
beforeAll(async () => {
  // The engine's imports reach code that makes canvases at load; Node has none (as in audio.test.ts).
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return null; } });
  vi.stubGlobal('self', globalThis);
  ({ startingModel } = await import('./captions'));
});
afterAll(() => useLocale.setState({ locale: 'en' }));
const russianModel = /^ru(-fast)?$/;

describe('which model reads the speech: the speech\'s language decides, not the phone\'s (audit V-191)', () => {
  it('English interface, Russian speech named: a Russian model, not Whisper', () => {
    useLocale.setState({ locale: 'en' });
    expect(startingModel('auto', 'russian')).toMatch(russianModel);
    expect(startingModel('auto', 'english')).toBe('base');
  });

  it('Russian interface, English speech named: Whisper, not a Russian model', () => {
    useLocale.setState({ locale: 'ru' });
    expect(startingModel('auto', 'english')).toBe('base');
    expect(startingModel('auto', 'russian')).toMatch(russianModel);
    expect(startingModel('auto', null)).toMatch(russianModel); // unknown: the interface's language is the likeliest
  });
});
