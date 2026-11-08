// If the app's code does not start, the person gets words and a way out instead of an empty page (audit V-111). Kept
// outside the bundle on purpose: this has to run when the bundle cannot, and the page's CSP allows no inline script.
(function () {
  var ru = /^ru/i.test(navigator.language || '');
  function show() {
    var root = document.getElementById('root');
    if (!root || root.childElementCount || document.getElementById('boot-failed')) return;
    var box = document.createElement('div');
    box.id = 'boot-failed';
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;background:#161616;color:#fff;font:16px/1.4 system-ui,sans-serif;text-align:center';
    var text = document.createElement('p');
    text.textContent = ru ? 'Kadr не запустился: версия на устройстве не загрузилась. Ваши проекты не тронуты.' : 'Kadr did not start: this version did not load. Your projects are safe.';
    var button = document.createElement('button');
    button.textContent = ru ? 'Загрузить заново' : 'Load again';
    button.style.cssText = 'min-height:44px;padding:0 24px;border:0;border-radius:12px;background:#fff;color:#161616;font:inherit';
    button.onclick = function () {
      // The stored copy of the app goes, so the next load comes from the network; downloaded speech models stay.
      var sw = navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(function (l) { return Promise.all(l.map(function (r) { return r.unregister(); })); }) : Promise.resolve();
      var app = window.caches ? caches.keys().then(function (l) { return Promise.all(l.filter(function (k) { return /precache|workbox/.test(k); }).map(function (k) { return caches.delete(k); })); }) : Promise.resolve();
      Promise.all([sw, app]).catch(function () { /* reload anyway */ }).then(function () { location.reload(); });
    };
    box.appendChild(text);
    box.appendChild(button);
    document.body.appendChild(box);
    // The app may still arrive late on a slow network: then the message goes and nothing was lost.
    var watch = setInterval(function () { if (root.childElementCount) { clearInterval(watch); box.remove(); } }, 500);
  }
  // The code failed to load (seen at once), or loaded and threw before drawing anything (seen once the page has settled).
  window.addEventListener('error', function (e) { if (e.target && e.target.tagName === 'SCRIPT') setTimeout(show, 300); }, true);
  window.addEventListener('load', function () { setTimeout(show, 8000); });
})();
