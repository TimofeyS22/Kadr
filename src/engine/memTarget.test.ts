import { describe, expect, it } from 'vitest';
import { MemoryTarget } from './memTarget';

/** Writes as mediabunny's StreamTarget hands them to its stream. */
async function write(t: MemoryTarget, parts: [number, number[]][]) {
  const w = (t as unknown as { _writable: WritableStream<{ type: 'write'; data: Uint8Array; position: number }> })._writable.getWriter();
  for (const [position, bytes] of parts) await w.write({ type: 'write', data: new Uint8Array(bytes), position });
  w.releaseLock();
}
const bytes = async (b: Blob) => [...new Uint8Array(await b.arrayBuffer())];

describe('MemoryTarget: an output in memory without a 4 GiB reservation (docs/12 §1.3 item 14)', () => {
  it('keeps chunks written front to back as they are', async () => {
    const t = new MemoryTarget();
    await write(t, [[0, [1, 2]], [2, [3]], [3, [4, 5]]]);
    const b = t.blob('video/mp4');
    expect(b.type).toBe('video/mp4');
    expect(await bytes(b)).toEqual([1, 2, 3, 4, 5]);
  });
  it('applies a size patched in place after the data (MP4 without fast start, WebM)', async () => {
    const t = new MemoryTarget();
    await write(t, [[0, [0, 0, 9]], [3, [4, 5, 6]], [0, [7, 8]]]);
    expect([...new Uint8Array(t.buffer())]).toEqual([7, 8, 9, 4, 5, 6]);
  });
  it('fails loudly on an empty output rather than giving an empty file', () => {
    expect(() => new MemoryTarget().blob()).toThrow(/no data/);
  });
});
