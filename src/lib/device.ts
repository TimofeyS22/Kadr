// What kind of device and browser this is, for the few places that must behave differently.

/** Any iPhone or iPad browser (all of them are WebKit; iPadOS asks for the desktop site and says "MacIntel"). */
export const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * WebKit: Safari, and every iPhone and iPad browser. Its WebGL takes a 2D canvas by copying it back through the CPU,
 * while Chromium shares it on the GPU (measured 2026-10-30: ~11 ms per 1080p layer per frame in WebKit, under 0.1 ms
 * in Chromium).
 */
export const WEBKIT = IOS || (/AppleWebKit\//.test(navigator.userAgent) && !/Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent));

/** Opened from the Home Screen as an app, not in a browser tab. */
export const standalone = (): boolean =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** An app's built-in browser: `app` is its name where the user agent gives it, `browser` is the phone's own browser to open instead. */
export interface InApp { app: string | null; browser: 'Safari' | 'Chrome' | null }

// The first match names the app, so the apps come before the bare web view (Instagram on Android carries "; wv)" too).
// The VK tokens are the ones its apps send to VK's own servers; that its browser also shows them to a page is not
// verified (on Android the web view mark catches it either way, without the name).
const IN_APPS: [RegExp, string | null][] = [
  [/\bInstagram\b/, 'Instagram'],
  [/\bFB(?:AN|_IAB)\/(?:Messenger|MESSENGER|Orca)/, 'Messenger'],
  [/\bFB(?:AN|AV|_IAB)\//, 'Facebook'],
  [/musical_ly|BytedanceWebview|\btrill_|\bAppName\/trill\b/, 'TikTok'],
  [/\bVKAndroidApp\b|\bcom\.vk\.vkclient\b/, 'VK'],
  [/\bLine\//, 'LINE'],
  [/Snapchat/, 'Snapchat'],
  [/\bTelegram\b/, 'Telegram'],
  [/; wv\)/, null], // any Android app that shows the page in a web view
];

const ownBrowser = (ua: string): InApp['browser'] => (/iPhone|iPad|iPod/.test(ua) ? 'Safari' : /Android/.test(ua) ? 'Chrome' : null);

/**
 * The app whose built-in browser sent this user agent, or null for a browser of its own (audit V-203). In such a
 * browser a file cannot be saved, nothing works offline and the site cannot be installed, so Kadr sends the person to
 * the phone's own browser.
 *
 * What a user agent cannot tell:
 * - Telegram on an iPhone opens links with a plain Safari user agent (a Safari view controller, or its own browser
 *   that calls itself Safari): it is not detected at all;
 * - Telegram on Android takes the web view mark out and names itself only in mini apps ("Telegram-Android"); its
 *   browser is told by the objects it adds to the page instead (IN_APP below);
 * - an iPhone app that shows the page in a web view and adds no name of its own;
 * - which app an Android web view belongs to when the app adds no name: then `app` is null.
 */
export function inAppBrowser(ua: string): InApp | null {
  const found = IN_APPS.find(([re]) => re.test(ua));
  return found ? { app: found[1], browser: ownBrowser(ua) } : null;
}

// Telegram's browser and mini apps add one of these to every page before the page's scripts run.
const TELEGRAM_OBJECTS = ['TelegramWebview', 'TelegramWebviewProxy', 'TelegramWebviewProxyProto'];

/** The in-app browser this page is open in, or null. */
export const IN_APP: InApp | null = inAppBrowser(navigator.userAgent)
  ?? (typeof window !== 'undefined' && TELEGRAM_OBJECTS.some((k) => k in window) ? { app: 'Telegram', browser: ownBrowser(navigator.userAgent) } : null);
