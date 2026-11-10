/* Service Worker بسيط: يخلّي البرنامج يفتح بدون إنترنت.
   استراتيجية: الشبكة أولاً، ولو مفيش إنترنت يرجع للنسخة المخزّنة (فمفيش مشكلة تحديثات قديمة). */
const CACHE = 'elhady-v3.0.0';
const FILES = ['./', 'index.html', 'style.css', 'js/store.js', 'js/receipt.js', 'js/app.js', 'manifest.webmanifest', 'assets/logo.png', 'assets/favicon.png', 'assets/icon-192.png', 'assets/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
