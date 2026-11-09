// A message about the network has to be true (docs/16 N7; CapCut's false "no internet", ×1.7–3.3 among Russian speakers).
// A browser that says it is online may well be: the host can be blocked or down. Then "check your connection" sends a
// person to fix what is not broken, so only a browser that says it is offline may hear about the internet.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RU } from './locale-ru';
import { errorMessage } from './telemetry';

const SRC = join(import.meta.dirname, '..');
const sources = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : [];
});

const online = (value: boolean) => vi.stubGlobal('navigator', { ...globalThis.navigator, onLine: value });
afterEach(() => vi.unstubAllGlobals());

describe('network messages', () => {
  it('no message tells a person to check a connection the browser says is there', () => {
    const blame = /check (the|your) (connection|network|internet)/i;
    const found = sources(SRC).filter((f) => !f.endsWith('network-messages.test.ts') && blame.test(readFileSync(f, 'utf8')));
    expect(found).toEqual([]);
    expect(Object.values(RU).filter((v) => /Проверьте (сеть|интернет|подключение)/.test(v))).toEqual([]);
  });

  it('a request that failed while online is the server not answering, not the internet', () => {
    online(true);
    for (const text of ['Load failed', 'Failed to fetch', 'NetworkError when attempting to fetch resource.']) {
      const said = errorMessage(new TypeError(text));
      expect(said).not.toMatch(/internet|connection/i);
      expect(said).toMatch(/server/i);
    }
  });

  it('a request that failed while offline says so', () => {
    online(false);
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe('No internet connection.');
  });

  it('every source line that says "No internet" is reached only when the browser reports offline', () => {
    const gated: Record<string, RegExp> = {
      'engine/captions.ts': /!navigator\.onLine/,
      'engine/modelLoad.ts': /navigator\.onLine \?/,
      'lib/telemetry.ts': /navigator\.onLine \?/,
      'lib/update.ts': /navigator\.onLine \?/,
      'ui/actions.ts': /navigator\.onLine \?/,
    };
    for (const f of sources(SRC)) {
      const rel = f.slice(SRC.length + 1), text = readFileSync(f, 'utf8');
      if (rel === 'lib/locale-ru.ts' || !/['"`]No internet/.test(text)) continue;
      expect(Object.keys(gated), `${rel} says "No internet"`).toContain(rel);
      expect(text, `${rel} decides by navigator.onLine`).toMatch(gated[rel]);
    }
  });
});
