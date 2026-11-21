/* sw.js — offline support for the university assistant.
   Put this file next to index.html (same folder in the GitHub repo).
   What it does:
   - Keeps a copy of the app (index.html, config.js) so it opens with no internet.
   - HTML and config.js are "network first": when you're online you always get the latest
     version from GitHub; the saved copy is used only when the network fails.
   - Keeps copies of the static libraries the app loads (PDF reader, fonts, Supabase SDK).
   - Never touches admin.html, Supabase data requests, or the AI (Gemini) requests:
     those always go straight to the network exactly as before.
   - Shows notifications and focuses the app when a notification is tapped. */

var VERSION = 'g22-v1';
var CORE = 'g22-core-' + VERSION;
var LIBS = 'g22-libs-' + VERSION;

var CORE_FILES = ['./', 'index.html', 'config.js'];
var LIB_FILES = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];
var LIB_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

function okToStore(res) {
  return res && (res.ok || res.type === 'opaque');
}

self.addEventListener('install', function (e) {
  e.waitUntil((async function () {
    var core = await caches.open(CORE);
    await Promise.all(CORE_FILES.map(function (u) {
      return fetch(u, { cache: 'reload' }).then(function (r) {
        if (r && r.ok) return core.put(u, r);
      }).catch(function () {});
    }));
    var libs = await caches.open(LIBS);
    await Promise.all(LIB_FILES.map(function (u) {
      return fetch(u, { mode: 'no-cors' }).then(function (r) {
        if (okToStore(r)) return libs.put(u, r);
      }).catch(function () {});
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.map(function (k) {
      if ((k.indexOf('g22-core-') === 0 || k.indexOf('g22-libs-') === 0) && k !== CORE && k !== LIBS) {
        return caches.delete(k);
      }
    }));
    await self.clients.claim();
  })());
});

async function networkFirst(req, fallbackKey) {
  var cache = await caches.open(CORE);
  try {
    var res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    var hit = await cache.match(req, { ignoreSearch: true });
    if (!hit && fallbackKey) hit = await cache.match(fallbackKey, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  var cache = await caches.open(LIBS);
  var hit = await cache.match(req);
  if (hit) return hit;
  var res = await fetch(req);
  if (okToStore(res)) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (x) { return; }

  if (url.origin === self.location.origin) {
    if (/\/admin\.html$/i.test(url.pathname)) return;
    if (req.mode === 'navigate') {
      e.respondWith(networkFirst(req, 'index.html'));
      return;
    }
    if (/\.(html|js)$/i.test(url.pathname) || url.pathname.slice(-1) === '/') {
      e.respondWith(networkFirst(req));
      return;
    }
    e.respondWith(networkFirst(req));
    return;
  }

  if (LIB_HOSTS.indexOf(url.hostname) !== -1) {
    e.respondWith(cacheFirst(req));
  }
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil((async function () {
    var list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (var i = 0; i < list.length; i++) {
      if ('focus' in list[i]) return list[i].focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  })());
});
