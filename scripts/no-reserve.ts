// mediabunny's BufferTarget reserves 4 GiB of address space per instance (a resizable ArrayBuffer with a 4 GiB
// maxByteLength, docs/12 §1.3 item 14), and its MP4 muxer makes one for itself in every output, whatever target the
// app passes. Kadr's own outputs write to MemoryTarget (src/engine/memTarget.ts); this build step makes the muxer's
// own BufferTarget grow plain ArrayBuffers instead (it holds only the small index box). If mediabunny changes the
// line, the build fails here rather than quietly reserving again.

const FILE = /[\\/]mediabunny[\\/]dist[\\/]modules[\\/]src[\\/]target\.js$/;
const RESIZE = /this\._supportsResize = 'resize' in new ArrayBuffer\(0\);/;

/** The source of mediabunny's target.js with BufferTarget's resizable buffer turned off. */
export function noReserve(code: string): string {
  if (!RESIZE.test(code)) throw new Error('mediabunny BufferTarget changed: check scripts/no-reserve.ts (docs/12 §1.3 item 14)');
  return code.replace(RESIZE, 'this._supportsResize = false; // Kadr: no 4 GiB reservation (scripts/no-reserve.ts)');
}

// mediabunny 1.63+ measures the audio encoder's delay before every first use, with nothing that gives up: an encoder that
// never answers (seen on phones: an export stood at 0% for good) or a decoder the browser refuses stopped the export. After a
// few seconds, or on any failure, it counts as no delay; Kadr's own measure (src/engine/encoderDelay.ts) corrects what is left.
const MEDIA_SOURCE = /[\\/]mediabunny[\\/]dist[\\/]modules[\\/]src[\\/]media-source\.js$/;
const PROBE = 'await detectAudioEncoderPrimingShift(this.encodingConfig.codec, encoderConfig.codec)';
const PROBE_MS = 5000;

/** The source of mediabunny's media-source.js with the encoder delay probe bounded in time and unable to fail. */
export function patientProbe(code: string): string {
  if (!code.includes(PROBE)) throw new Error('mediabunny encoder delay probe changed: check scripts/no-reserve.ts');
  return code.replace(PROBE, `await Promise.race([detectAudioEncoderPrimingShift(this.encodingConfig.codec, encoderConfig.codec).catch(() => 0), new Promise((r) => setTimeout(r, ${PROBE_MS}, 0))]) /* Kadr: scripts/no-reserve.ts */`);
}

/** For Vite and its dependency pre-bundling (Rolldown): the same transforms. */
export const noReservePlugin = {
  name: 'kadr-no-reserve',
  transform(code: string, id: string) {
    if (FILE.test(id)) return { code: noReserve(code), map: null };
    return MEDIA_SOURCE.test(id) ? { code: patientProbe(code), map: null } : null;
  },
};
