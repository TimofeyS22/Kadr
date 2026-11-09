import { describe, expect, it } from 'vitest';
import { inAppBrowser } from './device';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const ANDROID_WV = 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36';

describe('inAppBrowser: an app’s built-in browser by its user agent (audit V-203)', () => {
  it.each([
    ['Instagram, iPhone', `${IPHONE} Mobile/22F76 Instagram 385.0.0.26.83 (iPhone15,4; iOS 18_5; en_US; en; scale=3.00; 1179x2556; 742461693)`, 'Instagram', 'Safari'],
    ['Instagram, Android', `${ANDROID_WV} Instagram 344.0.0.33.102 Android (34/14; 480dpi; 1080x2115; samsung; SM-S918B; dm3q; qcom; en_US; 628475713)`, 'Instagram', 'Chrome'],
    ['Facebook, iPhone (FBAN, FBAV)', `${IPHONE} Mobile/22F76 [FBAN/FBIOS;FBAV/521.0.0.37.97;FBBV/751869330;FBDV/iPhone15,4;FBMD/iPhone;FBSN/iOS;FBSV/18.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5;FBRV/753524610]`, 'Facebook', 'Safari'],
    ['Facebook, Android (FB_IAB)', `${ANDROID_WV} [FB_IAB/FB4A;FBAV/476.0.0.49.74;IABMV/1;]`, 'Facebook', 'Chrome'],
    ['Facebook, an old Android build with FBAV alone', 'Mozilla/5.0 (Linux; Android 11; Redmi Note 8 Build/RKQ1.201004.002) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Mobile Safari/537.36 FBAV/345.0.0.34.118', 'Facebook', 'Chrome'],
    ['Messenger, iPhone', `${IPHONE} Mobile/22F76 [FBAN/MessengerForiOS;FBAV/470.0.0.31.105;FBBV/615467221;FBDV/iPhone15,4;FBMD/iPhone;FBSN/iOS;FBSV/18.5;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/5]`, 'Messenger', 'Safari'],
    ['Messenger, Android', `${ANDROID_WV} [FB_IAB/MESSENGER;FBAV/470.0.0.20.107;]`, 'Messenger', 'Chrome'],
    ['TikTok, iPhone (musical_ly)', `${IPHONE} Mobile/15E148 musical_ly_35.3.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US isDarkMode/1 WKWebView/1 RevealType/Dialog BytedanceWebview/d8a21c6 FalconTag/9C2A3A5B-3C3E-4F0B-9E0B-6B2E3D1B7A11`, 'TikTok', 'Safari'],
    ['TikTok, Android outside the US (trill)', `${ANDROID_WV} trill_2023503040 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/trill app_version/35.3.4 ByteLocale/ru-RU ByteFullLocale/ru-RU Region/KZ AppId/1180 Spark/1.5.8.3 AppVersion/35.3.4 BytedanceWebview/d8a21c6`, 'TikTok', 'Chrome'],
    ['TikTok, only the web view of its maker (BytedanceWebview)', `${IPHONE} Mobile/15E148 BytedanceWebview/d8a21c6`, 'TikTok', 'Safari'],
    ['VK, Android', `${ANDROID_WV} VKAndroidApp/8.93-23301 (Android 14; SDK 34; arm64-v8a; samsung SM-S918B; ru; 2316x1080)`, 'VK', 'Chrome'],
    ['VK, iPhone', `${IPHONE} Mobile/15E148 com.vk.vkclient/5121 (iPhone, iOS 18.5, iPhone15,4, Scale/3.0)`, 'VK', 'Safari'],
    ['LINE, iPhone', `${IPHONE} Mobile/15E148 Safari Line/15.9.0`, 'LINE', 'Safari'],
    ['LINE, Android', `${ANDROID_WV} Line/15.9.1/IAB`, 'LINE', 'Chrome'],
    ['Snapchat, iPhone', `${IPHONE} Version/18.5 Mobile/15E148 Snapchat/13.42.0.42 (like Safari/8621.2.5.10.10, panda)`, 'Snapchat', 'Safari'],
    ['Snapchat, Android', `${ANDROID_WV}Snapchat13.42.0.47 (SM-S918B; Android 14#S918BXXS6CXK1#34; gzip; )`, 'Snapchat', 'Chrome'],
    ['Telegram mini app, Android (its browser hides the web view mark)', 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.103 Mobile Safari/537.36 Telegram-Android/11.4.2 (Samsung SM-S918B; Android 14; SDK 34; HIGH)', 'Telegram', 'Chrome'],
    ['an Android app that adds no name (the web view mark)', ANDROID_WV, null, 'Chrome'],
    ['Facebook on a computer: no phone browser to name', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) [FBAN/FBMAC;FBAV/1.0]', 'Facebook', null],
  ])('%s', (_name, ua, app, browser) => {
    expect(inAppBrowser(ua)).toEqual({ app, browser });
  });

  it.each([
    ['Safari, iPhone', `${IPHONE} Version/18.5 Mobile/15E148 Safari/604.1`],
    ['Safari, iPhone, iOS 26', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'],
    ['Safari, iPad asking for the desktop site', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'],
    ['Chrome, iPhone', `${IPHONE} CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1`],
    ['Chrome, Android', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36'],
    ['Chrome, Android, before the short user agent', 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.5481.153 Mobile Safari/537.36'],
    ['Yandex Browser, Android', 'Mozilla/5.0 (Linux; arm_64; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.253 YaBrowser/24.7.4.253.00 SA/3 Mobile Safari/537.36'],
    ['Yandex Browser, iPhone', `${IPHONE} Version/18.5 YaBrowser/24.7.5.652.10 SA/3 Mobile/15E148 Safari/604.1`],
    ['Samsung Internet', 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36'],
    ['Firefox, Android', 'Mozilla/5.0 (Android 14; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0'],
    ['Firefox, iPhone', `${IPHONE} FxiOS/140.0 Mobile/15E148 Safari/605.1.15`],
    ['Edge, Android', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36 EdgA/138.0.0.0'],
    ['Kadr from the Home Screen of an iPhone (no "Safari" in it)', `${IPHONE} Mobile/15E148`],
    ['Telegram on an iPhone: a plain Safari user agent, which is why it cannot be told', `${IPHONE} Version/18.5 Mobile/15E148 Safari/604.1`],
    ['Chrome on a computer', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'],
  ])('a browser of its own is not one: %s', (_name, ua) => {
    expect(inAppBrowser(ua)).toBeNull();
  });
});
