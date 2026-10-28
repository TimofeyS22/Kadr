import { describe, expect, it, vi } from 'vitest';
import { readBody, within } from './limits';

describe('within: no endless wait (docs/12 G2)', () => {
  it('gives the answer when it comes in time, the fallback when it does not, and rejects with what the fallback throws', async () => {
    expect(await within(Promise.resolve(1), 50, () => 2)).toBe(1);
    expect(await within(new Promise<number>(() => undefined), 20, () => 2)).toBe(2);
    await expect(within(new Promise<number>(() => undefined), 20, () => { throw new Error('late'); })).rejects.toThrow('late');
    await expect(within(Promise.reject(new Error('own')), 50, () => 2)).rejects.toThrow('own');
  });
});

const body = (chunks: (Uint8Array | 'hang')[]) => new Response(new ReadableStream<Uint8Array>({
  async pull(c) {
    const next = chunks.shift();
    if (next === undefined) c.close();
    else if (next === 'hang') await new Promise(() => undefined);
    else c.enqueue(next);
  },
}));

describe('readBody', () => {
  it('reads every chunk of a healthy body', async () => {
    const got: number[] = [];
    await readBody(body([new Uint8Array([1, 2]), new Uint8Array([3])]), (c) => { got.push(...c); }, 200, () => new Error('stalled'));
    expect(got).toEqual([1, 2, 3]);
  });
  it('fails with the stall error when the body goes silent, after what came before', async () => {
    const got: number[] = [];
    await expect(readBody(body([new Uint8Array([7]), 'hang']), (c) => { got.push(...c); }, 50, () => new Error('stalled'))).rejects.toThrow('stalled');
    expect(got).toEqual([7]);
  });
  it('stops at once on cancel', async () => {
    const ac = new AbortController();
    const onChunk = vi.fn(() => ac.abort());
    await expect(readBody(body([new Uint8Array([1]), new Uint8Array([2])]), onChunk, 1000, () => new Error('stalled'), ac.signal)).rejects.toThrow(/Cancelled/);
    expect(onChunk).toHaveBeenCalledTimes(1);
  });
});
