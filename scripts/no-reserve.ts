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

/** For Vite and its dependency pre-bundling (Rolldown): the same transform. */
export const noReservePlugin = {
  name: 'kadr-no-reserve',
  transform(code: string, id: string) {
    return FILE.test(id) ? { code: noReserve(code), map: null } : null;
  },
};
