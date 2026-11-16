// Verifier E3 (docs/21 §5): rows of touch and gesture whose fix had no test that goes red without it — V-101 (a pinch
// redrew every film strip on each frame of the gesture), V-106 (a still finger on a clip plus a second one reordered the
// clips), V-114 (the points of the speed curve took only a 19 px dot), D-8 (a long press selected
// the words of buttons: only some of them are checked) and D-9 (two rows of tiles, the second cut by the sheet). Each is
// red on a build with its fix taken back, green on main. A finger on a phone is L5: the Mac shows the cause is gone.
import { expect, test, type Page } from '@playwright/test';
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

async function selectFirst(page: Page) {
  const clip = page.locator('.tl-row.main .clip').first();
  await expect(async () => {
    if (!(await clip.getAttribute('class'))?.includes(' sel')) await clip.click();
    await expect(clip).toHaveClass(/ sel/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

async function projectWith(page: Page, files: string[]) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(files.map(fx));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(files.length, { timeout: 60_000 });
}

test('a zoom gesture draws the film strips once it rests, not on each of its steps (audit V-101)', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const w = window as unknown as { __draws: number };
    w.__draws = 0;
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...a: unknown[]) {
      if (this.classList.contains('ck-tl-canvas')) w.__draws++;
      return (real as (...x: unknown[]) => RenderingContext | null).apply(this, a);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  const files = ['long_1.mp4', 'long_2.mp4', 'long_3.mp4', 'long_4.mp4'];
  await projectWith(page, files);
  const draws = () => page.evaluate(() => (window as unknown as { __draws: number }).__draws);
  // Every strip drawn with its pictures, then quiet.
  await expect.poll(draws, { timeout: 60_000 }).toBeGreaterThanOrEqual(files.length);
  let last = -1;
  await expect.poll(async () => { const n = await draws(); const still = n === last; last = n; return still; }, { intervals: [1500], timeout: 60_000 }).toBe(true);
  const steps = 20;
  const during = await page.evaluate(async (n) => {
    const w = window as unknown as { __draws: number };
    const el = document.querySelector('.tl-scroll')!;
    w.__draws = 0;
    for (let i = 0; i < n; i++) {
      el.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -5, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 16)); // a frame of a gesture
    }
    return w.__draws;
  }, steps);
  await page.waitForTimeout(1000);
  const after = await draws();
  console.log(`film strips drawn: ${during} during ${steps} steps, ${after} in all, ${files.length} clips`);
  // On the gesture's steps nothing is drawn (a step that waits past the rest time under load may draw once more);
  // once it rests, each strip is drawn again at its new width. Before the fix: each step drew every strip.
  expect(after, 'at most a few redraws of each strip for the whole gesture').toBeLessThanOrEqual(files.length * 3);
  expect(after, 'every strip is drawn again at its new width').toBeGreaterThanOrEqual(files.length);
});

test('a still finger on one clip and a second on another reorder nothing (audit V-106)', async ({ page }) => {
  await projectWith(page, ['landscape.mp4', 'portrait.mp4']);
  const order = () => page.locator('.tl-row.main .clip').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.clip));
  const before = await order();
  const dragged = await page.evaluate(async () => {
    const clips = [...document.querySelectorAll<HTMLElement>('.tl-row.main .clip')];
    const at = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const a = at(clips[0]), b = at(clips[1]);
    const ev = (type: string, id: number, p: { x: number; y: number }) => new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 11, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: p.x, clientY: p.y,
    });
    clips[0].dispatchEvent(ev('pointerdown', 11, a)); // a finger rests on the first clip
    clips[1].dispatchEvent(ev('pointerdown', 12, b)); // a second finger lands on the other: a pinch
    await new Promise((r) => setTimeout(r, 700)); // longer than a long press
    const n = document.querySelectorAll('.tl-row.main .clip[data-dragging]').length;
    window.dispatchEvent(ev('pointerup', 11, a));
    window.dispatchEvent(ev('pointerup', 12, b));
    return n;
  });
  await page.waitForTimeout(500);
  expect(dragged, 'no clip is picked up by a pinch').toBe(0);
  expect(await order(), 'the clips keep their order').toEqual(before);
});

test('a point of the speed curve is taken by a finger anywhere in its column, not only on its dot (audit V-114)', async ({ page }) => {
  await projectWith(page, ['landscape.mp4']);
  await selectFirst(page);
  await page.getByRole('button', { name: 'Speed', exact: true }).click();
  await page.locator('.sheet').getByRole('radio', { name: 'Curve', exact: true }).click();
  const point = page.getByRole('slider', { name: 'Speed at point 2' });
  await expect(point).toBeVisible();
  await page.getByRole('group', { name: 'Speed curve' }).scrollIntoViewIfNeeded();
  const before = Number(await point.getAttribute('aria-valuenow'));
  const dot = (await point.boundingBox())!;
  const svg = (await page.getByRole('group', { name: 'Speed curve' }).boundingBox())!;
  const x = dot.x + dot.width / 2, y = Math.min(svg.y + svg.height - 4, dot.y + dot.height / 2 + 30);
  expect(y - (dot.y + dot.height / 2), 'the finger is below the dot, off it').toBeGreaterThan(dot.height / 2 + 4);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 40, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await point.getAttribute('aria-valuenow')), { timeout: 5000 }).toBeGreaterThan(before);
});

test('a long press selects the words of no button, radio or switch of a sheet (D-8)', async ({ page }) => {
  await projectWith(page, ['landscape.mp4']);
  await selectFirst(page);
  for (const name of ['Filters', 'Speed']) {
    await page.locator('.toolbar').getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.sheet')).toBeVisible();
    const selectable = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('button, [role=radio], [role=switch]')]
      .filter((e) => e.getClientRects().length > 0)
      .filter((e) => { const s = getComputedStyle(e) as CSSStyleDeclaration & { webkitUserSelect?: string }; return (s.userSelect || s.webkitUserSelect) !== 'none'; })
      .map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} «${(e.getAttribute('aria-label') ?? e.textContent ?? '').slice(0, 24)}»`));
    expect(selectable, `${name}: controls whose words a long press would select`).toEqual([]);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('.sheet')).toHaveCount(0);
  }
});

test('the look sheets hold one row of tiles on a small phone (D-9)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await projectWith(page, ['landscape.mp4']);
  await selectFirst(page);
  for (const name of ['Filters', 'Adjust']) {
    await page.locator('.toolbar').getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.sheet .tile').first()).toBeVisible();
    const rows = await page.evaluate(() => [...document.querySelectorAll('.ck-strip-group')].map((g) => new Set([...g.querySelectorAll('.tile')].map((t) => Math.round(t.getBoundingClientRect().top))).size));
    expect(rows.length, name).toBeGreaterThan(0);
    expect(rows.every((n) => n === 1), `${name}: rows of tiles in each group ${rows.join(',')}`).toBe(true);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('.sheet')).toHaveCount(0);
  }
});
