// Counts reports/Ноль проблем — реестр.md for docs/16: what is open, by severity and state, and whether Z1 can hold.
import { readFileSync } from 'node:fs';

const CLOSED = new Set(['закрыта', 'отказ владельца']);
const rows = readFileSync(new URL('../reports/Ноль проблем — реестр.md', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => /^\| [A-Z]+(-[A-Z0-9]+)+ \|/.test(l))
  .map((l) => l.split('|').map((c) => c.trim()))
  .map((c) => ({ id: c[1], severity: c[2], cls: c[3], state: c[6] }));

const open = (severity) => rows.filter((r) => r.severity === severity && !CLOSED.has(r.state));
const byState = (list) => Object.entries(Object.groupBy(list, (r) => r.state)).map(([s, l]) => `${s} ${l.length}`).join(', ');

console.log(`Записей: ${rows.length}`);
for (const severity of ['P0', 'P1', 'P2']) {
  const list = open(severity);
  console.log(`${severity}: не закрыто ${list.length} (${byState(list)})`);
}
console.log(`Z1: ${open('P0').length + open('P1').length === 0 ? 'выполнимо, проверить P2' : 'не выполнено'}`);
