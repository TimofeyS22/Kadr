// Rolls the live site back to an earlier version in minutes (docs/12 G7, audit V-166): finds the last successful
// "Test and deploy" run that published that version, checks that its site is still kept (30 days), and starts
// .github/workflows/rollback.yml with it. Without --go it only says what it would do: a rollback is a deploy, and
// every deploy needs the owner's yes. Projects saved by the newer version must open in the older one (docs/16 N6).
//   node scripts/rollback.mjs <version> [--go]
import { execFileSync } from 'node:child_process';

const version = process.argv[2];
const go = process.argv.includes('--go');
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('usage: node scripts/rollback.mjs <version, e.g. 1.8.1> [--go]');
  process.exit(2);
}
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
/** The version a commit carries, or null for a commit this clone does not have. */
const versionAt = (sha) => {
  try { return JSON.parse(execFileSync('git', ['show', `${sha}:package.json`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).version; } catch { return null; }
};

// Newest first; a run whose deploy failed (a Pages time-out) is not a success and is never picked.
const runs = JSON.parse(gh('run', 'list', '--workflow', 'deploy.yml', '--branch', 'main', '--status', 'success', '--limit', '100', '--json', 'databaseId,headSha,createdAt'));
const run = runs.find((r) => versionAt(r.headSha) === version);
if (!run) {
  console.error(`No successful deploy of ${version} among the last ${runs.length} (git fetch first if the commit is missing here).`);
  process.exit(1);
}
const { artifacts } = JSON.parse(gh('api', `repos/{owner}/{repo}/actions/runs/${run.databaseId}/artifacts`));
const site = artifacts.find((a) => a.name === 'github-pages' && !a.expired);
if (!site) {
  console.error(`The site of run ${run.databaseId} (${version}) is no longer kept: build ${run.headSha.slice(0, 7)} again instead (git revert and push).`);
  process.exit(1);
}
console.log(`${version}: run ${run.databaseId} (${run.headSha.slice(0, 7)}, ${run.createdAt}), its site ${Math.round(site.size_in_bytes / 2 ** 20)} MB, kept until ${site.expires_at}`);
if (!go) {
  console.log('Not started. Add --go to put this site back on the live address (a deploy: only with the owner\'s yes).');
  process.exit(0);
}
gh('workflow', 'run', 'rollback.yml', '--ref', 'main', '-f', `run_id=${run.databaseId}`, '-f', `version=${version}`);
console.log('Started. Follow it: gh run list --workflow rollback.yml --limit 1, then gh run watch <id>');
