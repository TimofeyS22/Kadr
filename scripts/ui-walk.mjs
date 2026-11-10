// The 375 px walk of the interface (docs/17, stage Ч0 and every "before / after" of stage Ч4): a screenshot and measurements
// of every screen — regions, real touch areas, font sizes, what fits in the toolbar. Not a Playwright test: its own browser
// and its own output folder, so it does not disturb a test run next to it.
//   URL=http://localhost:5173/ OUT=/tmp/ui-walk LOCALE=ru VIEW=375x812 node scripts/ui-walk.mjs   (FIRST=1: first run, tips on)
// Needs `npm run fixtures`. Writes NN.png and data.json into OUT/<locale>-<height>.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_ = process.env.URL ?? 'http://localhost:5173/';
const LOCALE = process.env.LOCALE ?? 'ru';
const [W, H] = (process.env.VIEW ?? '375x812').split('x').map(Number);
const FIRST = !!process.env.FIRST;
const OUT = path.join(process.env.OUT ?? path.join(os.tmpdir(), 'kadr-ui-walk'), `${LOCALE}-${H}${FIRST ? '-first' : ''}`);
const FX = path.join(import.meta.dirname, '..', 'fixtures') + path.sep;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// Tools that open a sheet; the rest act at once and are not pressed in the walk.
const SHEET_TOOLS = new Set(['Adjust', 'Filters', 'Transform', 'Crop', 'Layers', 'Remove pauses', 'Mask', 'Effects', 'Hide faces', 'Chroma key', 'Speed', 'Volume', 'Voice', 'Beat', 'Edit text', 'Reel in 1 tap', 'Music', 'Stickers', 'Sounds', 'Camera', 'Record', 'Canvas']);
// The toolbar of every selection in English, in the order of src/ui/Toolbar.tsx: the walk finds a tool by its place, so it
// works in any language. If the toolbar changes, change this too — the walk says when the counts differ.
const BASE = ['Split', 'Duplicate', 'Delete'];
const enTools = {
  project: ['Reel in 1 tap', 'Media', 'Captions', 'Text', 'Music', 'Overlay', 'Stickers', 'Sounds', 'Audio', 'Camera', 'Record', 'Canvas'],
  video: [...BASE, 'Speed', 'Volume', 'Voice', 'Captions', 'Remove pauses', 'Crop', 'Mirror', 'Transform', 'Adjust', 'Filters', 'Effects', 'Mask', 'Hide faces', 'Cutout', 'Chroma key', 'Auto reframe', 'Freeze', 'Reverse', 'Extract audio', 'Select several'],
  image: [...BASE, 'Crop', 'Mirror', 'Transform', 'Adjust', 'Filters', 'Effects', 'Mask', 'Hide faces', 'Cutout', 'Chroma key', 'Select several'],
  audio: [...BASE, 'Speed', 'Volume', 'Voice', 'Beat', 'Captions', 'Remove pauses', 'Select several'],
  overlay: [...BASE, 'Crop', 'Mirror', 'Transform', 'Layers', 'Adjust', 'Filters', 'Effects', 'Mask', 'Hide faces', 'Cutout', 'Chroma key', 'Select several'],
  text: ['Edit text', 'Transform', 'Layers', 'Split', 'Duplicate', 'Delete', 'Select several'],
};

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: LOCALE === 'ru' ? 'ru-RU' : 'en-US' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(([locale, first]) => {
  localStorage.setItem('kadr.locale', locale);
  if (!first) {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
  }
}, [LOCALE, FIRST]);

const screens = [];
let n = 0;
async function snap(name, extra = {}) {
  await page.waitForTimeout(350);
  const file = `${String(++n).padStart(2, '0')}.png`;
  await page.screenshot({ path: path.join(OUT, file) });
  const data = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    };
    const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
    const regions = {};
    for (const s of ['.topbar', '.preview', '.preview-canvas', '.transport', '.timeline', '.toolbar', '.sheet', '.camera', '.home']) regions[s] = rect(s);
    const label = (el) => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('type') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const hits = (el, x, y) => { const at = document.elementFromPoint(x, y); return !!at && (el === at || el.contains(at) || (at.closest('label')?.contains(el) ?? false)); };
    const sel = 'button, a[href], input, select, textarea, [role=button], [role=tab], [role=radio], [role=slider], [role=switch], [tabindex]:not([tabindex="-1"]), .clip, .handle';
    const controls = [];
    for (const el of document.querySelectorAll(sel)) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      // The real touch area: does a finger 21.5 px off the centre still land on this control?
      const hitW = hits(el, cx - 21.5, cy) && hits(el, cx + 21.5, cy);
      const hitH = hits(el, cx, cy - 21.5) && hits(el, cx, cy + 21.5);
      const top = hits(el, cx, cy);
      controls.push({
        label: label(el), tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', cls: String(el.className?.baseVal ?? el.className).slice(0, 40),
        x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), fs: parseFloat(getComputedStyle(el).fontSize),
        off: el.disabled || el.getAttribute('aria-disabled') === 'true', inSheet: !!el.closest('.sheet'), hitW, hitH, top,
      });
    }
    const sizes = {};
    for (const el of document.querySelectorAll('body *')) {
      const own = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (!own || !vis(el)) continue;
      const cs = getComputedStyle(el);
      const k = `${parseFloat(cs.fontSize)}/${cs.fontWeight}`;
      sizes[k] = (sizes[k] ?? 0) + 1;
    }
    const tb = document.querySelector('.toolbar');
    const sh = document.querySelector('.sheet');
    return {
      vw: innerWidth, vh: innerHeight, regions, controls, sizes,
      toolbar: tb ? { scrollW: tb.scrollWidth, clientW: tb.clientWidth, scrollLeft: tb.scrollLeft } : null,
      sheet: sh ? { title: (sh.querySelector('h1,h2,h3')?.textContent ?? '').trim(), scrollH: sh.scrollHeight, clientH: sh.clientHeight, inner: [...sh.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)).map((e) => `${e.className}:${e.scrollHeight}/${e.clientHeight}`).slice(0, 4) } : null,
      hScroll: document.documentElement.scrollWidth > innerWidth,
    };
  });
  screens.push({ name, file, ...extra, ...data });
  console.log(`${file} ${name}`);
}

const tools = () => page.locator('.toolbar .tool:not(.tool-back)');
const toolLabels = async () => (await tools().allInnerTexts()).map((s) => s.trim());
const closeSheet = async () => {
  const done = page.locator('.sheet .sheet-head .icon-btn, .camera .camera-bar .icon-btn');
  if (await done.count()) await done.first().click().catch(() => {});
  await page.locator('.sheet, .camera').first().waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(200);
};
const deselect = async () => { if (await page.locator('.tool-back').count()) { await page.locator('.tool-back').click(); await page.waitForTimeout(200); } };

/** Open every sheet tool of the toolbar on screen; `kind` names the selection. */
async function walkTools(kind, only, reselect) {
  const labels = await toolLabels();
  const en = enTools[kind] ?? [];
  if (en.length !== labels.length) console.log(`  the toolbar of "${kind}" has ${labels.length} tools, the list in this script has ${en.length}: update enTools`);
  screens[screens.length - 1].tools = labels;
  for (let i = 0; i < labels.length; i++) {
    if (!SHEET_TOOLS.has(en[i]) || (only && !only.includes(en[i]))) continue;
    if (reselect && (await toolLabels()).length !== labels.length) await reselect();
    await tools().nth(i).click({ timeout: 5000 });
    const open = await page.locator('.sheet, .camera').first().waitFor({ timeout: 5000 }).then(() => true, () => false);
    await page.waitForTimeout(500);
    if (!open) { console.log(`  no sheet: ${en[i]}`); await snap(`${kind} › ${labels[i]} (no sheet)`, { tool: en[i], kind }); continue; }
    await snap(`${kind} › ${labels[i]}`, { tool: en[i], kind });
    const tabs = page.locator('.sheet [role=tab]');
    const tabCount = Math.min(await tabs.count(), 8);
    for (let t = 1; t < tabCount; t++) {
      const tl = (await tabs.nth(t).innerText().catch(() => '')).trim();
      await tabs.nth(t).click().catch(() => {});
      await snap(`${kind} › ${labels[i]} › ${tl}`, { tool: en[i], kind, tab: tl });
    }
    await closeSheet();
  }
}
async function pickFile(enLabel, file) {
  const en = enTools.project ?? [];
  const i = en.indexOf(enLabel);
  const chooser = page.waitForEvent('filechooser');
  await tools().nth(i).click();
  await (await chooser).setFiles([FX + file]);
  await page.waitForTimeout(1500);
}
const clipBy = (re) => page.locator('.clip').evaluateAll((els, src) => els.findIndex((e) => new RegExp(src).test(e.className)), re.source);
async function selectClip(index) {
  const c = page.locator('.clip').nth(index);
  if (!/\bsel\b/.test((await c.getAttribute('class')) ?? '')) { await c.scrollIntoViewIfNeeded(); await c.click({ position: { x: 12, y: 12 }, force: true }); }
  await page.waitForTimeout(300);
}

try {
  await page.goto(URL_);
  const newProject = page.getByRole('button', { name: /^(New project|Новый проект)$/ });
  await newProject.waitFor();
  await snap('home (empty)');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await snap('home (empty), bottom');
  await page.evaluate(() => window.scrollTo(0, 0));
  await newProject.click();
  await snap('aspect picker');
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await page.locator('.toolbar').waitFor();
  await snap('editor (empty)');
  screens[screens.length - 1].tools = await toolLabels();

  await pickFile('Media', 'landscape.mp4');
  await page.locator('.tl-row.main .clip').first().waitFor();
  await snap('after import');
  if (FIRST) throw new Error('first-run pass ends here');
  await selectClip(0);
  await snap('video selected', { kind: 'video' });
  await page.locator('.toolbar').evaluate((e) => { e.scrollLeft = e.scrollWidth; });
  await snap('video selected, toolbar end', { kind: 'video' });
  await page.locator('.toolbar').evaluate((e) => { e.scrollLeft = 0; });
  await walkTools('video', null, () => selectClip(0));

  await deselect();
  await snap('project tools', { kind: 'project' });
  await page.locator('.toolbar').evaluate((e) => { e.scrollLeft = e.scrollWidth; });
  await snap('project tools, toolbar end', { kind: 'project' });
  await page.locator('.toolbar').evaluate((e) => { e.scrollLeft = 0; });
  await walkTools('project');

  await deselect();
  await pickFile('Media', 'crowd.png');
  let i = await clipBy(/image/);
  if (i >= 0) { await selectClip(i); await snap('image selected', { kind: 'image' }); await walkTools('image', ['Crop']); }

  await deselect();
  await pickFile('Audio', 'beat120.m4a');
  i = await clipBy(/audio/);
  if (i >= 0) { await selectClip(i); await snap('audio selected', { kind: 'audio' }); await walkTools('audio', ['Beat', 'Volume']); }

  await deselect();
  await pickFile('Overlay', 'crowd.png');
  await snap('overlay added', { kind: 'overlay' });
  if (await page.locator('.tool-back').count()) await walkTools('overlay', ['Layers', 'Transform']);

  await deselect();
  const en = enTools.project;
  await tools().nth(en.indexOf('Text')).click();
  await page.waitForTimeout(600);
  await snap('text added', { kind: 'text' });
  await closeSheet();
  if (await page.locator('.tool-back').count()) { await snap('text selected', { kind: 'text' }); await walkTools('text', ['Edit text']); }

  await deselect();
  await page.locator('.tl-row.main .clip').first().click({ position: { x: 12, y: 12 }, force: true });
  await page.waitForTimeout(300);
  if (await page.locator('.tool-back').count()) { await tools().last().click(); await snap('select several'); await page.locator('.toolbar .tool').first().click(); }

  await deselect();
  await page.locator('.topbar .btn.primary').click();
  await page.waitForTimeout(600);
  await snap('export sheet');
  const cancel = page.getByRole('button', { name: /^(Cancel|Отмена|Отменить)$/ });
  if (await cancel.count() && await cancel.first().isVisible()) await cancel.first().click();
  await closeSheet();
  await page.locator('.topbar .icon-btn').first().click();
  await newProject.waitFor();
  await snap('home (with a project)');
} catch (e) {
  console.log(`stopped: ${e.message}`);
  await snap('where it stopped').catch(() => {});
}
fs.writeFileSync(path.join(OUT, 'data.json'), JSON.stringify({ locale: LOCALE, view: [W, H], errors, screens }));
console.log(`${screens.length} screens, ${errors.length} page errors → ${OUT}`);
await browser.close();
