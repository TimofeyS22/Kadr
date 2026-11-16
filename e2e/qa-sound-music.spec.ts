// Music at its edges (QA matrix Q-21, docs/11 §3.5, §3.13): cuts land on the beat where the music is on the timeline,
// not where the beat is in the file; the library without a network says so, and a track added before plays offline.
import { expect, test } from '@playwright/test';
import { switchableNetwork } from './network';
import { audits, expectedConsole, exportAs, importFiles, probe, rmsDb, samples, selectClip, sheet, storedProject, tool } from './qa-platform-kit';
import type { AudioClip, Project } from '../src/core/types';

audits();

test('cut to the beat of music that starts later and is trimmed: every cut is on a beat as the timeline plays it (Q-21)', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await importFiles(page, 'Media', ['photo.png', 'person.jpg', 'photo.png', 'person.jpg']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(4);
  await page.getByRole('button', { name: 'Close tools' }).click();
  // The music goes in at 1.25 s: a beat grid read in the file's own time would miss by a quarter of a beat (120 BPM).
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 1.25 * 60; });
  await expect.poll(() => page.locator('.time b').textContent()).toMatch(/^0:01\.[23]$/);
  await importFiles(page, 'Audio', ['beat120.m4a']);
  const music = page.locator('.tl-row.audio .clip').first();
  await expect(music).toHaveCount(1);
  await selectClip(page, music);
  await tool(page, 'Beat').click();
  await page.getByRole('button', { name: 'Find the beat' }).click();
  await expect(page.locator('.beat-bpm b')).toHaveText(/^(119|120|121)$/, { timeout: 60_000 });
  await sheet(page).getByRole('button', { name: 'Every 2nd beat', exact: true }).click();
  await expect(page.getByText(/cuts now land on the beat/)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(1500);
  const p = await storedProject<Project>(page);
  const m = p.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'audio') as AudioClip;
  const times = p.assets[m.assetId].beats!.times;
  const onTimeline = times.map((b) => m.start + (b - m.in) / m.speed).filter((t) => t >= m.start);
  const main = p.tracks.find((t) => t.kind === 'main')!.clips;
  const cuts = main.slice(0, -1).map((c) => c.start + c.duration);
  expect(cuts.length).toBeGreaterThan(0);
  for (const cut of cuts) {
    const nearest = Math.min(...onTimeline.map((t) => Math.abs(t - cut)));
    expect(nearest, `cut at ${cut.toFixed(3)} s; beats on the timeline ${onTimeline.slice(0, 8).map((t) => t.toFixed(3)).join(' ')}…`).toBeLessThan(0.002);
  }
  // Undo puts every clip back in one step.
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(1500);
  const back = (await storedProject<Project>(page)).tracks.find((t) => t.kind === 'main')!.clips.map((c) => c.duration);
  expect(new Set(back).size, `durations after undo: ${back.join(', ')}`).toBe(1);
});

test.describe(() => {
  test.use({ serviceWorkers: 'allow' });

  test('a track added from the library plays and exports offline (Q-21 §3.13)', async ({ page, context, baseURL, browserName }, info) => {
    test.setTimeout(420_000);
    expectedConsole(/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR_FAILED|WebKit encountered an internal error|Load failed|FetchEvent/);
    test.skip(!baseURL?.startsWith('http://'), 'the network is taken away through a local proxy (e2e/network.ts)');
    const net = await switchableNetwork(baseURL!);
    await page.goto(net.url);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.getByRole('button', { name: 'New project' }).click();
    await page.locator('.aspect-card', { hasText: '9:16' }).click();
    await importFiles(page, 'Media', ['photo.png']);
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
    await page.getByRole('button', { name: 'Close tools' }).click();
    await tool(page, 'Music').click();
    const row = page.locator('.music-row').first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole('button', { name: /^Add .* at the playhead$/ }).click();
    await expect(page.locator('.tl-row.audio .clip')).toHaveCount(1, { timeout: 60_000 });
    await page.waitForTimeout(1500); // saved
    // No network from here on, the page opened again from the service worker.
    net.off();
    if (browserName === 'chromium') await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.tl-row.audio .clip')).toHaveCount(1, { timeout: 30_000 });
    const file = await exportAs(page, info, 'Audio', { loudness: false });
    expect(Math.abs(probe(file).duration - 3)).toBeLessThan(0.15);
    expect(rmsDb(samples(file), 0.5, 2.5), 'the track is in the file offline').toBeGreaterThan(-40);
    await context.setOffline(false);
    await net.close();
  });
});
