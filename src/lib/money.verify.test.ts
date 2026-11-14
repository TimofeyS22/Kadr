// Sweep lane E2 (docs/21 §4, `C-*` rows): invariant N8 of docs/16 — no paywall, no ads, no paid limits (C-A1, C-I3).
// Every string the interface can show is a key or a value of the Russian catalogue (i18n-coverage keeps it whole), so a
// paid screen, an upsell or an ad slot cannot reach a person without a word here. The bundle's dependencies carry no ad
// or payment SDK. The watermark half of N8 is held by the frame comparisons of the file with the preview (WYSIWYG e2e).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RU } from './locale-ru';

const PAID_EN = /\b(pro|premium|plus|subscri\w*|upgrade\w*|purchase\w*|buy|pricing|price\w*|trial|unlock\w*|paywall|paid|pay|watermark\w*|advert\w*|sponsor\w*|ads?)\b/i;
const PAID_RU = /(подписк|премиум|купит|покупк|оплат|платн|пробн\w* период|разблокир|тариф|водян\w* знак|реклам|спонсор)/i;
/** Strings that name money or ads only to say what is free; each with the reason it is allowed. */
const ALLOWED = new Map<string, string>([
  ['All tracks are public domain (CC0): use them anywhere, even in ads, with no credit. Added tracks work offline.', 'the licence of the music: free to use, also in ads'],
]);

describe('nothing to pay and no ads (docs/16 N8: C-A1, C-I3)', () => {
  it('no string of the interface sells, locks, limits for money or advertises', () => {
    const hits: string[] = [];
    for (const [en, ru] of Object.entries(RU)) {
      if (ALLOWED.has(en)) continue;
      if (PAID_EN.test(en) || PAID_RU.test(ru)) hits.push(en);
    }
    expect(hits).toEqual([]);
  });

  it('the bundle carries no ad, payment or tracking SDK', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    const sdk = /(^|[/@-])(ads?|admob|adsense|adservice|doubleclick|googletag|gtag|analytics|metrika|appodeal|ironsource|applovin|unity-ads|stripe|paddle|revenuecat|chargebee|lemonsqueezy|purchases?|billing|paywall)([/-]|$)/i;
    expect(Object.keys(pkg.dependencies).filter((d) => sdk.test(d))).toEqual([]);
  });
});
