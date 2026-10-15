// Android "Share → Kadr" (docs/08 B). The installed PWA receives shared files as a multipart POST to ./share-target:
// they are parked in Cache Storage and the app opens at #/share, which imports them. Only this POST is handled here;
// everything else stays with the Workbox service worker that imports this script.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== new URL('share-target', self.registration.scope).pathname) return;
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
