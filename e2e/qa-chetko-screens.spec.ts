// Chetko, stage Ч4 (docs/17): the screens of the product moving onto the design system. Each release adds what it
// promised here: the colours and the face first, then one screen at a time.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'ru');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.iosFormatCard.v1', '1'); // on an iPhone the format card comes before the first pick (D-10)
  });
  await page.setViewportSize({ width: 375, height: 812 });
});

async function editorWithVideo(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.toolbar .tool', { hasText: /^Медиа$/ }).click();
  await (await chooser).setFiles([fx('landscape.mp4')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
}

test('UI-1: «Назад» stays apart from the scrolled tools, and a tap on it is a tap on «Назад» only', async ({ page }) => {
  await editorWithVideo(page);
  const back = page.locator('.toolbar .tool-back');
  await expect(back).toBeVisible();
  // Since Ч4 release 3 «Назад» stands at the ribbon's edge (Ribbon), outside the strip that scrolls: no tool can slide
  // under it. Release 1 kept it opaque over the tools; the check is now what the defect broke — where a tap lands.
  await page.locator('.toolbar .ck-ribbon-tools').evaluate((el) => { el.scrollLeft = 40; });
  const seen = await back.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const strip = document.querySelector('.toolbar .ck-ribbon-tools')!.getBoundingClientRect();
    const hits = [0.2, 0.5, 0.8].map((f) => { const hit = document.elementFromPoint(r.left + r.width * f, r.top + r.height / 2); return !!hit && el.contains(hit); });
    return { gap: strip.left - r.right, hits };
  });
  expect(seen.gap, 'the scrolled tools are cut off to the right of «Назад», so none shows through it').toBeGreaterThanOrEqual(-1);
  expect(seen.hits, 'a tap anywhere across «Назад» lands on «Назад»').toEqual([true, true, true]);
});

test('the screens take the colours and the face of the system: the main action is white, nothing is the old amber', async ({ page }) => {
  await page.goto('./');
  const main = page.getByRole('button', { name: 'Новый проект' });
  await expect(main).toBeVisible();
  const look = await page.evaluate(() => {
    const px = (colour: string) => {
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.fillStyle = colour; ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data.subarray(0, 3));
    };
    const btn = document.querySelector('.ck-home-dock .ck-primary')!;
    const amber = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
      const s = getComputedStyle(el);
      return [s.color, s.backgroundColor, s.borderTopColor].some((c) => { const [r, g, b] = px(c); return r > 240 && g > 180 && g < 210 && b < 90; });
    }).map((el) => el.className).slice(0, 5);
    return { button: px(getComputedStyle(btn).backgroundColor), font: getComputedStyle(document.body).fontFamily, amber };
  });
  expect(Math.min(...look.button), 'the main action is white').toBeGreaterThan(235);
  expect(look.font).toMatch(/^Geologica/);
  expect(look.amber, 'the amber of v1.7.1 (#ffc53d) is gone').toEqual([]);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('600 16px Geologica', 'Новый проект'))).toBe(true);
});

// ---- release 2: the home screen on the components of the system ----
async function withSample(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Открыть пример' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'К проектам' }).click();
  await expect(page.locator('.project-open')).toHaveCount(1);
}

test('home: the first step is one white button in reach of the thumb, and the frame format is two taps away as before', async ({ page }) => {
  await page.goto('./');
  const main = page.getByRole('button', { name: 'Новый проект' });
  await expect(main).toBeVisible();
  const box = (await main.boundingBox())!;
  const vh = page.viewportSize()!.height;
  expect(box.y + box.height / 2, 'in the lower 40% of the screen (Ж3)').toBeGreaterThan(vh * 0.6);
  expect(box.height).toBeGreaterThanOrEqual(56);
  // The only solid white button on the screen.
  const solid = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('button')].filter((b) => {
    const r = b.getBoundingClientRect();
    if (!r.width) return false;
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = getComputedStyle(b).backgroundColor; ctx.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = ctx.getImageData(0, 0, 1, 1).data;
    return alpha > 200 && Math.min(red, green, blue) > 235;
  }).map((b) => b.textContent?.trim()));
  expect(solid).toEqual(['Новый проект']);
  // Two taps to a project in a format, as in v1.7.1.
  await main.click();
  const sheet = page.getByRole('dialog', { name: 'Формат кадра' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.aspect-card')).toHaveCount(5);
  await sheet.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  // Not a second word for the move to a first visit: it never saw the buttons at the top.
  await page.goto('./');
  await expect(page.getByRole('note').filter({ hasText: 'теперь внизу' })).toHaveCount(0);
});

test('home: a project is renamed in the app\'s own sheet and deleted after one honest question; the move is said once to who knew the old place', async ({ page }) => {
  await withSample(page);
  // Someone who used v1.7.1: projects, and the move not yet announced.
  await page.evaluate(() => localStorage.removeItem('kadr.homeMoved.v1'));
  await page.reload();
  const moved = page.getByRole('note').filter({ hasText: 'теперь внизу' });
  await expect(moved).toBeVisible();
  await moved.getByRole('button', { name: 'Понятно' }).click();
  await expect(moved).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.project-open')).toHaveCount(1);
  await expect(moved, 'said once').toHaveCount(0);

  const open = page.locator('.project-open');
  await expect(open).toHaveAccessibleDescription(/сохранено/);
  const name = (await open.getAttribute('aria-label'))!.replace(/^Открыть /, ''); // «…» included
  await page.getByRole('button', { name: `Переименовать ${name}` }).click();
  const sheet = page.getByRole('dialog', { name: 'Переименовать' });
  const field = sheet.getByRole('textbox', { name: 'Название проекта' });
  // Renaming is typing: the focus is in the field and the old name is selected, ready to be written over.
  await expect(field).toBeFocused();
  expect(await field.evaluate((el: HTMLInputElement) => el.value.length > 0 && el.selectionStart === 0 && el.selectionEnd === el.value.length)).toBe(true);
  await expect(field).toHaveAccessibleDescription(/из 80 знаков/);
  await field.fill('   ');
  await expect(sheet.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await field.fill('Алтай');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Открыть «Алтай»' })).toBeVisible();

  await page.getByRole('button', { name: 'Удалить «Алтай»' }).click();
  const ask = page.getByRole('dialog', { name: 'Удалить «Алтай»?' });
  await expect(ask).toBeVisible();
  await expect(ask).toHaveAccessibleDescription(/Вернуть их будет нельзя/);
  await expect(ask.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Открыть «Алтай»' })).toBeVisible();
  await page.getByRole('button', { name: 'Удалить «Алтай»' }).click();
  // While the files are erased the question waits: no second «Удалить», no «Отмена» that would not cancel anything.
  const during = await ask.evaluate(async (d) => {
    [...d.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Удалить')!.click();
    await new Promise<void>((r) => queueMicrotask(r)); // React applies a tap's state in a microtask; the erasing takes longer
    return { disabled: [...d.querySelectorAll('button')].map((b) => b.disabled), said: d.querySelector('[role="status"]')?.textContent };
  });
  expect(during).toEqual({ disabled: [true, true], said: 'Удаляю…' });
  await expect(page.locator('.project-open')).toHaveCount(0);
  await expect(page.getByText('«Алтай» удалён')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName), 'the focus lands on a button, not on the page').toBe('BUTTON');
  await expect(page.getByRole('heading', { name: 'Проектов пока нет' })).toBeVisible();
});

test('home: the dock is read right after the reel, the page ends above it, and on a low screen it stays in its place', async ({ page }) => {
  await withSample(page);
  // Reading order: the reel, then the way to start, then the projects (it used to be read last, after the footer).
  const order = await page.evaluate(() => [...document.querySelectorAll('.ck-home-reel, .ck-home-dock, .project-card, .home-foot')].map((e) => e.className.split(' ')[0]));
  expect(order).toEqual(['ck-home-card', 'ck-home-dock', 'ck-project', 'ck-home-foot']);
  await expect(page.getByRole('region', { name: 'Начать проект' })).toBeVisible();
  // At the bottom of the page the footer is above the dock, not under it.
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  const foot = (await page.locator('.home-foot').boundingBox())!;
  const dock = (await page.locator('.ck-home-dock').boundingBox())!;
  expect(foot.y + foot.height).toBeLessThanOrEqual(dock.y + 1);
  // A phone on its side: the dock is part of the page, where the buttons always were, and nothing points down to it.
  await page.evaluate(() => localStorage.removeItem('kadr.homeMoved.v1'));
  await page.setViewportSize({ width: 812, height: 375 });
  await page.reload();
  await expect(page.locator('.project-open')).toHaveCount(1);
  expect(await page.locator('.ck-home-dock').evaluate((el) => getComputedStyle(el).position)).toBe('static');
  await expect(page.getByRole('note').filter({ hasText: 'теперь внизу' })).toBeHidden();
});

test('home: nothing scrolls sideways at 320 px, every control is 44 px and named, the version is in the footer', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await withSample(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.ck-home button, .ck-home [role="radio"]')].filter((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && !b.closest('[inert], .ck-sheet-layer[data-open="false"]') && (r.width < 43.5 || r.height < 43.5 || !(b.getAttribute('aria-label') || b.textContent?.trim()));
  }).map((b) => `${(b.getAttribute('aria-label') || b.textContent || b.className).trim().slice(0, 30)} ${Math.round(b.getBoundingClientRect().width)}×${Math.round(b.getBoundingClientRect().height)}`));
  expect(small).toEqual([]);
  await expect(page.locator('.home-foot')).toContainText(/Kadr v\d/);
});

// ---- release 3: the frame of the editor on the components of the system ----
async function sampleEditor(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Открыть пример' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
}
// The frame of the editor only: the timeline (its transition button) moves in release 4.
const solidWhite = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.topbar button, .transport button, .toolbar button')].filter((b) => {
  const r = b.getBoundingClientRect();
  if (!r.width || b.closest('[inert]')) return false;
  const ctx = document.createElement('canvas').getContext('2d')!;
  const paint = (el: Element) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = getComputedStyle(el).backgroundColor; ctx.fillRect(0, 0, 1, 1); return ctx.getImageData(0, 0, 1, 1).data; };
  return [b, ...b.children].some((el) => { const [red, green, blue, alpha] = paint(el); return alpha > 200 && Math.min(red, green, blue) > 235; });
}).map((b) => b.getAttribute('aria-label') || b.textContent?.trim()));

test('editor: the header names the project and says it is saved; Export is the white button; the frame keeps its room', async ({ page }) => {
  // The room of the frame at rest: for the one visit the note about the move is up, its row takes 52 px of it.
  await page.addInitScript(() => localStorage.setItem('kadr.undoMoved.v1', '1'));
  await sampleEditor(page);
  const header = page.locator('.topbar');
  const name = header.getByRole('textbox', { name: 'Название проекта' });
  await expect(name).toHaveAccessibleDescription('сохранено');
  expect(await solidWhite(page), 'white: Export and play, nothing else').toEqual(['Экспорт', 'Воспроизвести']);
  // Principle 1: no less room for the frame than in 1.7.1 (511 px at 375×812, audit Ч0).
  expect((await page.locator('.preview').boundingBox())!.height).toBeGreaterThanOrEqual(511);
  // A write that does not get through is said in the header, and so is the one that does.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as unknown as { __put: typeof put }).__put = put;
    IDBObjectStore.prototype.put = function () { throw new DOMException('The disk is full', 'QuotaExceededError'); };
  });
  // «сохраняю…» never flickers: when it shows at all, it stays long enough to be read.
  await page.locator('.ck-editor-saved').evaluate((el) => {
    const w = window as unknown as { __said: [string, number][] };
    w.__said = [[el.textContent ?? '', performance.now()]];
    new MutationObserver(() => w.__said.push([el.textContent ?? '', performance.now()])).observe(el, { childList: true, subtree: true, characterData: true });
  });
  await name.fill('Алтай');
  await expect(name).toHaveAccessibleDescription('не сохранено', { timeout: 10_000 });
  const said = await page.evaluate(() => (window as unknown as { __said: [string, number][] }).__said);
  const brief = said.flatMap(([text, at], i) => (text === 'сохраняю…' && i + 1 < said.length && said[i + 1][1] - at < 550 ? [Math.round(said[i + 1][1] - at)] : []));
  expect(brief, '«сохраняю…» shown for less than 0.55 s').toEqual([]);
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as unknown as { __put: typeof IDBObjectStore.prototype.put }).__put; });
  await expect(name).toHaveAccessibleDescription('сохранено', { timeout: 15_000 });
});

test('editor: Undo and Redo are under the frame by the thumb, and the move is said once, at the old place', async ({ page }) => {
  await sampleEditor(page);
  const note = page.getByRole('note').filter({ hasText: 'теперь под кадром' });
  await expect(note, 'kadr.tips is set: this person has worked in the editor before').toBeVisible();
  // At the old place, in the header: it covers nothing of the frame.
  const box = (await note.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual((await page.locator('.preview').boundingBox())!.y + 1);
  const undo = page.getByRole('button', { name: 'Отменить', exact: true });
  const frame = (await page.locator('.preview').boundingBox())!;
  const at = (await undo.boundingBox())!;
  expect(at.y, 'under the frame').toBeGreaterThanOrEqual(frame.y + frame.height - 1);
  expect(at.y + at.height / 2, 'in the lower half of the screen').toBeGreaterThan(page.viewportSize()!.height / 2);
  expect(at.width).toBeGreaterThanOrEqual(44);
  await expect(page.locator('.topbar').getByRole('button', { name: 'Отменить' })).toHaveCount(0);
  // Found it: the note goes and stays gone.
  await page.getByRole('textbox', { name: 'Название проекта' }).fill('Алтай');
  await undo.click();
  await expect(page.getByRole('textbox', { name: 'Название проекта' })).not.toHaveValue('Алтай');
  await expect(note).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  await expect(note).toHaveCount(0);
});

test('editor: the note about the move is for one visit — leaving the editor counts as having seen it', async ({ page }) => {
  await sampleEditor(page);
  const note = page.getByRole('note').filter({ hasText: 'теперь под кадром' });
  await expect(note).toBeVisible();
  await page.getByRole('button', { name: 'К проектам' }).click();
  await page.locator('.project-open').first().click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  await expect(note).toHaveCount(0);
});

test('editor: a first visit is not told about a move it never saw', async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('seen')) { localStorage.removeItem('kadr.tips'); sessionStorage.setItem('seen', '1'); } });
  await sampleEditor(page);
  await expect(page.getByRole('note').filter({ hasText: 'теперь под кадром' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('kadr.undoMoved.v1'))).toBe('1');
});

test('editor: the ribbon keeps the order and names of 1.7.1, «Все» shows every tool with its name, a tool from there runs in the same tap', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.toolbar .tool').first()).toBeVisible();
  const names = () => page.locator('.toolbar .tool').evaluateAll((els) => els.map((e) => e.querySelector('span')?.textContent));
  const project = ['Рилс в 1 тап', 'Медиа', 'Субтитры', 'Текст', 'Музыка', 'Наложение', 'Стикеры', 'Эффекты', 'Звук', 'Камера', 'Запись', 'Холст'];
  expect(await names()).toEqual(project);
  await page.getByRole('button', { name: 'Все инструменты' }).click();
  const all = page.getByRole('dialog', { name: 'Все инструменты' });
  await expect(all).toBeVisible();
  expect(await all.locator('.ck-tool span').allTextContents()).toEqual(project);
  // «Медиа» from the sheet opens the file picker: the tap that chose it still counts as the person's own.
  const chooser = page.waitForEvent('filechooser');
  await all.getByRole('button', { name: 'Медиа', exact: true }).click();
  await (await chooser).setFiles([fx('landscape.mp4')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await expect(all).toBeHidden();
  // The clip's panel: «Назад» at the edge, the switches say "pressed", a tool that opens a sheet does not.
  await page.locator('.tl-row.main .clip').first().click();
  await expect(page.locator('.toolbar .tool-back')).toBeVisible();
  // The name starts with the word on the button (WCAG 2.5.3): «Назад» said aloud presses it.
  await expect(page.locator('.toolbar .tool-back')).toHaveAccessibleName(/^Назад/);
  const mirror = page.locator('.toolbar').getByRole('button', { name: 'Отразить', exact: true });
  await expect(mirror).toHaveAttribute('aria-pressed', 'false');
  await mirror.click();
  await expect(mirror).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.toolbar').getByRole('button', { name: 'Маска', exact: true })).not.toHaveAttribute('aria-pressed');
});

test('editor: at 320 px nothing scrolls sideways, the name shows 12 letters, everything in the frame is 44 px and named', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await sampleEditor(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const fits = await page.locator('.ck-editor-name').evaluate((el: HTMLInputElement) => {
    const s = getComputedStyle(el);
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    return { size: s.fontSize, room: el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight), need: ctx.measureText('Поход на Алт').width };
  });
  expect(fits.size).toBe('16px');
  expect(fits.room).toBeGreaterThanOrEqual(fits.need);
  const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.topbar button, .topbar input, .transport button, .toolbar button')].filter((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && (r.width < 43.5 || r.height < 43.5 || !(b.getAttribute('aria-label') || b.textContent?.trim()));
  }).map((b) => `${(b.getAttribute('aria-label') || b.textContent || b.className).trim().slice(0, 30)} ${Math.round(b.getBoundingClientRect().width)}×${Math.round(b.getBoundingClientRect().height)}`));
  expect(small).toEqual([]);
  // The sheet of all tools keeps three columns at 320 px, so the whole set is in sight with its names (Ж4).
  await page.getByRole('button', { name: 'Все инструменты' }).click();
  const grid = page.locator('.ck-editor-all .ck-toolgrid').first();
  await expect(grid).toBeVisible();
  expect(await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(3);
});

// ---- release 4: the timeline on the system ----
test('timeline: a held piece lies between two white marks, 8 px to the eye and 44 px to a finger; every piece and the transition are 44 px (UI-9)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kadr.undoMoved.v1', '1'));
  await sampleEditor(page);
  await page.locator('.tl-row.main .clip').first().click();
  for (const name of ['Обрезать начало', 'Обрезать конец']) {
    const handle = page.getByRole('slider', { name });
    const box = (await handle.boundingBox())!;
    expect(box.width, name).toBeGreaterThanOrEqual(44);
    expect(box.height, name).toBeGreaterThanOrEqual(44);
    const mark = await handle.evaluate((el) => { const s = getComputedStyle(el, '::after'); return { w: s.width, bg: s.backgroundColor }; });
    expect(mark.w).toBe('8px');
    const white = await page.evaluate((c) => { const ctx = document.createElement('canvas').getContext('2d')!; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return Math.min(...ctx.getImageData(0, 0, 1, 1).data.subarray(0, 3)); }, mark.bg);
    expect(white, 'the mark is white').toBeGreaterThan(235);
  }
  // The edge of a held video is drawn over its frames, so it shows.
  expect(await page.locator('.tl-row.main .clip.sel .ck-tl-fill').evaluate((el) => getComputedStyle(el, '::after').boxShadow)).toMatch(/inset/);
  // A handle reaches into the piece no more than 12 px: the middle of a short held piece stays free to be carried (Ж5).
  const piece = (await page.locator('.tl-row.main .clip.sel').boundingBox())!;
  const inner = (await page.getByRole('slider', { name: 'Обрезать начало' }).boundingBox())!;
  expect(inner.x + inner.width - piece.x).toBeLessThanOrEqual(12.5);
  // The rows above and below the main one: 44 px to a finger (34 in 1.7.1).
  for (const clip of await page.locator('.tl-row.overlay .clip, .tl-row.audio .clip').all()) expect((await clip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.locator('.tl-scroll').click({ position: { x: 4, y: 4 } }); // nothing held: the transitions come back
  const join = page.getByRole('button', { name: /^Переход 1–2/ });
  await expect(join).toBeVisible();
  const j = (await join.boundingBox())!;
  expect(Math.min(j.width, j.height)).toBeGreaterThanOrEqual(44);
  // Its reach stays in the main row: a tap on the text above it selects the text (Ж5).
  expect(j.y).toBeGreaterThanOrEqual((await page.locator('.tl-row.main').boundingBox())!.y - 0.5);
  // The number under the playhead is not covered by its head.
  const zero = (await page.locator('.timeline .ck-ruler-num').first().boundingBox())!;
  const head = (await page.locator('.timeline .playhead').boundingBox())!;
  if (Math.abs(zero.x - (head.x + head.width / 2)) < 2) expect(zero.x + 4).toBeGreaterThanOrEqual(head.x + head.width / 2 + 4);
});

test('timeline: among several, a picked piece says it is picked and shows a check', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kadr.undoMoved.v1', '1'));
  await sampleEditor(page);
  await page.locator('.tl-row.main .clip').first().click();
  await page.locator('.toolbar').getByRole('button', { name: 'Все инструменты' }).click();
  await page.getByRole('dialog', { name: 'Все инструменты' }).getByRole('button', { name: 'Выбрать несколько' }).click();
  const picked = page.locator('.tl-row.main .clip.picked');
  await expect(picked).toHaveCount(1);
  await expect(picked).toHaveAttribute('aria-pressed', 'true');
  await expect(picked.locator('.ck-tl-picked')).toBeVisible();
  await expect(page.locator('.tl-row.main .clip:not(.picked)').first()).toHaveAttribute('aria-pressed', 'false');
});

test('timeline: the ruler reads (12 px, numbers 64 px apart), the ground is that of the frame around it, the frame keeps its room', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kadr.undoMoved.v1', '1'));
  await sampleEditor(page);
  const nums = await page.locator('.timeline .ck-ruler-num').evaluateAll((els) => els.map((e) => ({ x: e.getBoundingClientRect().left + e.getBoundingClientRect().width / 2, size: getComputedStyle(e).fontSize })));
  expect(nums.length).toBeGreaterThan(1);
  expect(new Set(nums.map((n) => n.size))).toEqual(new Set(['12px']));
  for (let i = 1; i < nums.length; i++) expect(nums[i].x - nums[i - 1].x).toBeGreaterThanOrEqual(63.5);
  const ground = await page.evaluate(() => ['.timeline', '.transport', '.toolbar'].map((s) => getComputedStyle(document.querySelector(s)!).backgroundColor));
  expect(new Set(ground).size, 'one ground: no seam between the timeline and the frame of the editor').toBe(1);
  await expect(page.locator('.timeline .playhead')).toHaveCount(1);
  expect((await page.locator('.preview').boundingBox())!.height).toBeGreaterThanOrEqual(511);
});

test('timeline: in an empty project the call to add a video is whole on the screen at 320 and 375 px', async ({ page }) => {
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto('./');
    await page.getByRole('button', { name: 'Новый проект' }).click();
    await page.locator('.aspect-card', { hasText: '9:16' }).click();
    const add = page.getByRole('button', { name: 'Добавить видео или фото' });
    await expect(add).toBeVisible();
    const b = (await add.boundingBox())!;
    expect(b.x, `${width}: inside on the left`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, `${width}: inside on the right`).toBeLessThanOrEqual(width);
    expect(b.height).toBeGreaterThanOrEqual(44);
    await expect(add, 'the words on it are its name (WCAG 2.5.3)').toHaveAccessibleName('Добавить видео или фото');
  }
});

// ---- release 5: the tool sheets on the system ----
const tool = (page: Page, name: string) => page.locator('.toolbar .tool', { hasText: new RegExp(`^${name}$`) });
const panel = (page: Page) => page.locator('.sheet');
async function openTool(page: Page, name: string) {
  await tool(page, name).click();
  await expect(panel(page)).toBeVisible();
  await page.waitForTimeout(350); // the sheet rises for --dur-sheet-in
}
const whiteFilled = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.sheet button')].filter((b) => {
  if (!b.getBoundingClientRect().width) return false;
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.fillStyle = getComputedStyle(b).backgroundColor; ctx.fillRect(0, 0, 1, 1);
  const [r, g, bl, a] = ctx.getImageData(0, 0, 1, 1).data;
  return a > 200 && Math.min(r, g, bl) > 235;
}).map((b) => b.textContent?.trim()));

test('sheets: «Готово» is a word; a short sheet gives the frame what it leaves, and the frame does not jump while it is open', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kadr.undoMoved.v1', '1'));
  await sampleEditor(page);
  await page.locator('.tl-row.main .clip').first().click();
  const frame = () => page.locator('.preview').evaluate((e) => e.getBoundingClientRect().height);
  const shut = await frame();
  await openTool(page, 'Маска');
  const done = panel(page).getByRole('button', { name: 'Готово' });
  await expect(done).toHaveText('Готово'); // words, not a check (audit P3-2)
  expect((await done.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const sheetH = await panel(page).evaluate((e) => e.getBoundingClientRect().height);
  expect(sheetH, 'the mask sheet is as tall as what it holds').toBeLessThan(0.46 * 812 - 40);
  // The frame sits right above the sheet: the editor leaves the sheet exactly its height.
  const gap = await page.evaluate(() => document.querySelector('.sheet')!.getBoundingClientRect().top - document.querySelector('.transport')!.getBoundingClientRect().bottom);
  expect(Math.abs(gap), 'nothing is left empty between the row under the frame and the sheet').toBeLessThanOrEqual(1);
  const withMask = await frame();
  expect(withMask, 'a short sheet leaves the frame more room than the 46% sheet of 1.7.1').toBeGreaterThan(shut - 0.46 * 812 + 60);
  // Speed: «Кривая» makes the sheet taller; back to «Обычная», the sheet keeps its height, so the frame does not jump.
  await done.click();
  await openTool(page, 'Скорость');
  const h0 = await panel(page).evaluate((e) => e.getBoundingClientRect().height);
  await panel(page).getByRole('radio', { name: 'Кривая' }).click();
  await expect.poll(() => panel(page).evaluate((e) => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(h0);
  const h1 = await panel(page).evaluate((e) => e.getBoundingClientRect().height);
  const f1 = await frame();
  await panel(page).getByRole('radio', { name: 'Обычная' }).click();
  await page.waitForTimeout(200);
  expect(await panel(page).evaluate((e) => e.getBoundingClientRect().height)).toBeCloseTo(h1, 0);
  expect(await frame()).toBeCloseTo(f1, 0);
  // Inside a sheet the only white button is its main action, and «Применить ко всем» is not one.
  await panel(page).getByRole('button', { name: 'Готово' }).click();
  await openTool(page, 'Фильтры');
  expect(await whiteFilled(page)).toEqual([]);
});

test('sheets: the focus goes into the sheet and back to the tool that opened it; Escape closes', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebKit skips buttons on Tab unless the system setting says otherwise');
  await page.addInitScript(() => localStorage.setItem('kadr.undoMoved.v1', '1'));
  await sampleEditor(page);
  await page.locator('.tl-row.main .clip').first().click();
  await tool(page, 'Громкость').focus();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('.sheet h2')).toBeFocused(); // its name is read first
  await page.keyboard.press('Tab');
  await expect(panel(page).getByRole('button', { name: 'Готово' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toHaveCount(0);
  await expect(tool(page, 'Громкость')).toBeFocused();
  // Escape backs out of the sheet and of the piece at once (as in 1.7.1): the focus stays on the ribbon, not lost.
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator('.toolbar .tool:focus')).toHaveCount(1);
  // Not modal: the row under the frame works while a sheet is open.
  await page.locator('.tl-row.main .clip').first().click();
  await openTool(page, 'Громкость');
  await expect(page.locator('.transport')).not.toHaveAttribute('inert');
  await page.getByRole('button', { name: 'Воспроизвести' }).click();
  await expect(page.getByRole('button', { name: 'Пауза' })).toBeVisible();
});

test('sheets: choices are 44 px segments, switches show their state by the knob, colours are apart and the chosen one is ringed', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kadr.undoMoved.v1', '1'));
  await sampleEditor(page);
  await page.locator('.tl-row.main .clip').first().click();
  await openTool(page, 'Громкость');
  const sw = panel(page).getByRole('switch', { name: 'Без звука' });
  const knob = () => sw.evaluate((el) => { const k = el.nextElementSibling!; return getComputedStyle(k, '::before').translate; });
  const off = await knob();
  await sw.check();
  await expect(sw).toBeChecked();
  expect(await knob(), 'on is said by where the knob is, not by colour alone').not.toBe(off);
  await sw.uncheck();
  // «0,0 с», not «0.0s» (audit P3-8).
  await expect(panel(page).locator('.ck-slider', { hasText: 'Нарастание' })).toContainText('0,0 с');
  await panel(page).getByRole('button', { name: 'Готово' }).click();
  await page.locator('.toolbar .tool-back').click();
  await openTool(page, 'Холст');
  for (const chip of await panel(page).locator('.ck-chip').all()) expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(panel(page).getByRole('radio', { name: '30 к/с' })).toBeVisible();
  const colours = panel(page).getByRole('group', { name: 'Цвет фона' }).locator('.ck-swatch');
  await colours.nth(2).click();
  await expect(colours.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page).locator('.ck-swatch[aria-pressed="true"]')).toHaveCount(1);
  const ring = await colours.nth(2).locator('i').evaluate((i) => getComputedStyle(i).boxShadow);
  expect(ring, 'the chosen colour has a ring').toMatch(/0px 0px 0px 4px/);
  const boxes = await colours.evaluateAll((els) => els.map((e) => e.querySelector('i')!.getBoundingClientRect()).map((r) => [r.left, r.right]));
  for (let i = 1; i < boxes.length; i++) expect(boxes[i][0] - boxes[i - 1][1], 'colours do not touch').toBeGreaterThanOrEqual(8);
});

test('sheets: a value has the whole width of the sheet and 44 px to a finger; the keyframe diamond is 44 px; sections are named at 12 px or more', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kadr.undoMoved.v1', '1'));
  await sampleEditor(page);
  await page.locator('.tl-row.main .clip').first().click();
  await openTool(page, 'Трансформация');
  const body = (await panel(page).locator('.sheet-body').boundingBox())!;
  const x = panel(page).getByRole('slider', { name: 'Положение X' });
  const track = (await x.boundingBox())!;
  expect(track.width, 'the track takes the width of the sheet (UI-3: 131 of 343 px)').toBeGreaterThanOrEqual(body.width - 32 - 44 - 8 - 1);
  expect(track.height).toBeGreaterThanOrEqual(44);
  const kfBox = await panel(page).getByRole('button', { name: 'Добавить ключевой кадр: Положение X' }).boundingBox();
  expect(kfBox!.width).toBeGreaterThanOrEqual(44);
  expect(kfBox!.height).toBeGreaterThanOrEqual(44);
  const sizes = await panel(page).locator('h3').evaluateAll((hs) => hs.map((h) => parseFloat(getComputedStyle(h).fontSize)));
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  // The sheet is named as the ribbon names its tool (Ж4), at the heading size, and nothing of the name is cut.
  await expect(page.locator('.sheet h2')).toHaveText('Трансформация');
  expect(await page.locator('.sheet h2').evaluate((h) => parseFloat(getComputedStyle(h).fontSize))).toBe(20);
  // The playhead of the sheet tells the time as the row under the frame does.
  await expect(panel(page).locator('.ck-scrub-time')).toHaveText(/^\d+:\d\d\.\d$/);
});

test('sheets: a look is chosen on tiles with the name under the picture, ringed in white; categories are tabs; Before / after holds in the header, «Ко всем» is a word at the end', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kadr.undoMoved.v1', '1'));
  await sampleEditor(page);
  await page.locator('.tl-row.main .clip').first().click();
  await openTool(page, 'Фильтры');
  const chosen = panel(page).locator('.tile[aria-checked="true"]');
  await expect(chosen).toHaveCount(1);
  // Ringed in white with a gap, not held between two marks (the owner: the marks round a tile looked like sticks).
  await expect(panel(page).locator('.ck-held')).toHaveCount(0);
  expect(await chosen.locator('canvas').evaluate((c) => { const s = getComputedStyle(c); return `${s.outlineWidth} ${s.outlineOffset}`; })).toBe('2px 2px');
  const [pic, name] = await chosen.evaluate((t) => [t.querySelector('canvas')!.getBoundingClientRect().bottom, t.querySelector('.ck-ptile-name')!.getBoundingClientRect().top]);
  expect(name, 'the name is under the picture, not over it').toBeGreaterThanOrEqual(pic);
  for (const cat of await panel(page).locator('.pick-cat').all()) expect((await cat.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(panel(page).locator('.pick-cat[aria-current="true"]')).toHaveCount(1);
  const compare = page.locator('.sheet-head').getByRole('button', { name: 'Удерживайте, чтобы увидеть кусок без обработки' });
  const cb = (await compare.boundingBox())!;
  expect(cb.width).toBeGreaterThanOrEqual(44);
  expect(cb.height).toBeGreaterThanOrEqual(44);
  // «Применить ко всем» is the last thing of the sheet, a word without a box, on one line.
  const apply = panel(page).getByRole('button', { name: 'Применить ко всем кускам (2)' });
  const last = await panel(page).locator('.sheet-body').evaluate((b) => {
    const kids = [...b.children].filter((c) => (c as HTMLElement).offsetHeight > 0).map((c) => c.getBoundingClientRect().bottom);
    return Math.max(...kids);
  });
  expect((await apply.boundingBox())!.y + (await apply.boundingBox())!.height).toBeCloseTo(last, 0);
  expect(await apply.evaluate((b) => getComputedStyle(b).boxShadow)).toBe('none');
  expect((await apply.boundingBox())!.height).toBeLessThan(52);
  // At 320 px nothing scrolls sideways and the words stay whole.
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(await apply.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

test('sheets: fonts show themselves in their own letters, text styles are drawn on the person\'s frame, no option is a grey outlined box (the owner, 2026-11-11)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kadr.undoMoved.v1', '1'));
  await sampleEditor(page);
  await page.locator('.tl-row .clip-text').first().click();
  await openTool(page, 'Текст');
  // Fonts: a strip of tiles, each in its own face (it had collapsed to nothing under «Шрифт»).
  const fonts = panel(page).getByRole('radiogroup', { name: 'Шрифт' });
  expect((await fonts.boundingBox())!.height).toBeGreaterThan(100);
  const faces = await fonts.locator('.ck-font-letters').evaluateAll((els) => els.slice(0, 6).map((e) => getComputedStyle(e).fontFamily));
  expect(new Set(faces).size, 'each tile is drawn in its own font').toBe(faces.length);
  // The chosen font is ringed in white, not held between two marks: round letters with no picture they read as sticks.
  await expect(fonts.locator('.ck-held')).toHaveCount(0);
  expect(await fonts.locator('[aria-checked="true"] .ck-ptile-art').evaluate((a) => getComputedStyle(a).boxShadow)).toMatch(/0px 0px 0px 2px inset|inset 0px 0px 0px 2px/);
  await expect(panel(page).getByRole('button', { name: 'Добавить шрифт' })).toBeVisible();
  // The weight: one even row, no word cut.
  const cut = await panel(page).getByRole('radiogroup', { name: 'Начертание' }).locator('.ck-chip').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  expect(cut).toBe(0);
  // Styles: drawn on the sample's orange sky, not on the grey stand-in (#9fb0c2 at the top).
  await expect.poll(() => panel(page).locator('.tile canvas').first().evaluate((c: HTMLCanvasElement) => {
    const [r, g, b] = c.getContext('2d')!.getImageData(2, 2, 1, 1).data;
    return Math.abs(r - g) + Math.abs(g - b);
  }), { timeout: 30_000 }).toBeGreaterThan(40); // the frame is decoded first: WebKit under load needs longer
  // No grey line around an option that is not chosen.
  const lined = await panel(page).locator('.ck-chip[aria-checked="false"], .ck-panel-body .ck-quiet').evaluateAll((els) => els.filter((e) => getComputedStyle(e).boxShadow !== 'none').length);
  expect(lined).toBe(0);
});
