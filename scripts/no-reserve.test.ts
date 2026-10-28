import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { noReserve, noReservePlugin } from './no-reserve';

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
