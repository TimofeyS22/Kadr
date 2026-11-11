// Font pairs go out switched off (docs/18 §1): `?pairs` in the address turns them on in this browser and keeps them on
// (a pilot opens the link once, then the app from the home screen); `?pairs=0` turns them off again.
const KEY = 'kadr.pairs.v1';

export function pairsOn(): boolean {
  const asked = new URLSearchParams(location.search).get('pairs');
  try {
    if (asked === '0') localStorage.removeItem(KEY);
    else if (asked !== null) localStorage.setItem(KEY, '1');
    return localStorage.getItem(KEY) === '1';
  } catch {
    return asked !== null && asked !== '0'; // storage blocked: the address alone decides
  }
}
