// What an error toast says is Kadr's own sentence in the person's language (S-1-6, S-1-7, S-1-10). A library's or an
// engine's words went into Russian messages as they were ("Out of memory", "This audio track cannot be decoded in this
// environment…", WebKit's "FetchEvent.respondWith received an error: no-response"). They belong in the details.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocale } from './i18n';
import { RU } from './locale-ru';
import { errorMessage } from './telemetry';

const online = (value: boolean) => vi.stubGlobal('navigator', { ...globalThis.navigator, onLine: value });
beforeEach(() => useLocale.setState({ locale: 'ru' }));
afterEach(() => { vi.unstubAllGlobals(); useLocale.setState({ locale: 'en' }); });
/** Four Latin letters in a row: a word of English in a Russian sentence (Kadr, MB and codec names are shorter or absent). */
const english = /[A-Za-z]{4,}/;

describe('error messages are Kadr\'s own sentences', () => {
  it('no message template carries an engine\'s words in brackets: they go to the details', () => {
    expect(Object.keys(RU).filter((k) => k.includes('({error})'))).toEqual([]);
  });

  it('WebKit\'s words for a request its service worker could not answer are the server not answering (S-1-6)', () => {
    online(true);
    for (const text of ['FetchEvent.respondWith received an error: no-response: no-response :: [{"url":"https://x/music/music.json"}]', 'no-response: no-response', 'The network connection was lost.']) {
      expect(errorMessage(new TypeError(text)), text).toBe(RU['The server did not answer. Try again in a minute, or on another network.']);
    }
    online(false);
    expect(errorMessage(new TypeError('The Internet connection appears to be offline.'))).toBe(RU['No internet connection.']);
  });

  it('an engine\'s own words become a sentence in Russian (S-1-7)', () => {
    for (const e of [new Error('This audio track cannot be decoded in this environment. Make sure to check decodability before using a track.'), new Error('The output has no data'), new Error('Decoder failure'), 'raw string from a worker']) {
      const said = errorMessage(e);
      expect(said, String(e)).not.toMatch(english);
      expect(said).toBe(RU['Something went wrong. The details are under “Details”.']);
    }
    expect(errorMessage(new RangeError('Out of memory'))).toBe(RU['This device ran out of memory for this. Close other apps and try again.']);
    expect(errorMessage(new RangeError('Array buffer allocation failed'))).not.toMatch(english);
  });

  it('Kadr\'s own sentences stay as they are, with their values', () => {
    // As a MediaError carries them (engine/media.ts): the sentence, and the engine's words in vars.error for the details.
    const media = Object.assign(new Error('The sound of “{name}” cannot be decoded in this browser'), { vars: { name: 'a.mov', error: 'WebCodecs: no' } });
    expect(errorMessage(media)).toBe('Звук «a.mov» не декодируется в этом браузере');
    expect(errorMessage(new Error('The recording is empty'))).toBe(RU['The recording is empty']);
    const already = RU['the browser’s storage does not answer'];
    expect(errorMessage(new Error(already))).toBe(already);
    useLocale.setState({ locale: 'en' });
    expect(errorMessage(new Error('The recording is empty'))).toBe('The recording is empty');
  });
});
