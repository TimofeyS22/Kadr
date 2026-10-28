import { describe, expect, it } from 'vitest';
import { deviceSummary, entryFor, scrub } from './errorLog';

describe('error log: nothing of the person in it (docs/12 stage 4)', () => {
  it('blanks file names, quoted text and URL paths, keeps API names and the gist', () => {
    expect(scrub('Could not decode “Отпуск в Сочи.MOV”: The sound of "my voice.m4a" failed'))
      .toBe('Could not decode “…”: The sound of "…" failed');
    expect(scrub('HTTP 404 for https://huggingface.co/x/resolve/abc/model.onnx?token=1')).toBe('HTTP 404 for https://huggingface.co/…');
    expect(scrub("Failed to execute 'decode' on 'AudioDecoder': file /var/mobile/IMG_0042.mov")).toBe("Failed to execute 'decode' on 'AudioDecoder': file /var/mobile/[file]");
  });
  it('keeps the template of Kadr\'s own message and only the engine\'s words, never a name', () => {
    const e = Object.assign(new Error('Could not add {name}: {error}'), { name: 'MediaError', vars: { name: 'секрет.mp4', error: 'RangeError: Out of memory' } });
    const x = entryFor(e, 'captions');
    expect(x).toMatchObject({ where: 'captions', kind: 'MediaError', message: 'Could not add {name}: {error} — RangeError: Out of memory' });
    expect(JSON.stringify(x)).not.toContain('секрет');
  });
  it('tells the device coarsely', () => {
    expect(deviceSummary('Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1')).toMatch(/^iPhone, iOS 26\.1, Safari 26\.1/);
    expect(deviceSummary('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 YaBrowser/25.6.1.62.00')).toMatch(/^Android 14, Yandex 25/);
  });
});
