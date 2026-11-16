// Verifier E3 (docs/21 §5), audit V-139 (and the message half of V-113): "an encoder or decoder that refuses shows the
// engine's English words". The browser names such a refusal by a DOMException; Kadr says what happened, in the person's
// language, and leaves the engine's words to Details. error-messages.test.ts checks plain Errors; this checks the names.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useLocale } from './i18n';
import { RU } from './locale-ru';
import { errorMessage } from './telemetry';

beforeEach(() => useLocale.setState({ locale: 'ru' }));
afterEach(() => useLocale.setState({ locale: 'en' }));

it('a codec that refuses (EncodingError, OperationError, NotSupportedError, DataError) is said in Kadr\'s words (audit V-139)', () => {
  for (const name of ['EncodingError', 'OperationError', 'NotSupportedError', 'DataError']) {
    expect(errorMessage(new DOMException('Decoder failure: the configuration is not supported', name)), name)
      .toBe(RU['This device could not process the video. Close other apps and try again.']);
  }
});

it('a file the browser can no longer read is said to be so, not a codec failure (audit V-113)', () => {
  expect(errorMessage(new DOMException('The requested file could not be read', 'NotReadableError')))
    .toBe(RU['This file can no longer be read. It may have been moved or deleted. Add it again.']);
});
