import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { noReserve, noReservePlugin, patientProbe, releaseFrameCopy } from './no-reserve';

const target = join(import.meta.dirname, '..', 'node_modules', 'mediabunny', 'dist', 'modules', 'src', 'target.js'); // what the app bundles

describe('no 4 GiB reservation in mediabunny (docs/12 §1.3 item 14)', () => {
  it('turns off the resizable buffer in the installed mediabunny', () => {
    const code = readFileSync(target, 'utf8');
    expect(code).toContain('maxByteLength: ARRAY_BUFFER_MAX_SIZE'); // what is being avoided is still there
    const out = noReservePlugin.transform(code, target)?.code ?? '';
    expect(out).toContain('this._supportsResize = false;');
    expect(out).not.toMatch(/_supportsResize = 'resize' in/);
  });
  it('leaves other files alone and fails loudly when the line is gone', () => {
    expect(noReservePlugin.transform('x', '/node_modules/mediabunny/dist/modules/src/output.js')).toBeNull();
    expect(() => noReserve('class BufferTarget {}')).toThrow(/mediabunny BufferTarget changed/);
  });
});

describe('mediabunny encoder delay probe', () => {
  const line = 'const s = await detectAudioEncoderPrimingShift(this.encodingConfig.codec, encoderConfig.codec);';
  it('gives up in time and cannot fail the export', () => {
    const out = patientProbe(line);
    expect(out).toContain('Promise.race');
    expect(out).toContain('.catch(() => 0)');
  });
  it('stops the build when the library changes that line', () => {
    expect(() => patientProbe('const s = 0;')).toThrow(/encoder delay probe changed/);
  });
  it('reaches the real file of the installed version', () => {
    const real = readFileSync('node_modules/mediabunny/dist/modules/src/media-source.js', 'utf8');
    expect(noReservePlugin.transform(real, '/x/node_modules/mediabunny/dist/modules/src/media-source.js')?.code).toContain('Kadr: scripts/no-reserve.ts');
  });
});

describe('mediabunny frame-copy canvas on Chromium for Android (SW-B-6)', () => {
  const file = '/x/node_modules/mediabunny/dist/modules/src/media-sink.js';
  it('lets the canvas go when a video decoder closes, in the installed version', () => {
    const real = readFileSync('node_modules/mediabunny/dist/modules/src/media-sink.js', 'utf8');
    expect(real).toContain('this.frameCopyContext = context;'); // what is being let go is still made
    const out = noReservePlugin.transform(real, file)?.code ?? '';
    const close = out.slice(out.indexOf('this.sampleQueue.length = 0;', out.indexOf('class VideoDecoderWrapper')), out.indexOf('let mergerWorkerUrl = null;'));
    expect(close).toContain('this.frameCopyContext.canvas.width = 0; this.frameCopyContext.canvas.height = 0; this.frameCopyContext = null;');
  });
  it('stops the build when the library changes the decoder', () => {
    expect(() => releaseFrameCopy('class VideoDecoderWrapper {}')).toThrow(/VideoDecoderWrapper changed/);
  });
});
