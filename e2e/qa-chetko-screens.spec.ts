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
  // «Эффекты» before an effect is picked is a short sheet. (The mask's was, until its values came to be shown before the
  // shape so the sheet does not jump as the shape comes: Ч4, «доделать листы».)
  await openTool(page, 'Эффекты');
  const done = panel(page).getByRole('button', { name: 'Готово' });
  await expect(done).toHaveText('Готово'); // words, not a check (audit P3-2)
  expect((await done.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const sheetH = await panel(page).evaluate((e) => e.getBoundingClientRect().height);
  expect(sheetH, 'the effects sheet is as tall as what it holds').toBeLessThan(0.46 * 812 - 40);
  // The frame sits right above the sheet: the editor leaves the sheet exactly its height.
  const gap = await page.evaluate(() => document.querySelector('.sheet')!.getBoundingClientRect().top - document.querySelector('.transport')!.getBoundingClientRect().bottom);
  expect(Math.abs(gap), 'nothing is left empty between the row under the frame and the sheet').toBeLessThanOrEqual(1);
  const withShort = await frame();
  expect(withShort, 'a short sheet leaves the frame more room than the 46% sheet of 1.7.1').toBeGreaterThan(shut - 0.46 * 812 + 60);
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
  await panel(page).getByRole('tab', { name: 'Нарастание' }).click();
  await expect(panel(page).locator('.ck-values .ck-scale-head .ck-digit')).toHaveText('0,0 с');
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
  // On the Scale (Ч4, «доделать листы»): the strip with a step either side takes the width of the sheet (UI-3: 131 of 343 px).
  const x = panel(page).getByRole('slider', { name: 'Положение X' });
  const scale = (await panel(page).locator('.ck-values .ck-scale').boundingBox())!;
  expect(scale.width, 'the Scale takes the width of the sheet').toBeGreaterThanOrEqual(body.width - 32 - 1);
  expect((await x.boundingBox())!.height).toBeGreaterThanOrEqual(44);
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

const BLACK = /^(rgb\(0, 0, 0\)|oklch\(0 0 0\))$/;
test('sheets: fonts and text styles show the person\'s word on the black of the stage, no option is a grey outlined box (the owner, 2026-11-11)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kadr.undoMoved.v1', '1'));
  await sampleEditor(page);
  await page.locator('.tl-row .clip-text').first().click();
  await openTool(page, 'Текст');
  // Fonts: a strip of tiles, each the person's own word in its own face, white on the black of the stage (docs/18; the
  // owner, 2026-11-11: «серая обложка за шрифтами выглядит ужасно старо»). It had collapsed to nothing under «Шрифт».
  const fonts = panel(page).getByRole('radiogroup', { name: 'Шрифт' });
  expect((await fonts.boundingBox())!.height).toBeGreaterThan(100);
  await expect.poll(() => fonts.locator('canvas[data-ready]').count(), { message: 'the first tiles drawn once their faces are in' }).toBeGreaterThanOrEqual(6);
  const drawn = await fonts.locator('canvas[data-ready]').evaluateAll((els) => (els as HTMLCanvasElement[]).slice(0, 6).map((c) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let ink = 0, sum = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 128) { ink++; sum = (sum * 31 + i) % 1_000_003; }
    return `${ink}:${sum}`;
  }));
  expect(new Set(drawn).size, 'each tile is drawn in its own font').toBe(drawn.length);
  expect(drawn.every((h) => Number(h.split(':')[0]) > 200), 'letters, not an empty tile').toBe(true);
  const chosen = fonts.locator('[aria-checked="true"] .ck-ptile-art');
  // Pure black, however the engine writes it out (the token is in OKLCH).
  expect(await chosen.evaluate((a) => getComputedStyle(a).backgroundColor), 'the black of the stage, not a grey ground').toMatch(BLACK);
  // The chosen font is ringed in white with a gap, as every chosen thing of a sheet, not held between two marks.
  await expect(fonts.locator('.ck-held')).toHaveCount(0);
  expect(await chosen.evaluate((a) => { const s = getComputedStyle(a); return [s.outlineWidth, s.outlineOffset, s.outlineStyle]; })).toEqual(['2px', '2px', 'solid']);
  await expect(panel(page).getByRole('button', { name: 'Добавить шрифт' })).toBeVisible();
  // The weight: one even row, no word cut.
  const cut = await panel(page).getByRole('radiogroup', { name: 'Начертание' }).locator('.ck-chip').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  expect(cut).toBe(0);
  // Styles: the look on the black of the stage, neither on a grey stand-in nor on the frame behind it (the owner, 2026-11-11:
  // the sample's sunrise behind them was «колхоз»). The corner of a tile is the stage itself, its middle has the letters.
  const styles = panel(page).getByRole('radiogroup', { name: 'Стиль' });
  await expect.poll(() => styles.locator('canvas[data-ready]').count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
  const style = await styles.locator('canvas[data-ready]').first().evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 128) ink++;
    return { corner: d[3], ink, ground: getComputedStyle(c.parentElement!).backgroundColor };
  });
  expect(style.corner, 'nothing drawn under the look: the ground is the stage').toBe(0);
  expect(style.ink, 'the look itself is drawn').toBeGreaterThan(200);
  expect(style.ground).toMatch(BLACK);
  // No grey line around an option that is not chosen.
  const lined = await panel(page).locator('.ck-chip[aria-checked="false"], .ck-panel-body .ck-quiet').evaluateAll((els) => els.filter((e) => getComputedStyle(e).boxShadow !== 'none').length);
  expect(lined).toBe(0);
});

// ---- release 6: export, and the work in sheets ----
/** How many of the film's pictures are painted (a canvas with anything on it). */
const painted = (page: Page) => page.locator('.sheet .ck-work-frame').evaluateAll((cs) => (cs as HTMLCanvasElement[]).filter((c) => {
  if (!c.width || !c.height) return false;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
  return false;
}).length);

test('export: the file\'s own frames come out between two marks as far as it is made; a large percent, the time left, what is made; the film stays when the file is ready', async ({ page }, info) => {
  test.setTimeout(120_000);
  const iphone = info.project.name.startsWith('iphone'); // an iPhone saves to Photos only through the share sheet
  await editorWithVideo(page);
  // While the export runs, every 100 ms: how far it is and how many pictures the film has.
  const samples = page.evaluate(() => new Promise<[number, number][]>((res) => {
    const out: [number, number][] = [];
    const id = setInterval(() => {
      const bar = document.querySelector('.sheet .ck-work [role=progressbar]');
      if (bar) {
        const n = [...document.querySelectorAll<HTMLCanvasElement>('.sheet .ck-work-frame')].filter((c) => {
          if (!c.width) return false;
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
          return false;
        }).length;
        out.push([Number(bar.getAttribute('aria-valuenow')), n]);
      }
      if (document.querySelector('.sheet .ck-work-ready')) { clearInterval(id); res(out); }
    }, 100);
  }));
  await page.getByRole('button', { name: 'Экспорт' }).first().click(); // quick export: it starts at once
  const work = panel(page).locator('.ck-work');
  await expect(work.getByRole('progressbar', { name: 'Экспорт' })).toBeVisible();
  await expect(work.locator('.ck-work-frame')).toHaveCount(8);
  await expect(work.locator('.ck-work-now')).toHaveText(/^\d+% — не закрывайте экран$/);
  // While it goes, «now» is the signal mark at the edge of what is done; the white end mark waits.
  const marks = () => work.locator('.ck-progress').evaluate((el) => [getComputedStyle(el.querySelector('.ck-progress-now')!).visibility, getComputedStyle(el, '::after').visibility]);
  expect(await marks()).toEqual(['visible', 'hidden']);
  expect(await work.locator('.ck-work-pct').evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), 'the percent is the display size').toBe(56);
  await expect(work.locator('.ck-hint').first()).toHaveText(/^Видео · \d+×\d+ · \d+(,\d)? с · \d+ к\/с · около \d+ МБ$/);
  // Measured in one go: a short export may be done between two looks, and its buttons are others then.
  for (const h of await work.getByRole('button').evaluateAll((bs) => bs.map((x) => x.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44);
  const seen = await samples;
  expect(seen.length, 'the export was watched while it ran').toBeGreaterThan(3);
  // A picture is there only once the file has reached its part of the film. It is painted as the frame is drawn and the
  // number follows at the next render, so the film may be a few frames ahead of the percent (behind the curtain).
  for (const [pct, n] of seen) expect(n, `${n} pictures at ${pct}%`).toBeLessThanOrEqual(Math.floor(((pct + 3) / 100) * 8) + 1);
  // Ready: the whole film, the facts of the file, «Файл готов» with a decimal comma.
  await expect(work.locator('.ck-work-ready')).toHaveText(/^Файл готов: \d+(,\d)? МБ за \d+(,\d)? с$/);
  await expect(work.locator('.ck-hint').first()).toHaveText(/^\d+×\d+ · \d+(,\d)? с · (MP4|WEBM)$/);
  expect(await painted(page)).toBe(8);
  expect(await marks(), 'done: the film is held between two white marks').toEqual(['hidden', 'visible']);
  await expect.poll(() => work.locator('.ck-progress-rest').evaluate((el) => el.getBoundingClientRect().width), { message: 'nothing of the film is covered' }).toBeLessThan(1);
  if (iphone) {
    expect(await whiteFilled(page), 'one white button: save to Photos').toEqual(['Сохранить']);
    // Held at the bottom of the sheet, on screen: on an iPhone 15 it was half under the sheet's edge (L5, 2026-11-12).
    const save = (await panel(page).getByRole('button', { name: 'Сохранить', exact: true }).boundingBox())!;
    const sheet = (await panel(page).boundingBox())!;
    expect(save.y + save.height, 'the save button is whole inside the sheet').toBeLessThanOrEqual(sheet.y + sheet.height + 1);
    expect(save.y + save.height).toBeLessThanOrEqual(812);
  } else {
    await expect(work.getByText('Сохранено в «Загрузки».')).toBeVisible();
    expect(await whiteFilled(page), 'saved already: no white button asks to save it again').toEqual([]);
  }
});

for (const height of [812, 667]) {
  test(`export at 375×${height}: the export button and what it makes are held at the bottom of the sheet, seen without scrolling`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false, quality: 'high', evenLoudness: false })));
    await page.setViewportSize({ width: 375, height });
    await editorWithVideo(page);
    await page.getByRole('button', { name: 'Экспорт' }).first().click();
    const go = panel(page).getByRole('button', { name: 'Экспортировать видео' });
    await expect(go).toBeEnabled({ timeout: 15_000 });
    const body = panel(page).locator('.sheet-body');
    for (const top of [0, 10_000]) {
      await body.evaluate((b, y) => { b.scrollTop = y; }, top);
      await page.waitForTimeout(100);
      const b = (await go.boundingBox())!, sheet = (await panel(page).boundingBox())!;
      expect(b.y + b.height, `scrolled to ${top}: the button is on screen`).toBeLessThanOrEqual(height);
      expect(b.y + b.height, 'inside the sheet').toBeLessThanOrEqual(sheet.y + sheet.height);
      expect(b.height).toBeGreaterThanOrEqual(44);
      await expect(go.locator('.ck-btn-sub'), 'what it makes is the second line of the button').toHaveText(/^\d+×\d+ · \d+(,\d)? с · \d+ к\/с · около \d+ МБ$/);
    }
    const white = await whiteFilled(page);
    expect(white.length, 'one white button: the export').toBe(1);
    expect(white[0]).toMatch(/^Экспортировать видео/);
    // Format, size, rate and quality are even tracks; the ready-made sets one row.
    for (const name of ['Видео', '720p', '30', 'Высокое']) {
      expect(await panel(page).getByRole('radio', { name, exact: true }).evaluate((r) => r.closest('.ck-chips')!.hasAttribute('data-even')), name).toBe(true);
    }
    // The same place for every format: the button does not move when the sheet holds less.
    const at = (await go.boundingBox())!.y;
    await panel(page).getByRole('radio', { name: 'GIF', exact: true }).click();
    expect((await panel(page).getByRole('button', { name: 'Экспортировать GIF' }).boundingBox())!.y, 'GIF: where the video button was').toBeCloseTo(at, 0);
  });
}

test('export: what went wrong is a sign and words on a plate, never red; the details copy for support; back is one tap', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false, quality: 'high', evenLoudness: false })));
  await editorWithVideo(page);
  await page.evaluate(() => { AudioEncoder.prototype.encode = function () { throw new Error('this test refused the sound'); }; });
  await page.getByRole('button', { name: 'Экспорт' }).first().click();
  await panel(page).getByRole('radio', { name: 'Звук', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Экспортировать звук' }).click();
  const alert = panel(page).getByRole('alert');
  // The plate says it in words a person reads (S-1: a cause no one can act on goes to the details), the details carry it.
  await expect(alert).toContainText('Экспорт не удался', { timeout: 30_000 });
  await expect(alert.locator('svg')).toHaveCount(1);
  const colours = await alert.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(document.querySelector('.sheet h2')!).color]);
  expect(colours[0], 'the words are the colour of text, not red').toBe(colours[1]);
  await panel(page).locator('.ck-more summary').click(); // the message itself says «Подробности — в «Подробнее»»
  await expect(panel(page).locator('.ck-details pre')).toContainText('this test refused the sound');
  await expect(panel(page).getByRole('button', { name: 'Скопировать для поддержки' })).toBeVisible();
  await panel(page).getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Экспортировать звук' })).toBeVisible();
});

test('work in sheets: the question before a model download and the progress are the system\'s; no button of the old sheets is left', async ({ page }) => {
  await editorWithVideo(page);
  await page.locator('.toolbar .tool-back').click().catch(() => undefined);
  await tool(page, 'Субтитры').click();
  const make = panel(page).getByRole('button', { name: 'Создать субтитры' });
  const ask = panel(page).getByRole('group', { name: 'Загрузка модели речи' });
  // The sheet may ask at once (the tool starts the captions), or show its settings first.
  await expect(make.or(ask).first()).toBeVisible();
  if (!(await ask.isVisible())) await make.click();
  await expect(ask).toBeVisible();
  expect(await whiteFilled(page), 'one white button: the yes').toEqual(['Скачать и сделать субтитры']);
  for (const b of await ask.getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(panel(page).locator('.btn, .progress:not(.ck-progress)')).toHaveCount(0);
  await ask.getByRole('button', { name: 'Не сейчас' }).click();
  await expect(panel(page).getByRole('button', { name: 'Создать субтитры' })).toBeVisible();
});

// ---- «доделать листы»: values on the Scale, the mask by its look ----
test('values: the numbers of a part are tabs over one Scale — all on view without scrolling, a changed one marked, reset and a step either way', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kadr.undoMoved.v1', '1'));
  await sampleEditor(page);
  await page.locator('.tl-row.main .clip').first().click();
  await openTool(page, 'Трансформация');
  const tabs = panel(page).getByRole('tab');
  await expect(tabs).toHaveText(['Положение X', 'Положение Y', 'Масштаб', 'Поворот', 'Непрозрачность']);
  await expect(panel(page).getByRole('slider')).toHaveCount(2); // the sheet's playhead and the one Scale
  const sheetBox = (await panel(page).boundingBox())!;
  const scale = (await panel(page).locator('.ck-values .ck-scale').boundingBox())!;
  expect(scale.y + scale.height, 'the Scale is on view as the sheet opens').toBeLessThanOrEqual(sheetBox.y + sheetBox.height);
  // A step with the + button, the digit and the mark on the tab; «Сбросить» takes it back.
  const x = panel(page).getByRole('slider', { name: 'Положение X' });
  const reset = panel(page).getByRole('button', { name: 'Сбросить', exact: true });
  await expect(reset).toBeDisabled();
  for (const b of await panel(page).locator('.ck-values button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await panel(page).getByRole('button', { name: 'Больше' }).click();
  await expect(x).toHaveAttribute('aria-valuenow', '0.01');
  await expect(tabs.first()).toHaveAccessibleName(/^Положение X ?, изменено$/); // the mark is a box of its own: a space before it
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(x).toHaveAttribute('aria-valuenow', '0');
  await expect(tabs.first()).toHaveAccessibleName('Положение X');
  // At rest the needle stands in the white mark, which is a little larger: the two marks read even before a change.
  const [was, needle] = await panel(page).locator('.ck-values').evaluate((v) => ['.ck-was', '.ck-needle'].map((c) => v.querySelector(c)!.getBoundingClientRect().width));
  expect(was).toBeGreaterThan(needle);
  // The Scale's arrows are its own: the playhead of the editor stays where it was (they moved it a frame a press).
  const time = await page.locator('.time').textContent();
  await x.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(x).toHaveAttribute('aria-valuenow', '0.02');
  await expect(page.locator('.time')).toHaveText(time!);
  await reset.click();
  // Another tab is another value on the same Scale; the keyframe diamond goes with it.
  await tabs.nth(3).click();
  await expect(panel(page).getByRole('slider', { name: 'Поворот' })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Добавить ключевой кадр: Поворот' })).toBeVisible();
  // The numbers under the strip stand 64 px apart or more and read as the value does.
  const xs = await panel(page).locator('.ck-tick-label').evaluateAll((ls) => ls.map((l) => { const r = l.getBoundingClientRect(); return r.left + r.width / 2; }));
  for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(63);
  await expect(panel(page).locator('.ck-tick-label').first()).toHaveText(/°$/);
});

test('mask: the shapes are tiles of the person\'s own frame, the chosen one ringed; its values follow on the Scale', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kadr.undoMoved.v1', '1'));
  await sampleEditor(page);
  await page.locator('.tl-row.main .clip').first().click();
  await openTool(page, 'Маска');
  const shapes = panel(page).getByRole('radiogroup', { name: 'Маска' });
  await expect(shapes.getByRole('radio')).toHaveText(['Нет', 'Круг', 'Прямоугольник', 'Градиент']);
  // Drawn on the frame: «Нет» is the sky to its corner, «Круг» leaves its corner dark.
  const corner = (name: string) => shapes.getByRole('radio', { name, exact: true }).locator('canvas').evaluate((c: HTMLCanvasElement) => {
    const [r, g, b] = c.getContext('2d')!.getImageData(2, 2, 1, 1).data;
    return r + g + b;
  });
  await expect.poll(() => corner('Нет'), { timeout: 30_000 }).toBeGreaterThan(150);
  await expect.poll(() => corner('Круг'), { timeout: 30_000 }).toBeLessThan(60);
  await expect(panel(page).getByRole('slider', { name: 'Размер' })).toHaveAttribute('aria-disabled', 'true');
  const before = (await panel(page).boundingBox())!.height;
  await shapes.getByRole('radio', { name: 'Круг', exact: true }).click();
  await expect(panel(page).getByRole('slider', { name: 'Размер' })).not.toHaveAttribute('aria-disabled', 'true');
  expect((await panel(page).boundingBox())!.height, 'the sheet does not jump as the shape comes').toBeCloseTo(before, 0);
  await expect(shapes.getByRole('radio', { name: 'Круг', exact: true })).toHaveAttribute('aria-checked', 'true');
  expect(await shapes.locator('[aria-checked="true"] .ck-tile-pic').evaluate((c) => getComputedStyle(c).outlineWidth), 'ringed in white').toBe('2px');
  // The frame whole in its proportions, and all four shapes in a row on a 375 px screen.
  const art = (await shapes.locator('canvas').first().boundingBox())!;
  expect(art.width / art.height, 'the frame of the vertical sample, not cropped to a band').toBeLessThan(0.7);
  for (const tile of await shapes.getByRole('radio').all()) expect((await tile.boundingBox())!.x + (await tile.boundingBox())!.width).toBeLessThanOrEqual(375);
  await expect(panel(page).getByRole('tab')).toHaveText(['Размер', 'Влево ↔ вправо', 'Вверх ↕ вниз', 'Поворот', 'Мягкий край']);
  await expect(panel(page).getByRole('slider', { name: 'Размер' })).toHaveAttribute('aria-valuenow', '0.7');
});

// ---- release 8: the frame and what lies on it ----
/** A CSS property of an element (or its pseudo-element) as sRGB, read through a canvas: the browser gives tokens as oklch(). */
const rgbOf = (loc: ReturnType<Page['locator']>, prop: 'backgroundColor' | 'outlineColor', pseudo?: string) => loc.evaluate((e, [p, ps]) => {
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.fillStyle = getComputedStyle(e, ps || null)[p as 'backgroundColor'];
  ctx.fillRect(0, 0, 1, 1);
  return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
}, [prop, pseudo ?? ''] as const);
/** No hue: black, white or a grey between — so not red or pink. */
const neutral = ([r, g, b]: number[]) => Math.max(r, g, b) - Math.min(r, g, b) <= 12;

test('frame: the field is black and the frame square-cornered with no line round it; what lies on it is white with a dark edge, never pink or red', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kadr.undoMoved.v1', '1'));
  await sampleEditor(page);
  expect(await rgbOf(page.locator('.preview'), 'backgroundColor'), 'DESIGN.md §2.1: round the frame only black').toEqual([0, 0, 0]);
  const frame = await page.locator('.preview-canvas').evaluate((e) => [getComputedStyle(e).borderRadius, getComputedStyle(e).boxShadow]);
  expect(frame).toEqual(['0px', 'none']);
  // The text of the sample, selected inside its time: its box and handle.
  await page.locator('.preview').click({ position: { x: 5, y: 5 } });
  for (let i = 0; i < 45; i++) await page.keyboard.press('ArrowRight');
  await page.locator('.tl-row .clip-text').first().click();
  const sel = page.locator('.sel-box');
  await expect(sel).toBeVisible();
  const ring = await sel.evaluate((e) => getComputedStyle(e).boxShadow);
  expect(ring, 'white, 2 px as a held piece on the timeline, with a dark edge both sides').toMatch(/1px inset.*0px 0px 0px 2px.*0px 0px 0px 3px/);
  const handle = (await page.locator('.sel-handle').boundingBox())!;
  expect(handle.width).toBeGreaterThanOrEqual(44);
  const dot = await rgbOf(page.locator('.sel-handle'), 'backgroundColor', '::after');
  expect(Math.min(...dot), `the handle is white: ${dot}`).toBeGreaterThan(230);
  // The guide shows while the text is dragged to the middle, white; the angle plate is dark and white once it snaps.
  // The sample's text stands in the middle: a drag of 2 px keeps it within the snap, 20 px down moves it.
  const b = (await sel.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2 + 20, { steps: 8 });
  const guide = page.locator('.guide.v');
  await expect(guide).toBeVisible();
  const g = await rgbOf(guide, 'backgroundColor');
  expect(Math.min(...g), `the guide is white, not pink: ${g}`).toBeGreaterThan(230);
  await page.mouse.up();
  const tag = page.locator('.angle-tag');
  const plain = await rgbOf(tag, 'backgroundColor');
  await tag.evaluate((e) => e.setAttribute('data-snapped', ''));
  const snapped = await rgbOf(tag, 'backgroundColor');
  await tag.evaluate((e) => e.removeAttribute('data-snapped'));
  expect(neutral(plain) && neutral(snapped), `${plain} / ${snapped}`).toBe(true);
  expect(await tag.evaluate((e) => { e.setAttribute('data-snapped', ''); const r = getComputedStyle(e).boxShadow; e.removeAttribute('data-snapped'); return r; }), 'a snap rings the plate in white').toMatch(/inset/);
  // The safe zones: dimmed and edged in white, not red.
  await page.getByRole('button', { name: /безопасн/i }).first().click();
  for (const zone of await page.locator('.safe-zones i').all()) {
    const [bg, line] = [await rgbOf(zone, 'backgroundColor'), await rgbOf(zone, 'outlineColor')];
    expect(neutral(bg) && neutral(line), `a zone: ${bg} / ${line}`).toBe(true);
  }
});

test('toasts: a failure is a dark plate with a white ring and a sign, never red, where toasts always stood', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.toolbar .tool', { hasText: /^Медиа$/ }).click();
  await (await chooser).setFiles([fx('hostile_empty.mp4')]);
  const toast = page.locator('.toast.error').first();
  await expect(toast).toBeVisible({ timeout: 30_000 });
  const bg = await rgbOf(toast, 'backgroundColor');
  const shadow = await toast.evaluate((e) => getComputedStyle(e).boxShadow);
  expect(neutral(bg), `not a red ground: ${bg}`).toBe(true);
  expect(shadow, 'a white ring').toMatch(/inset/);
  await expect(toast.locator('.ck-apptoast-text svg')).toHaveCount(1);
  // A failure stays until closed, and says how: a cross 44 px to a finger.
  const close = toast.getByRole('button', { name: 'Закрыть' });
  expect((await close.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  const top = (await toast.boundingBox())!.y;
  expect(top, 'under the header, as before').toBeLessThan(160);
  // A plain toast is a plate too, not bare words over the video (found by eye after release 8: it had lost its ground).
  await close.click();
  await page.evaluate(() => localStorage.removeItem('kadr.hint.move')); // the hint on moving a text, said once
  await page.locator('.toolbar .tool', { hasText: /^Текст$/ }).click();
  const info = page.locator('.toast.info').first();
  await expect(info).toBeVisible();
  const [ground, pad] = await info.evaluate((e) => [getComputedStyle(e).backgroundColor, parseFloat(getComputedStyle(e).paddingTop)] as const);
  expect(ground, 'a ground of its own').not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  expect(pad).toBeGreaterThanOrEqual(12);
  await page.evaluate(() => { (window as unknown as { __toastErrors?: string[] }).__toastErrors = []; });
});

// ---- release 9: recording ----
/** A camera and a microphone that work headless: a picture only when one is asked for, a tone as the voice. */
async function fakeMedia(page: Page) {
  await page.addInitScript(() => {
    MediaDevices.prototype.getUserMedia = async function (want?: MediaStreamConstraints) {
      const c = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
      const g = c.getContext('2d')!;
      let f = 0;
      setInterval(() => { g.fillStyle = '#eee'; g.fillRect(0, 0, 640, 360); g.fillStyle = `hsl(${(f++ * 7) % 360} 70% 50%)`; g.fillRect(0, 0, 640, 20); }, 33);
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      return new MediaStream([...(want?.video ? c.captureStream(30).getVideoTracks() : []), ...dest.stream.getAudioTracks()]);
    };
  });
}
const darkRound = (c: number[]) => neutral(c) && Math.max(...c) < 80;
const signal = ([r, g, b]: number[]) => r > 200 && g > 170 && b < 120;

test('camera: black round the picture; white icons on dark rounds 44 px; the record button white, never red, and held under the thumb while a take runs', async ({ page }) => {
  await fakeMedia(page);
  await sampleEditor(page);
  await page.getByRole('button', { name: 'Камера', exact: true }).first().click();
  const cam = page.getByRole('dialog', { name: 'Камера' });
  await expect(cam).toBeVisible();
  expect(await rgbOf(cam, 'backgroundColor'), 'DESIGN.md §2.1: black round the picture').toEqual([0, 0, 0]);
  for (const name of ['Закрыть камеру', 'Сценарий телесуфлёра', 'Сменить камеру']) {
    const b = cam.getByRole('button', { name });
    const box = (await b.boundingBox())!;
    expect(Math.min(box.width, box.height), name).toBeGreaterThanOrEqual(44);
    const bg = await rgbOf(b, 'backgroundColor');
    expect(darkRound(bg), `${name}: a solid dark round, so a light wall does not take the icon: ${bg}`).toBe(true);
  }
  const start = cam.getByRole('button', { name: 'Начать запись' });
  await expect(start).toBeEnabled({ timeout: 10_000 });
  const disc = await rgbOf(start, 'backgroundColor', '::before');
  expect(neutral(disc) && Math.min(...disc) > 230, `DESIGN.md §2.3: the record button is white, red is for deleting: ${disc}`).toBe(true);
  const at = (await start.boundingBox())!;
  expect(Math.abs(at.x + at.width / 2 - 375 / 2), 'in the middle, under the thumb').toBeLessThan(2);
  expect(at.y, 'in the lower fifth').toBeGreaterThan(812 * 0.8);
  // The script: a named field; its speed and size as tabs over one Scale; read on a solid dark plate by the lens.
  await cam.getByRole('button', { name: 'Сценарий телесуфлёра' }).click();
  await cam.getByRole('textbox', { name: 'Текст для суфлёра' }).fill('Привет! Это проверка суфлёра.\nВторая строка.');
  await expect(cam.getByRole('tab')).toHaveText(['Скорость прокрутки', 'Размер текста']);
  await expect(cam.getByRole('slider', { name: 'Скорость прокрутки', exact: true })).toHaveAttribute('aria-valuenow', '1');
  const plate = cam.locator('.ck-prompter');
  expect(darkRound(await rgbOf(plate, 'backgroundColor')), 'a solid plate').toBe(true);
  const pb = (await plate.boundingBox())!;
  expect(pb.y, 'at the top, by the lens').toBeLessThan(60);
  expect(pb.height, 'four lines, not a third of the screen over the face').toBeLessThan(812 * 0.25);
  // The time is there before the take, so the camera reads as video; its «now» mark is not lit yet.
  await expect(cam.locator('.rec-time')).toHaveText(/^0:00/);
  // 3, 2, 1 is stopped by the same button, and closing is not offered while a take is counted in or runs.
  await start.click();
  await cam.getByRole('button', { name: 'Отменить отсчёт' }).click();
  await expect(start).toBeEnabled();
  await start.click();
  await expect(cam.getByRole('button', { name: 'Закрыть камеру' })).toBeDisabled();
  // A take: the disc becomes a square to stop in the same place; the time runs over it with the signal mark of «now».
  const stop = cam.getByRole('button', { name: 'Остановить запись' });
  await expect(stop).toBeVisible({ timeout: 10_000 });
  const now = (await stop.boundingBox())!;
  expect(Math.abs(now.x - at.x) + Math.abs(now.y - at.y), 'the button does not move from under the thumb').toBeLessThan(1);
  const time = cam.locator('.rec-time');
  await expect(time).toHaveText(/^0:0\d/);
  const tb = (await time.boundingBox())!;
  expect(tb.y + tb.height, 'the time stands over the button').toBeLessThanOrEqual(now.y + 1);
  expect(signal(await rgbOf(time, 'backgroundColor', '::before')), 'the mark of «now»').toBe(true);
  await page.waitForTimeout(1500);
  await stop.click();
  await expect(cam).toHaveCount(0, { timeout: 30_000 });
});

test('voice-over: the same white record button; the level is a grey bar with a white mark, too loud turns it white — never red', async ({ page }) => {
  await fakeMedia(page);
  await sampleEditor(page);
  await page.getByRole('button', { name: 'Запись', exact: true }).first().click();
  await expect(panel(page)).toBeVisible();
  const start = panel(page).getByRole('button', { name: 'Начать запись' });
  const disc = await rgbOf(start, 'backgroundColor', '::before');
  expect(neutral(disc) && Math.min(...disc) > 230, `white, not red: ${disc}`).toBe(true);
  expect((await start.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  const meter = panel(page).locator('.meter');
  // The peak mark is drawn only once there is a peak; here one stands in for it, to read its colour.
  await meter.evaluate((e) => { if (!e.querySelector('i')) e.append(Object.assign(document.createElement('i'), { className: 'hold' })); });
  const parts = async () => [await rgbOf(meter.locator('> div'), 'backgroundColor'), await rgbOf(meter.locator('> i'), 'backgroundColor')];
  const [bar, mark] = await parts();
  expect(neutral(bar) && neutral(mark) && Math.min(...mark) > 230, `a grey bar and a white mark: ${bar} / ${mark}`).toBe(true);
  await meter.evaluate((e) => e.setAttribute('data-clip', ''));
  const [loud, loudMark] = await parts();
  expect(neutral(loud) && Math.min(...loud) > 230 && neutral(loudMark), `too loud is white, not red: ${loud} / ${loudMark}`).toBe(true);
  await meter.evaluate((e) => e.removeAttribute('data-clip'));
  const before = await page.locator('.tl-row.audio .clip').count();
  await start.click();
  const stop = panel(page).getByRole('button', { name: 'Остановить запись' });
  await expect(stop).toBeVisible({ timeout: 15_000 });
  expect(signal(await rgbOf(panel(page).locator('.rec-time'), 'backgroundColor', '::before')), 'the mark of «now»').toBe(true);
  await page.waitForTimeout(1200);
  await stop.click();
  await expect(page.locator('.tl-row.audio .clip')).toHaveCount(before + 1, { timeout: 30_000 });
});
