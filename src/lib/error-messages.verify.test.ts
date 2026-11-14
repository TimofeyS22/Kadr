// Verification of audit V-113 and V-139 (docs/21 §5): what a person reads when the browser refuses a file or a codec.
// V-113: an unreadable file (WebKit/Chromium NotReadableError) was told in the browser's English words.
// V-139: an encoder or decoder refusal (EncodingError, OperationError, NotSupportedError, DataError) the same.
// Since S-1-7 any unknown error becomes "Something went wrong": that sentence is Russian too, but it does not say what
// happened. Each of these refusals has its own sentence, saying what to do (telemetry.ts, "audit V-139, V-113").
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLocale } from './i18n';
import { RU } from './locale-ru';
import { errorMessage } from './telemetry';

beforeEach(() => useLocale.setState({ locale: 'ru' }));
afterEach(() => useLocale.setState({ locale: 'en' }));
const english = /[A-Za-z]{4,}/;
const generic = RU['Something went wrong. The details are under “Details”.'];

describe('the browser refuses a file or a codec: the person is told what happened, in Russian (audit V-113, V-139)', () => {
  it('a file that can no longer be read says so and what to do (V-113)', () => {
    // Chromium's and WebKit's words for a picked file that was moved, deleted or revoked.
    for (const text of ['The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.', 'The I/O read operation failed.']) {
      const said = errorMessage(new DOMException(text, 'NotReadableError'));
      expect(said, text).not.toMatch(english);
      expect(said, text).not.toBe(generic);
      expect(said).toBe(RU['This file can no longer be read. It may have been moved or deleted. Add it again.']);
    }
  });

  it('an encoder or a decoder that refuses says the device could not process the video (V-139)', () => {
    const cases: [string, string][] = [
      ['Decoder failure', 'EncodingError'], ['Encoder failure', 'EncodingError'], ['Codec reclaimed due to inactivity.', 'OperationError'],
      ['Unsupported configuration', 'NotSupportedError'], ['Key frame is required after configure() or flush()', 'DataError'],
    ];
    for (const [text, name] of cases) {
      const said = errorMessage(new DOMException(text, name));
      expect(said, `${name}: ${text}`).not.toMatch(english);
      expect(said, `${name}: ${text}`).not.toBe(generic);
      expect(said).toBe(RU['This device could not process the video. Close other apps and try again.']);
    }
  });
});
