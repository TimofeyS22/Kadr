import { describe, expect, it } from 'vitest';
import { capSharedMemory } from './wasmMemory';

// What ONNX Runtime Web asks for (docs/12 §1.2): 16 MB to start, 4 GB maximum, shared.
const ORT_HEAP = { initial: 256, maximum: 65536, shared: true };

/** A Memory constructor that, like iOS Safari, cannot reserve a shared memory above `limitMb`. */
function device(limitMb: number) {
  const asked: WebAssembly.MemoryDescriptor[] = [];
  const Real = WebAssembly.Memory;
  function Memory(d: WebAssembly.MemoryDescriptor) {
    asked.push(d);
    if (d.shared && (d.maximum ?? 0) > limitMb * 16) throw new RangeError('Out of memory');
    return new Real({ ...d, initial: Math.min(d.initial, 1), maximum: Math.min(d.maximum ?? 1, 16) }); // small, real: tests stay light
  }
  Memory.prototype = Real.prototype;
  return { wasm: { Memory: Memory as unknown as typeof WebAssembly.Memory }, asked };
}

describe('capSharedMemory', () => {
  it('gives ONNX Runtime a 1 GB heap instead of 4 GB, and a real memory that cannot grow past it', () => {
    const wasm = { Memory: WebAssembly.Memory };
    const info = capSharedMemory(wasm);
    const m = new wasm.Memory(ORT_HEAP);
    expect(m).toBeInstanceOf(WebAssembly.Memory);
    expect(info()).toEqual({ capMb: 1024, mb: 16, refused: [] });
    expect(() => m.grow(1024 * 16 - 256 + 1)).toThrow(RangeError); // one page past 1 GB: refused without allocating
  });

  it('steps down to what an iPhone will reserve, and says what it refused', () => {
    const { wasm, asked } = device(512);
    const info = capSharedMemory(wasm);
    new wasm.Memory(ORT_HEAP);
    expect(info().capMb).toBe(512);
    expect(info().refused).toEqual([1024, 768]);
    expect(asked.map((d) => d.maximum)).toEqual([16384, 12288, 8192]);
  });

  it('leaves other memories alone: not shared, or shared within the cap', () => {
    const { wasm, asked } = device(4096);
    capSharedMemory(wasm);
    new wasm.Memory({ initial: 1, maximum: 65536 });
    new wasm.Memory({ initial: 0, maximum: 0, shared: true }); // ORT's SharedArrayBuffer probe
    new wasm.Memory({ initial: 1, maximum: 16384, shared: true });
    expect(asked.map((d) => d.maximum)).toEqual([65536, 0, 16384]);
  });

  it('when even the smallest cap is refused, the browser\'s own error surfaces', () => {
    const { wasm } = device(100);
    const info = capSharedMemory(wasm);
    expect(() => new wasm.Memory(ORT_HEAP)).toThrow('Out of memory');
    expect(info()).toEqual({ capMb: null, mb: null, refused: [1024, 768, 512, 384] });
  });

  it('wraps once: a second call returns the same report', () => {
    const { wasm, asked } = device(4096);
    const a = capSharedMemory(wasm);
    const b = capSharedMemory(wasm);
    new wasm.Memory(ORT_HEAP);
    expect(b).toBe(a);
    expect(asked).toHaveLength(1);
  });
});
