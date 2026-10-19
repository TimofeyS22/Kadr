// QA (docs/11 §3.10): accessibility beyond names — text contrast (WCAG 2.2 AA) on every screen of the 375 px walk.
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
  });
});

/**
 * Text below the WCAG AA contrast ratio against what is really behind it: 4.5:1, or 3:1 for large text (24 px, or
 * 18.66 px bold). The background is composed from the element's ancestors (alpha and opacity included); text over a
 * picture (image, gradient, canvas, video) cannot be judged this way and is skipped, as are disabled controls.
 */
async function contrastAudit(page: Page): Promise<{ bad: string[]; checked: number; overPicture: number }> {
  return page.evaluate(() => {
    type RGBA = [number, number, number, number];
    const parse = (c: string): RGBA => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 0];
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    };
    const over = (top: RGBA, under: RGBA): RGBA => {
      const a = top[3] + under[3] * (1 - top[3]);
      if (!a) return [0, 0, 0, 0];
      return [0, 1, 2].map((i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a) as RGBA;
    };
    const lum = (c: RGBA) => {
      const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const out: string[] = [];
    const seen = new Set<string>();
    let checked = 0, overPicture = 0;
    const all = document.querySelectorAll<HTMLElement>('body *');
    for (const el of all) {
      const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim();
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || el.closest('[disabled],[aria-disabled="true"],[aria-hidden="true"]')) continue;
      // Background: the first opaque layer up the tree, with translucent layers composed over it.
      const layers: RGBA[] = [];
      let picture = false, opacity = 1;
      for (let a: HTMLElement | null = el; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        opacity *= Number(s.opacity);
        if (s.backgroundImage !== 'none' || /^(CANVAS|VIDEO|IMG)$/.test(a.tagName)) { picture = true; break; }
        const bg = parse(s.backgroundColor);
        if (bg[3] > 0) { layers.push(bg); if (bg[3] >= 1) break; }
      }
      // Something drawn over by position (a preview canvas under an overlay) is not in the ancestors: skip text over the preview.
      if (picture || el.closest('.preview, .preview-wrap, .stage')) { overPicture++; continue; }
      checked++;
      let bg: RGBA = parse(getComputedStyle(document.body).backgroundColor);
      if (bg[3] < 1) bg = [255, 255, 255, 1];
      for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
      const fg0 = parse(cs.color);
      const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * opacity], bg);
      const L1 = lum(fg), L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      if (ratio + 1e-6 >= need) continue;
      const key = `${own.slice(0, 40)}|${cs.color}|${bg.map(Math.round).join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`${ratio.toFixed(2)}:1 < ${need} «${own.slice(0, 40)}» ${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${cs.color} on rgb(${bg.slice(0, 3).map(Math.round).join(',')}) ${size}px`);
    }
    return { bad: out, checked, overPicture };
  });
}

test('text contrast meets WCAG AA on every screen of the 375 px walk', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'colours and layout come from the same CSS on both engines');
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 375, height: 812 });
  const found = new Map<string, string[]>();
  let checked = 0, overPicture = 0;
  const audit = async (where: string) => {
    const a = await contrastAudit(page);
    checked += a.checked; overPicture += a.overPicture;
    for (const v of a.bad) found.set(v, [...(found.get(v) ?? []), where]);
  };
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
  await audit('home (empty)');
  await page.getByRole('button', { name: 'New project' }).click();
  await audit('aspect picker');
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await audit('editor (empty)');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles([fx('landscape.mp4')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await audit('clip selected');
  const SHEETS = ['Adjust', 'Filters', 'Effects', 'Crop', 'Transform', 'Mask', 'Chroma key', 'Speed', 'Volume', 'Voice', 'Captions', 'Text', 'Stickers', 'Music', 'Sounds', 'Canvas'];
  for (const scope of ['clip', 'project'] as const) {
    for (const name of SHEETS) {
      if (scope === 'clip' && !(await page.locator('.tl-row.main .clip.sel').count())) await page.locator('.tl-row.main .clip').first().click();
      if (scope === 'project' && (await page.locator('.tl-row.main .clip.sel').count())) await page.getByRole('button', { name: 'Close tools' }).click();
      const button = page.locator('.toolbar .tool', { hasText: new RegExp(`^${name}$`) });
      if (!(await button.count())) continue;
      if (name === 'Captions') continue; // one tap starts recognition (v1.3); its sheet is audited by the captions tests
      await button.first().click();
      await expect(page.locator('.sheet')).toBeVisible();
      await page.waitForTimeout(400);
      await audit(`${scope} › ${name}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
  }
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.waitForTimeout(300);
  await audit('export sheet');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
  await audit('home (with a project)');
  const rows = [...found].map(([v, where]) => `${v} — ${where.length > 3 ? `${where.slice(0, 3).join(', ')} +${where.length - 3}` : where.join(', ')}`);
  fs.writeFileSync(info.outputPath('contrast.md'), rows.join('\n'));
  console.log(`contrast (${info.project.name}): ${checked} texts checked on 35 screens, ${overPicture} over a picture skipped; ${rows.length} below AA\n${rows.join('\n')}`);
  expect(checked, 'the audit judges real text').toBeGreaterThan(200);
  expect(rows).toEqual([]);
});

/** Tabs through the page and lists the controls that take the focus without showing it (no outline, no ring). */
async function focusAudit(page: Page, presses: number): Promise<{ reached: number; unseen: string[] }> {
  const unseen = new Set<string>();
  const reached = new Set<string>();
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1 && !/rgba\(.*,\s*0\)/.test(s.outlineColor)) || (s.boxShadow !== 'none' && s.boxShadow !== '');
      const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim().slice(0, 30);
      return { id: `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''} «${name}»`, ring };
    });
    if (!r) continue;
    reached.add(r.id);
    if (!r.ring) unseen.add(r.id);
  }
  return { reached: reached.size, unseen: [...unseen] };
}

test('keyboard: every control reached with Tab shows where the focus is', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebKit skips buttons on Tab unless the system setting says otherwise');
  test.setTimeout(180_000);
  const report: string[] = [];
  const problems: string[] = [];
  const audit = async (where: string, presses: number) => {
    const a = await focusAudit(page, presses);
    report.push(`${where}: ${a.reached} controls reached, ${a.unseen.length} without a visible focus`);
    for (const u of a.unseen) problems.push(`${where}: ${u}`);
  };
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
  await audit('home', 25);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles([fx('landscape.mp4')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await audit('editor, clip selected', 45);
  await page.locator('.toolbar .tool', { hasText: /^Adjust$/ }).click();
  await expect(page.locator('.sheet')).toBeVisible();
  await audit('Adjust sheet', 30);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Export' }).first().click();
  await audit('export sheet', 30);
  console.log(`focus:\n${report.join('\n')}\n${problems.join('\n')}`);
  expect(problems).toEqual([]);
});
