// Offline shell (network first, fall back to cache) plus web-push display.
const CACHE = 'famcal-shell-v29';
const FILES = ['./', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'config.js', 'motd.js', 'quickadd.js', 'icons/icon-192.png', 'vendor/supabase-js-2.117.2.js'];
// Cache files one by one: a single missing file must never abort the install (addAll is all-or-nothing).
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(FILES.map(f => c.add(f))))));
// Older caches are dropped, including copies of family data that versions before v29 kept.
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))));
self.addEventListener('fetch', e => {
  // Only the app's own files. Everything else, above all the family's data from Supabase, goes straight to the network:
  // it's never kept on the phone, so it can't be shown stale or to whoever signs in next.
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // Revalidated every time: the host sends 7-day cache headers, which would otherwise keep phones on stale copies after
  // an update. Cheap when unchanged (304), and still falls back to the cache offline. Errors (a 404) are never cached.
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});

// Every push must show a notification (iOS revokes the subscription otherwise).
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch { /* malformed payload: show the fallback below */ }
  e.waitUntil(self.registration.showNotification(d.title || 'Trying My Best', {
    body: d.body || '', icon: 'icons/icon-192.png', tag: d.tag,
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const open = cs.find(c => 'focus' in c);
    return open ? open.focus() : clients.openWindow('./');
  }));
});
