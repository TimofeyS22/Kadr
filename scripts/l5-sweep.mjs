// The runner of an L5 sweep (docs/21 §9, reports/L5 — очередь.md): a lane's rows in the order the lane's script lists
// them — scenarios of scripts/l5-tools.mjs run as a child process (its own session), the sweep's own scenarios in one
// session of scripts/l5-session.mjs — each judged against the queue's thresholds (scripts/l5-verdict.mjs) and printed as
// PASS / FAIL / ERROR / LOOK with the measured value and the threshold. Evidence goes to L5_OUT: the sweep's JSON, rows
// for the journal, screenshots and the files the phone made. The manual steps of the lane are printed at the end.
//   L5_UDID=… L5_OUT=… node scripts/l5-sweep-<lane>.mjs [site URL]
//   Env: L5_ONLY=ID,ID (only these rows), L5_PRICE=1,2 (only rows of these prices), L5_KEEP=1 (projects stay on the phone), L5_MAC=1 (Safari on this Mac).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, sleep } from './l5-session.mjs';
import { ERROR, holds, judge, line, mdRow, none, toolsRows, totals } from './l5-verdict.mjs';

/**
 * The price of a failure for the person (docs/16 §6), the order of the run: 1 work lost, 2 no file, 3 does not open,
 * 4 slow, 5 inconvenient.
 */
export const PRICE = { 1: 'потеря работы', 2: 'нет файла', 3: 'не открывается', 4: 'медленно', 5: 'неудобно' };
/** Whether a row is picked by L5_ONLY (an ID or a part of one, comma-separated) and L5_PRICE (prices, e.g. 1,2). */
export function picked(ids, price, only = process.env.L5_ONLY, prices = process.env.L5_PRICE) {
  const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  if (prices && !list(prices).includes(String(price))) return false;
  if (!only) return true;
  return [ids].flat().some((id) => list(only).some((w) => id.includes(w)));
}

/** Runs `scripts/l5-tools.mjs` with the scenarios given; returns its rows. A phone that refuses the session is asked again. */
async function tools(item, { url, out }) {
  const dir = join(out, item.name);
  for (let attempt = 1; ; attempt++) {
    let text = '';
    const code = await new Promise((done) => {
      const child = spawn(process.execPath, [join(import.meta.dirname, 'l5-tools.mjs'), ...item.scenarios], { env: { ...process.env, L5_URL: url, L5_OUT: dir, ...item.env }, stdio: ['ignore', 'pipe', 'inherit'] });
      child.stdout.on('data', (b) => {
        text += b;
        for (const l of String(b).split('\n')) if (l.trim()) console.log(`  l5-tools: ${l.slice(0, 220)}`);
      });
      child.on('exit', (c) => done(c));
    });
    const rows = toolsRows(text);
    if (code !== 2 || rows.length || attempt === 3) return { rows, code };
    console.log('  (l5-tools не получил сессию — телефон ещё держит прошлую; ещё раз через 30 с)');
    await sleep(30_000);
  }
}

/**
 * Runs a lane. `items` in order: `{ id, run(ctx) → measured, judge(measured) → checks | { checks, look }, page: false }`
 * for the sweep's own scenarios, or `{ tools: { name, scenarios, env }, ids, judge(rows) → judged rows }` for l5-tools.
 */
export async function sweep({ lane, title, items, manual = [] }) {
  const url = process.argv[2] ?? 'https://timofeys22.github.io/Kadr/';
  const out = process.env.L5_OUT ?? join(process.env.TMPDIR ?? '/tmp', `kadr-l5-sweep-${lane}`);
  mkdirSync(out, { recursive: true });
  const started = new Date().toISOString();
  const results = [];
  let ctx = null, version = null;
  const release = async () => { if (ctx) { await ctx.close(); ctx = null; await sleep(5000); } };
  process.once('SIGINT', async () => { await ctx?.close(); process.exit(130); });
  const report = (r) => { results.push(r); console.log(line(r)); };
  const chosen = items.filter((it) => picked(it.ids ?? it.id, it.price));
  console.log(`L5 ${title}: ${url}, ${chosen.length} из ${items.length} позиций, доказательства в ${out}`);
  try {
    for (const it of chosen) {
      if (it.tools) {
        await release();
        console.log(`· [${PRICE[it.price]}] l5-tools ${it.tools.scenarios.length > 6 ? `${it.tools.scenarios[0]} ×${it.tools.scenarios.length}` : it.tools.scenarios.join(' ')} (${[it.ids].flat().join(', ')})`);
        const { rows, code } = await tools(it.tools, { url, out });
        if (!rows.length) for (const id of [it.ids].flat()) report(judge(id, [], { error: `l5-tools ended with code ${code} and no rows` }));
        else for (const r of it.judge(rows)) report({ ...r, measured: { rows: rows.length } });
        continue;
      }
      // A row that needs empty site data (a cold start) gets a session of its own: each starts with none.
      if (it.newSession) await release();
      if (!ctx) {
        try { ctx = await connect({ url, out }); } catch (e) {
          report(judge(it.id, [], { error: String(e.message ?? e).slice(0, 300) }));
          continue;
        }
        console.log(`  устройство: ${ctx.session.capabilities['safari:deviceName'] ?? ctx.session.capabilities.browserName}, iOS ${ctx.session.capabilities['safari:platformVersion'] ?? '—'}`);
      }
      console.log(`· [${PRICE[it.price]}] ${it.id}`);
      const t = Date.now();
      let measured, judged;
      try {
        measured = await it.run(ctx);
        const page = it.page === false ? undefined : await ctx.page().catch(() => null);
        const got = it.judge(measured);
        const own = Array.isArray(got) ? { checks: got } : got;
        const tab = it.page === false ? [] : page
          ? [none('ошибки страницы', page.errors), none('тосты ошибок', page.toasts)]
          : [holds('вкладка жива', false, 'страница потеряла состояние', 'жива')];
        judged = judge(it.id, [...own.checks, ...tab], { look: own.look });
      } catch (e) {
        judged = judge(it.id, [], { error: String(e.message ?? e).slice(0, 300) });
        await ctx.shot(`fail-${it.id.replace(/[^\w-]+/g, '_')}`).catch(() => undefined);
      }
      report({ ...judged, measured, s: Math.round((Date.now() - t) / 1000) });
      if (!it.keep) await ctx.cleanup().catch(() => undefined);
      // The site's version, from the home screen's footer once a row has left the phone there.
      if (!version) {
        version = await ctx.js("return (document.querySelector('.home-foot')?.textContent.match(/v\\d+\\.\\d+\\.\\d+/) ?? [null])[0]").catch(() => null);
        if (version) console.log(`  сайт: ${version}`);
      }
    }
  } finally {
    await ctx?.close();
    const rows = results;
    const sum = totals(rows);
    writeFileSync(join(out, `sweep-${lane}.json`), JSON.stringify({ lane, url, version, started, finished: new Date().toISOString(), results }, null, 2));
    writeFileSync(join(out, `sweep-${lane}.md`), [
      `### ${title}: ${url}, ${version ?? '?'}, ${started.slice(0, 16)}Z`, '',
      `Скрипт \`scripts/l5-sweep-${lane}.mjs\`; итог: PASS ${sum.PASS}, FAIL ${sum.FAIL}, ERROR ${sum.ERROR}, LOOK ${sum.LOOK}. Касания — click() и события пальца в странице, файлы положены в страницу вместо «Фото» (L5-авто, \`docs/16\` §4).`, '',
      '| ID | Исход | Замер | Порог |', '|---|---|---|---|', ...rows.map(mdRow), '',
    ].join('\n'));
    console.log(`\nИтог ${title}: PASS ${sum.PASS} · FAIL ${sum.FAIL} · ERROR ${sum.ERROR} · LOOK ${sum.LOOK}. Строки для журнала: ${join(out, `sweep-${lane}.md`)}`);
    if (manual.length) {
      console.log(`\nВручную, на телефоне, после скрипта (${title}; порог записан заранее, итог — в журнал):`);
      manual.forEach((m, i) => console.log(`  ${i + 1}. ${m.id} — ${m.steps}\n     Порог: ${m.limit}`));
    }
  }
  const failed = results.some((r) => r.status === 'FAIL' || r.status === ERROR);
  process.exitCode = failed ? 1 : 0;
  return results;
}
