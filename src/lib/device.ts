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
