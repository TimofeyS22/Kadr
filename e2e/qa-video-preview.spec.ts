// The preview's own resources (docs/11 §3.7, sweep lane C): what the editor takes from the GPU it gives back when it closes.
import { expect, test } from '@playwright/test';
import { audited, importFiles, mainClips, newProject } from './qa-video-kit';

audited();

test('opening and leaving a project 20 times keeps no preview GPU context behind (SW-D-4)', async ({ page }) => {
  test.setTimeout(420_000);
  // Every WebGL2 context of the preview's canvas, and how many are still alive: one a visit piled up to the browser's
  // limit, which then dropped the oldest ("too many active WebGL contexts"), found by lane D (SW-D-4). Home's own canvases
  // are lane D's (SW-D-3).
  await page.addInitScript(() => {
    const live = new Set<WebGL2RenderingContext>();
    (window as unknown as { __gl: () => number }).__gl = () => [...live].filter((g) => !g.isContextLost()).length;
    const get = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, id: string, o?: unknown) => RenderingContext | null;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, o?: unknown) {
      const ctx = get.call(this, id, o);
      if (id === 'webgl2' && ctx && this.classList.contains('preview-canvas')) live.add(ctx as WebGL2RenderingContext);
      return ctx;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await newProject(page);
  await importFiles(page, 'Media', ['photo.png']);
  await expect(mainClips(page)).toHaveCount(1);
  const name = await page.getByRole('textbox', { name: 'Project name' }).inputValue();
  const home = async () => {
    await page.getByRole('button', { name: 'Back to projects' }).click();
    await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
  };
  await home();
  const counts: number[] = [];
  for (let i = 0; i < 20; i++) {
    await page.getByRole('button', { name: `Open ${name}` }).click();
    await expect(mainClips(page)).toHaveCount(1);
    await expect(page.locator('.preview-canvas')).toBeVisible();
    await home();
    await page.waitForTimeout(100); // the context is let go once the canvas has left the page
    counts.push(await page.evaluate(() => (window as unknown as { __gl: () => number }).__gl()));
  }
  console.log(`preview WebGL contexts alive on Home after each visit (${test.info().project.name}): ${counts.join(' ')}`);
  // Not left to the garbage collector, which would hide a leak in one browser and not another: Kadr lets go on purpose.
  expect(counts, 'preview WebGL contexts alive on Home after each visit').toEqual(counts.map(() => 0));
});
