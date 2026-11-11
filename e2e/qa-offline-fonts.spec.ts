// Offline, every face a text or caption style can pick is there from the first visit (D-16, the owner's choice of
// 2026-11-11): a style never used before is drawn with its own face, in the preview and in the file. Before, the
// service worker kept the interface's fonts up front and the others only once used, so offline they fell back to
// another face without a word, and the captions sheet asked for ~38 of them that had nowhere to come from.
import { expect, test } from '@playwright/test';
import { switchableNetwork } from './network';

test.use({ serviceWorkers: 'allow' });

test('offline, every font a style can pick is there from the first visit (D-16)', async ({ page, context, baseURL, browserName }) => {
  test.skip(!!process.env.E2E_URL?.includes('localhost:51'), 'dev server has no service worker');
  test.skip(!baseURL?.startsWith('http://'), 'the network is taken away through a local proxy (e2e/network.ts)');
  const net = await switchableNetwork(baseURL!);
  await page.goto(net.url);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; }); // installed: its precache is complete
  await page.reload(); // controlled from now on
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  net.off();
  // Chromium also knows it is offline; WebKit's emulation would block more than a phone without a network does.
  if (browserName === 'chromium') await context.setOffline(true);
  const fonts = await page.evaluate(async () => {
    const urls = new Set<string>();
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        for (const m of rule.style.getPropertyValue('src').matchAll(/url\("?([^")]+\.woff2)"?\)/g)) urls.add(new URL(m[1], sheet.href ?? location.href).href);
      }
    }
    const missing: string[] = [];
    await Promise.all([...urls].map(async (u) => {
      try { if (!(await fetch(u)).ok) missing.push(u); } catch { missing.push(u); }
    }));
    return { declared: urls.size, missing: missing.map((u) => u.split('/').pop()).sort() };
  });
  console.log(`faces declared ${fonts.declared}, missing offline ${fonts.missing.length} (${browserName})`);
  expect(fonts.declared, 'the faces the styles declare').toBeGreaterThan(100);
  expect(fonts.missing, 'faces that do not load without a network').toEqual([]);
  await context.setOffline(false);
  await net.close();
});
