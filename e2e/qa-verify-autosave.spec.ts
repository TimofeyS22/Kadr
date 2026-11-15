// Edits in a row reach the disk while they go on (audit V-109), at a pace the page itself keeps. The editor.spec test
// paces its edits from Playwright: a fill, 250 ms, then a read of the disk; on a loaded machine one round took more than
// the 600 ms autosave pause, so the code from before the fix (each edit puts the save off by 600 ms) saved between
// edits and passed too (verification, docs/21 §5). Here the edits are made inside the page, 300 ms apart by its own
// clock, and the disk is read alongside without holding them up.
import { expect, test } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.undoMoved.v1', '1');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
  });
});

test('a run of edits 300 ms apart is on the disk before the run ends (audit V-109)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx('landscape.mp4'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.waitForTimeout(1500); // the import is on the disk; nothing is pending
  const run = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Project name"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    const id = decodeURIComponent(location.hash.replace(/^#\/p\//, ''));
    const stored = () => new Promise<string>((ok, ko) => {
      const r = indexedDB.open('kadr');
      r.onerror = () => ko(r.error);
      r.onsuccess = () => {
        const db = r.result;
        const g = db.transaction('kv').objectStore('kv').get(`p:${id}`);
        g.onsuccess = () => { db.close(); ok(String((g.result as { name?: string } | undefined)?.name)); };
        g.onerror = () => ko(g.error);
      };
    });
    const EDITS = 30, GAP = 300; // 30 edits over 8.7 s: none of them waits 600 ms for the next
    const t0 = performance.now();
    const at = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, t0 + ms - performance.now())));
    const edits = (async () => {
      const late: number[] = [];
      for (let i = 0; i < EDITS; i++) {
        await at(i * GAP);
        late.push(Math.round(performance.now() - t0 - i * GAP));
        setValue.call(input, `E${i}`);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return late;
    })();
    // Read while the run goes on, from 4 s (the fix puts the first edit of a run on the disk within 2.5 s).
    const reads: string[] = [];
    for (const ms of [4000, 5500, 7000, 8500]) { await at(ms); reads.push(`${ms}:${await stored()}`); }
    const late = await edits;
    return { reads, maxLate: Math.max(...late) };
  });
  console.log(`V-109 run (${test.info().project.name}): reads ${run.reads.join(', ')}; an edit came at most ${run.maxLate} ms late`);
  expect(run.maxLate, 'the page kept the pace: no gap between edits reached the 600 ms pause').toBeLessThan(300);
  expect(run.reads.some((r) => /:E\d+$/.test(r)), `something of the run is on the disk before it ends: ${run.reads.join(', ')}`).toBe(true);
  // And the run's end is saved in the end, with or without the fix.
  await expect.poll(() => page.evaluate(() => new Promise<string>((ok, ko) => {
    const id = decodeURIComponent(location.hash.replace(/^#\/p\//, ''));
    const r = indexedDB.open('kadr');
    r.onerror = () => ko(r.error);
    r.onsuccess = () => { const db = r.result; const g = db.transaction('kv').objectStore('kv').get(`p:${id}`); g.onsuccess = () => { db.close(); ok(String((g.result as { name?: string } | undefined)?.name)); }; };
  })), { timeout: 10_000 }).toBe('E29');
  expect(errors).toEqual([]);
});
