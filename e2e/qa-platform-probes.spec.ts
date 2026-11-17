// A file let go while its sound was being asked about is not a sound the browser refused (QA matrix Q-2, console).
// MediaPool disposes inputs as clips change and exports end; a probe of the sound track still running then failed with
// "Input has been disposed", and sound.ts logged it as «An audio track does not decode with WebCodecs / decodeAudioData»
// — 124 times on WebKit in the release candidate's full run, burying the warnings that do say why a file has no sound,
// and the dead track was marked refused. The steps are those of editor.spec «cuts reach the file frame for frame».
import { expect, test, type Page } from '@playwright/test';
import { audits, exportAs, importFiles, newProject, note, previewAt, selectClip, tool } from './qa-platform-kit';

audits();

const scrub = (page: Page, s: number) => page.locator('.tl-scroll').evaluate((el, x) => { el.scrollLeft = x; }, s * 60);

test('cuts, a deleted piece, the preview and photos: no sound let go is reported as a sound that does not decode (Q-2)', async ({ page }, info) => {
  test.setTimeout(300_000);
  const said: string[] = [];
  page.on('console', (m) => { if (/does not decode with|refused to decode this sound/.test(m.text())) said.push(m.text().slice(0, 200)); });
  await newProject(page);
  await importFiles(page, 'Media', ['counter.mp4']); // 6 s, with sound
  const main = page.locator('.tl-row.main .clip');
  await expect(main).toHaveCount(1);
  await scrub(page, 2);
  await selectClip(page, main.first());
  await tool(page, 'Split').click();
  await expect(main).toHaveCount(2);
  await scrub(page, 4);
  await selectClip(page, main.nth(1));
  await tool(page, 'Split').click();
  await expect(main).toHaveCount(3);
  await selectClip(page, main.nth(1));
  await tool(page, 'Delete').click();
  await expect(main).toHaveCount(2);
  const close = page.getByRole('button', { name: 'Close tools' });
  if (await close.isVisible()) await close.click();
  await exportAs(page, info, 'Video');
  for (const t of [0.35, 1.98, 2.02, 3.35]) {
    await previewAt(page, info, t);
    await exportAs(page, info, 'Photo');
  }
  note(info, 'said.txt', said.join('\n') || '(nothing)');
  expect(said, 'every sound here decodes: nothing may say it does not').toEqual([]);
});
