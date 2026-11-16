// Android "Share → Kadr" (docs/08 B). The installed PWA receives shared files as a multipart POST to ./share-target:
// they are parked in Cache Storage and the app opens at #/share, which imports them. Only this POST is handled here;
// everything else stays with the Workbox service worker that imports this script.
/**
 * A share from Android is a navigation the browser starts: it carries no foreign Origin. A form on another site that
 * posts here does (audit V-235): it could put its own file into a person's projects without a word. Such a request
 * opens the app and stores nothing. A page with an opaque origin (a sandboxed frame) sends "null", as a real share may:
 * telling those apart needs the headers of a real Android share, which no test stand has seen yet.
 * WebKit hands the service worker no Origin at all, only the referrer: there the other site's page is known by it
 * (SW-D-10 — the form's file was parked, and only a file the import refused kept it out of a project). A share from
 * an app has no web page behind it (no referrer, or android-app://).
 */
function fromAnotherSite(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null' && origin !== self.location.origin) return true;
  try {
    const from = new URL(request.referrer);
    return (from.protocol === 'http:' || from.protocol === 'https:') && from.origin !== self.location.origin;
  } catch {
    return false; // no referrer
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== new URL('share-target', self.registration.scope).pathname) return;
  if (fromAnotherSite(event.request)) {
    event.respondWith(Response.redirect(new URL('./', self.registration.scope).href, 303));
    return;
  }
  event.respondWith((async () => {
    let count = 0;
    try {
      const form = await event.request.formData();
      const files = form.getAll('media').filter((f) => typeof f !== 'string');
      const cache = await caches.open('kadr-share');
      for (const key of await cache.keys()) await cache.delete(key);
      for (const f of files) {
        await cache.put(new URL(`shared/${count++}`, self.registration.scope).href, new Response(f, {
          headers: { 'content-type': f.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(f.name || `shared-${count}`) },
        }));
      }
    } catch { /* an empty share still opens the app */ }
    return Response.redirect(new URL(`./?shared=${count}#/share`, self.registration.scope).href, 303);
  })());
});
