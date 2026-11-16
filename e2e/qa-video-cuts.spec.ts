// QA matrix Q-15 (docs/21 lane C): transitions and «Apply to all cuts» — by docs/11 §3. Points 1–2 are editor.spec.ts
// («new transitions render mid-cut…», WYSIWYG «Пример» and «in motion»); this file holds 3–4 for «Apply to all cuts» and
// point 5, the ends: a transition longer than its clips allow, the cut it was on taken away, the shortest pieces.
import { expect, test, type Page } from '@playwright/test';
import {
  audited, closeTools, counterAt, durationOf, exportVideo, grayAt, historyProof, importFiles, layoutAudit, mainClips, meanAbsDiff, newProject, previewAt,
  scrubTo, selectClip, sheet, tool, valueToEnd,
} from './qa-video-kit';

audited();

const cuts = (page: Page) => page.getByRole('button', { name: 'Transition' });

test('«Apply to all cuts» is one exact undo step both ways and survives a reload, as does a transition\'s length (Q-15)', async ({ page }, info) => {
  test.setTimeout(900_000);
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4', 'photo.png', 'person.jpg']);
  await expect(mainClips(page)).toHaveCount(3);
  await closeTools(page);
  await expect(cuts(page)).toHaveCount(2);
  const h = historyProof(page, info);
  await h.start();
  // Picking a transition for a cut is a step, giving it to every cut is the next one.
  const pick = (k: number, name: string) => async () => {
    await cuts(page).nth(k).click();
    await page.getByRole('radio', { name, exact: true }).click();
    await page.getByRole('button', { name: 'Done' }).click();
  };
  const toAll = (k: number) => async () => {
    await cuts(page).nth(k).click();
    await page.getByRole('button', { name: 'Apply to all cuts' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
  };
  await h.act('Spin on the first cut', pick(0, 'Spin'));
  await h.act('Spin on every cut', toAll(0));
  await h.act('the second cut longest', async () => {
    await cuts(page).nth(1).click();
    await valueToEnd(page, 'Duration', 'End');
    await page.getByRole('button', { name: 'Done' }).click();
  });
  await h.act('none on the first cut', pick(0, 'None'));
  await h.act('no transition on any cut', toAll(0));
  await h.act('Flash on the second cut', pick(1, 'Flash'));
  await h.act('Flash on every cut again', toAll(1));
  await h.undoRedo();
  await h.reload();
});

test('transition ends: 2 s asked between short pieces is cut to what they hold, a piece can be all transition, and the file keeps every source frame where the preview shows it (Q-15)', async ({ page }, info) => {
  test.setTimeout(900_000);
  const main = mainClips(page);
  await newProject(page);
  await importFiles(page, 'Media', ['counter.mp4', 'counter.mp4', 'counter.mp4']); // A B C, 6 s each, frame N in binary
  await expect(main).toHaveCount(3);
  // B is cut to 1 s (source 0–1 s): a 2 s transition into it can be at most 0.5 s, half the shorter piece.
  await selectClip(page, main.nth(1));
  await scrubTo(page, 7 * 60, '0:07.0');
  await tool(page, 'Split').click();
  await expect(main).toHaveCount(4);
  await selectClip(page, main.nth(2));
  await tool(page, 'Delete').click();
  await expect(main).toHaveCount(3);
  await closeTools(page);
  await cuts(page).first().click();
  await page.getByRole('radio', { name: 'Flash', exact: true }).click();
  await valueToEnd(page, 'Duration', 'End'); // 2 s asked: the scale shows what the cut can hold
  await page.getByRole('button', { name: 'Apply to all cuts' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(sheet(page)).toHaveCount(0);
  // What the cuts hold now: each one at most half of the shorter piece next to it.
  await cuts(page).first().click();
  const first = Number(await page.getByRole('slider', { name: 'Duration', exact: true }).getAttribute('aria-valuenow'));
  await page.getByRole('button', { name: 'Done' }).click();
  await cuts(page).nth(1).click();
  const second = Number(await page.getByRole('slider', { name: 'Duration', exact: true }).getAttribute('aria-valuenow'));
  await page.getByRole('button', { name: 'Done' }).click();
  console.log(`transition ends (${info.project.name}): asked 2 s, cut A|B ${first} s, cut B|C ${second} s`);
  expect(first, 'A|B: half of the 1 s piece').toBeCloseTo(0.5, 2);
  expect(second, 'B|C: the rest of the 1 s piece, not used by A|B').toBeLessThanOrEqual(0.5 + 1e-6);
  // The timeline: A 0–6, B overlaps it by `first`, C overlaps B by `second`.
  const total = 6 + 1 + 6 - first - second;
  const video = await exportVideo(page, info);
  expect(Math.abs(durationOf(video) - total)).toBeLessThan(0.05);
  // Away from the cuts every frame is its own: A's start, the middle of C, C's last frame.
  const rows: string[] = [];
  for (const [k, want] of [[0, 0], [60, 60], [Math.round(total * 30) - 1, 179]] as const) {
    const got = counterAt(video, k);
    rows.push(`frame ${k}: ${got} (expected ${want})`);
    expect.soft(got, `video frame ${k}`).toBe(want);
  }
  // In the middle of the clamped A|B cut the preview shows what the file shows (mid-transition WYSIWYG).
  const mid = Math.round((6 - first / 2) * 30) / 30; // on a frame
  const shown = await previewAt(page, info, mid);
  const k = Math.round(mid * 30);
  const d = meanAbsDiff(grayAt(shown), grayAt(video, k));
  rows.push(`mid-cut ${mid.toFixed(3)} s: preview vs frame ${k} mean |diff| ${d.toFixed(2)}`);
  console.log(rows.join('\n'));
  expect(d, 'the preview mid-transition is the file\'s frame').toBeLessThan(6);
  // C taken away, and the cut B|C with it: A and B are left with the one transition between them.
  await selectClip(page, main.nth(2));
  await tool(page, 'Delete').click();
  await expect(main).toHaveCount(2);
  await closeTools(page);
  await expect(cuts(page)).toHaveCount(1);
  const after = await exportVideo(page, info);
  expect(Math.abs(durationOf(after) - (6 + 1 - first))).toBeLessThan(0.05);
});

test('the Transition and Hide faces sheets at 375 px: no sideways scroll, nothing past the edge, every control named (Q-14, Q-15)', async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await newProject(page);
  await importFiles(page, 'Media', ['person.jpg', 'photo.png']);
  await expect(mainClips(page)).toHaveCount(2);
  await closeTools(page);
  const problems: string[] = [], small: string[] = [];
  const audit = async (where: string) => {
    await page.waitForTimeout(400); // the sheet has settled
    const a = await layoutAudit(page);
    if (a.overflow > 0) problems.push(`${where}: the page scrolls sideways by ${a.overflow}px`);
    if (a.sheetScroll > 1) problems.push(`${where}: the sheet scrolls sideways by ${a.sheetScroll}px`);
    for (const o of a.offscreen) problems.push(`${where}: off screen ${o}`);
    for (const n of a.nameless) problems.push(`${where}: a control without a name ${n}`);
    small.push(`${where}: ${a.small.join('; ')}`);
  };
  await cuts(page).first().click();
  await page.getByRole('radio', { name: 'Whip pan', exact: true }).click(); // its duration shows too
  await audit('Transition');
  await page.getByRole('button', { name: 'Done' }).click();
  await selectClip(page, mainClips(page).first());
  await tool(page, 'Hide faces').click();
  await page.getByRole('button', { name: 'Add area' }).click(); // an area brings its four values
  await audit('Hide faces with an area');
  await page.getByRole('button', { name: 'Done' }).click();
  console.log(`375 px: ${problems.length} problems\n${problems.join('\n')}\nsmall targets (listed, as in «every tool at 375 px»):\n${small.join('\n')}`);
  expect(problems).toEqual([]);
});
