// The one summary of a sharded e2e run in CI (.github/workflows/e2e.yml): Playwright's merged JSON report in, a
// Markdown summary out — passed, failed, skipped and flaky per project, each failed test as file:line and title with
// the first line of its error, and the shards that left no report (a job that died counts as red, not as fewer tests).
//   node scripts/ci-e2e-summary.mjs <report.json> <blob-report dir> <expected reports> [summary.md]
// Exit 1 when a test failed or a shard is missing.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [reportPath, blobDir, expectedArg, outPath] = process.argv.slice(2);
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const expected = Number(expectedArg);
const blobs = readdirSync(blobDir).filter((f) => f.endsWith('.zip'));

// Paths in the report are relative to the test folder (e2e/, at the top of the repository); the summary names them from the
// repository root, as people do.
const testDir = `${basename(report.config?.rootDir ?? 'e2e')}/`;
const STATUS = { expected: 'passed', unexpected: 'failed', skipped: 'skipped', flaky: 'flaky' };
const byProject = new Map();
const failed = []; // { where, title, projects: Map(project → error line) }
const firstLine = (s) => (s ?? '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';

const walk = (suite, titles) => {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests) {
      const count = byProject.get(t.projectName) ?? { passed: 0, failed: 0, skipped: 0, flaky: 0 };
      count[STATUS[t.status]]++;
      byProject.set(t.projectName, count);
      if (t.status !== 'unexpected') continue;
      const where = `${testDir}${spec.file}:${spec.line}`;
      const title = [...titles, spec.title].join(' › ');
      let row = failed.find((f) => f.where === where && f.title === title);
      if (!row) failed.push(row = { where, title, projects: new Map() });
      const last = t.results.at(-1);
      row.projects.set(t.projectName, firstLine(last?.error?.message ?? last?.errors?.[0]?.message));
    }
  }
  for (const child of suite.suites ?? []) walk(child, child.title && !child.title.endsWith('.ts') ? [...titles, child.title] : titles);
};
for (const s of report.suites ?? []) walk(s, []);

const total = { passed: 0, failed: 0, skipped: 0, flaky: 0 };
for (const c of byProject.values()) for (const k of Object.keys(total)) total[k] += c[k];
const minutes = Math.round((report.stats?.duration ?? 0) / 60000);
const missing = expected - blobs.length;
const lines = [
  `## E2E: ${total.passed} passed, ${total.failed} failed, ${total.skipped} skipped${total.flaky ? `, ${total.flaky} flaky` : ''}`,
  '',
  `Wall time from the first shard's start: ${minutes} min. Shard reports: ${blobs.length} of ${expected}.`,
  '',
  '| Project | Passed | Failed | Skipped | Flaky |',
  '|---|---:|---:|---:|---:|',
  ...[...byProject].sort().map(([p, c]) => `| ${p} | ${c.passed} | ${c.failed} | ${c.skipped} | ${c.flaky} |`),
  '',
];
if (missing > 0) lines.push(`**${missing} shard(s) left no report** (job crashed, timed out or was cancelled): the counts above are incomplete.`, '');
for (const e of report.errors ?? []) lines.push(`**Run error:** ${firstLine(e.message)}`, '');
if (failed.length) {
  lines.push(`### Failed tests (${failed.length})`, '');
  for (const f of failed.sort((a, b) => a.where.localeCompare(b.where, 'en', { numeric: true }))) {
    lines.push(`- \`${f.where}\` ${f.title} — ${[...f.projects.keys()].sort().join(', ')}`);
    for (const [p, err] of f.projects) if (err) lines.push(`  - ${p}: ${err.slice(0, 300)}`);
  }
  lines.push('');
}
const md = lines.join('\n');
if (outPath) writeFileSync(outPath, md);
process.stdout.write(`${md}\n`);
process.exit(total.failed > 0 || missing > 0 || (report.errors ?? []).length > 0 ? 1 : 0);
