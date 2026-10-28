// What kind of device and browser this is, for the few places that must behave differently.

/** Any iPhone or iPad browser (all of them are WebKit; iPadOS asks for the desktop site and says "MacIntel"). */
export const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Opened from the Home Screen as an app, not in a browser tab. */
export const standalone = (): boolean =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
