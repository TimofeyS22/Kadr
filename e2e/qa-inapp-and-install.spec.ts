// In-app browsers (audit V-203): opened from a link inside Instagram and the like, Kadr says at once that this browser
// cannot save a video and hands over the link to open in the phone's own browser, on Home and before an export.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

const INSTAGRAM_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22F76 Instagram 385.0.0.26.83 (iPhone15,4; iOS 18_5; en_US; en; scale=3.00; 1179x2556; 742461693)';
const INSTAGRAM_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36 Instagram 344.0.0.33.102 Android (34/14; 420dpi; 1080x2205; Google/google; Pixel 7; panther; panther; en_US; 628475713)';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.iosFormatCard.v1', '1'); // on an iPhone the format card comes before the first pick (D-10)
  });
});

const notice = (page: Page) => page.getByRole('note').filter({ hasText: 'built-in browser' });
const advice = (page: Page) => page.getByRole('note').filter({ hasText: 'Home Screen' });

async function home(page: Page) {
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
}
/** A project with one video, made the way a person makes it. */
async function projectWithVideo(page: Page) {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles([fx('landscape.mp4')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const close = page.getByRole('button', { name: 'Close tools' });
  if (await close.isVisible()) await close.click();
}
async function backHome(page: Page, projects: number) {
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await expect(page.locator('.project-card')).toHaveCount(projects);
}

/** At 375 px nothing scrolls sideways, and every button of the notice is a 44 px touch target. */
async function fitsPhone(page: Page, box: ReturnType<typeof notice>) {
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth), 'no sideways scroll').toBeLessThanOrEqual(0);
  const rect = (await box.boundingBox())!;
  expect(rect.x, 'inside the screen on the left').toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width, 'inside the screen on the right').toBeLessThanOrEqual(375);
  for (const b of await box.getByRole('button').all()) expect((await b.boundingBox())!.height, await b.innerText()).toBeGreaterThanOrEqual(44);
}

test.describe('Instagram on an iPhone', () => {
  test.use({ userAgent: INSTAGRAM_IPHONE, viewport: { width: 375, height: 812 } });

  test('Home says this browser cannot save and copies the link; it stays until dismissed, for the session', async ({ page, context, browserName, baseURL }) => {
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await home(page);
    const box = notice(page);
    await expect(box).toBeVisible();
    await expect(box).toContainText('This is the built-in browser of Instagram: it cannot save videos. Open Kadr in Safari.');
    await fitsPhone(page, box);
    // It does not block the app.
    await page.getByRole('button', { name: 'New project' }).click();
    await expect(page.locator('.aspect-card').first()).toBeVisible();
    await page.getByRole('dialog', { name: 'Frame format' }).getByRole('button', { name: 'Close' }).click(); // a sheet since Chetko Ч4 release 2

    await box.getByRole('button', { name: 'Copy link' }).click();
    await expect(box.getByRole('button', { name: 'Link copied' })).toBeVisible();
    // WebKit gives a page the clipboard only through the system's Paste bubble, so there the confirmation is the proof.
    if (browserName === 'chromium') expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(new URL('./', baseURL).href);
    await fitsPhone(page, box);

    await page.reload();
    await expect(box, 'still there after a reload').toBeVisible();
    await box.getByRole('button', { name: 'Got it' }).click();
    await expect(box).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
    await expect(box, 'dismissed for the session').toHaveCount(0);
  });

  for (const [how, clipboard] of [
    ['missing', () => { Object.defineProperty(navigator, 'clipboard', { value: undefined }); }],
    ['refusing', () => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')) } }); }],
  ] as const) {
    test(`a ${how} clipboard: the link is shown, selected, and said to be copied only when it was`, async ({ page, baseURL }) => {
      await page.addInitScript(clipboard);
      await page.addInitScript(() => {
        // What the page hands to the clipboard the old way (document.execCommand), to hold the confirmation to it.
        (window as unknown as { __copied: string[] }).__copied = [];
        document.addEventListener('copy', () => (window as unknown as { __copied: string[] }).__copied.push(String(getSelection())));
      });
      await home(page);
      const box = notice(page);
      await box.getByRole('button', { name: 'Copy link' }).click();
      const field = box.getByRole('textbox', { name: 'Link to Kadr' });
      await expect(field).toBeVisible();
      const link = new URL('./', baseURL).href;
      await expect(field).toHaveValue(link);
      await expect(field).toBeFocused();
      expect(await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, link.length]);
      // Either the old way copied it and Kadr says so, or Kadr says how to copy it by hand: never a false "copied".
      const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
      if (copied.length) await expect(box.getByRole('button', { name: 'Link copied' })).toBeVisible();
      else {
        await expect(box).toContainText('Press and hold the link to copy it.');
        await expect(box.getByRole('button', { name: 'Link copied' })).toHaveCount(0);
      }
      await fitsPhone(page, box);
    });
  }

  test('the export sheet warns before anything is rendered, and after the file is made', async ({ page, context, browserName }) => {
    test.setTimeout(240_000);
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await home(page);
    await projectWithVideo(page);
    // Quick export is on for a new person: here it must not start by itself and spend minutes on a file that cannot be saved.
    await page.getByRole('button', { name: 'Export' }).first().click();
    const sheet = page.locator('.sheet');
    const box = sheet.getByRole('note').filter({ hasText: 'built-in browser' });
    await expect(box).toBeVisible();
    await expect(box).toContainText('This is the built-in browser of Instagram: it cannot save videos. Open Kadr in Safari.');
    await expect(sheet.getByRole('button', { name: 'Export video' })).toBeVisible();
    await expect(sheet.getByRole('progressbar')).toHaveCount(0);
    await expect(sheet.locator('.ck-primary'), 'one white button: the way out, not a file that cannot be saved here').toHaveText('Copy link');
    await expect(box.getByRole('button', { name: 'Got it' }), 'the warning in the sheet cannot be waved away').toHaveCount(0);
    await fitsPhone(page, box);
    await box.getByRole('button', { name: 'Copy link' }).click();
    await expect(box.getByRole('button', { name: 'Link copied' })).toBeVisible();
    // The person exports anyway: the warning is next to the Save button that may do nothing here.
    await sheet.getByRole('radio', { name: 'Small file' }).click();
    await sheet.getByRole('button', { name: 'Export video' }).click();
    await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 180_000 });
    await expect(box).toBeVisible();
  });

  test('no advice to add Kadr to the Home Screen: a built-in browser cannot do it', async ({ page }) => {
    await home(page);
    await expect(page.getByText('No projects yet')).toBeVisible(); // the list is read: what Home shows is settled
    await expect(advice(page)).toHaveCount(0);
    await projectWithVideo(page);
    await backHome(page, 1);
    await expect(advice(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Install Kadr' })).toHaveCount(0);
    await expect(notice(page)).toBeVisible();
  });
});

test.describe('Instagram on Android', () => {
  test.use({ userAgent: INSTAGRAM_ANDROID });
  test('the notice names Chrome as the browser to open', async ({ page }) => {
    await home(page);
    await expect(notice(page)).toContainText('This is the built-in browser of Instagram: it cannot save videos. Open Kadr in Chrome.');
    await expect(page.getByRole('link', { name: /browser/i }), 'no "open in browser" link: not every app passes it on').toHaveCount(0);
  });
});

test('a browser of its own (Safari on iPhone, Chrome on Android): no notice, on Home or in the export sheet', async ({ page }) => {
  await home(page);
  await expect(notice(page)).toHaveCount(0);
  await projectWithVideo(page);
  await page.getByRole('button', { name: 'Export' }).first().click();
  await expect(page.locator('.sheet')).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
});

// The Home Screen advice on an iPhone (audit V-164): the app on the Home Screen has its own storage, so the advice says
// that the projects made in Safari stay in Safari, how many there are, and the way that moves one: a backup.
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const SHORT = 'iPhone erases a website’s data after 7 days without a visit. Add Kadr to the Home Screen and make your projects there: Share → Add to Home Screen.';

test.describe('Safari on an iPhone', () => {
  test.use({ userAgent: IPHONE_SAFARI, viewport: { width: 375, height: 812 } });

  test('no projects yet: the advice is short, and nothing is said about moving', async ({ page }) => {
    await home(page);
    const tip = advice(page);
    await expect(tip).toBeVisible();
    await expect(tip.locator('p')).toHaveText([SHORT]);
    await fitsPhone(page, tip);
    await expect(notice(page)).toHaveCount(0);
  });

  test('with projects: they stay in Safari, their number, and the backup that moves one; dismissed, it stays away', async ({ page }) => {
    await home(page);
    await projectWithVideo(page);
    await backHome(page, 1);
    const tip = advice(page);
    await expect(tip.locator('p')).toHaveText([SHORT, 'Projects made in Safari stay in Safari, and you have 1 here. To move one, save its backup here (↓), then tap “Restore backup” in the Home Screen app.']);
    // The two controls the advice names are on this screen.
    await expect(page.getByRole('button', { name: 'Restore backup' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Save a backup of / })).toHaveCount(1);
    await fitsPhone(page, tip);

    await page.getByRole('button', { name: 'New project' }).click();
    await page.locator('.aspect-card', { hasText: '9:16' }).click();
    await expect(page.locator('.preview-canvas')).toBeVisible();
    await backHome(page, 2);
    await expect(tip).toContainText('you have 2 here');

    await tip.getByRole('button', { name: 'Got it' }).click();
    await expect(tip).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.project-card')).toHaveCount(2);
    await expect(tip).toHaveCount(0);
  });

  test('the short advice, dismissed before there was anything to lose, is said in full once there is a project', async ({ page }) => {
    await home(page);
    const tip = advice(page);
    await tip.getByRole('button', { name: 'Got it' }).click();
    await expect(tip).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
    await expect(page.getByText('No projects yet')).toBeVisible();
    await expect(tip).toHaveCount(0);
    await projectWithVideo(page);
    await backHome(page, 1);
    await expect(tip).toContainText('you have 1 here');
  });

  test('opened from the Home Screen with an empty list: Kadr says where the Safari projects are and how to bring one', async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { value: true }); });
    await home(page);
    await expect(page.getByText('Projects made in Safari stay in Safari. To bring one here, open Kadr in Safari, save a backup of the project (↓), then tap “Restore backup” here.')).toBeVisible();
    await expect(advice(page), 'already on the Home Screen: no advice to add it').toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 'no sideways scroll').toBeLessThanOrEqual(0);
  });
});
