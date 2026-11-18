// The rename Kadr → Chetko (scripts/rename-chetko.ts) on today's tree, in memory: it leaves no visible «Kadr» outside the
// kept lines, it is a fixed point (a second run changes nothing), every exact pair still finds its line, and the Russian
// reads right. Red here means main moved under a rule: lane U fixes the rule (tell U, do not edit it yourself), now and
// not in the window.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAIRS, targets, transform, visibleOld } from './rename-chetko';

const ROOT = join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const files = targets();
const renamed = new Map(files.map((f) => [f, transform(f, read(f))]));

describe('the rename Kadr → Chetko (docs/17 Ч5)', () => {
  it('leaves no «Kadr» a person sees: the interface, the messages, the site, the manifest, the boot screen', () => {
    const left = files.flatMap((f) => visibleOld(f, renamed.get(f)!).map((l) => `${f}: ${l.trim().slice(0, 120)}`));
    expect(left).toEqual([]);
  });

  it('is a fixed point: a second run changes nothing', () => {
    for (const f of files) expect(transform(f, renamed.get(f)!), f).toBe(renamed.get(f));
  });

  it('every exact pair finds its line — before the rename, or its result after it', () => {
    for (const [f, before, after] of PAIRS) {
      const text = read(f);
      expect(text.includes(before) || text.includes(after), `${f}: «${before.slice(0, 60)}» is gone — main moved under the rule. Правило переименования уехало — сообщи U (scripts/rename-chetko.ts), не правь сам`).toBe(true);
    }
  });

  it('keeps what must not change: storage keys, the address, inner names, the backup format', () => {
    for (const f of files) {
      const t = renamed.get(f)!;
      expect(t.match(/kadr\./g)?.length ?? 0, `${f}: kadr.* keys`).toBe(read(f).match(/kadr\./g)?.length ?? 0);
      expect(t.match(/\/Kadr\//g)?.length ?? 0, `${f}: the site's address`).toBe(read(f).match(/\/Kadr\//g)?.length ?? 0);
    }
    expect(renamed.get('src/engine/text.ts')).toContain('`Kadr Custom ${id}`');
  });

  it('reads right in Russian: the name in quotes, neuter', () => {
    const ru = renamed.get('src/lib/locale-ru.ts')!;
    for (const s of ["'Install Chetko': 'Установить «Чётко»'", "'«Чётко» обновилось. Перезагружаем страницу…'", '«Чётко» определило само', '«Чётко» само берёт модель']) expect(ru).toContain(s);
    expect(ru).not.toMatch(/«Чётко» (обновился|определил сам|сам берёт)/);
    const site = renamed.get('seo/tasks.ts')!;
    expect(site).toContain("hubTitle: 'Чётко — бесплатный видеоредактор в браузере телефона'");
    expect(site).toContain('| Чётко');
    expect(renamed.get('seo/legal.ts')).toContain('Само «Чётко» — с этого сайта (GitHub Pages). После первого визита оно работает');
  });
});
