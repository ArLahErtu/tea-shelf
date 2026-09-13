// sw.js
// Service Worker для PWA «Чайная полка» (редизайн v2)
// Стратегии:
//   навигация (страницы) — network-first с офлайн-фолбэком;
//   ассеты (css/js/img/шрифты) — stale-while-revalidate.
// ВАЖНО: при каждом деплое с изменением css/js поднимайте CACHE_VERSION,
// иначе клиенты останутся на старом кэше (баг «первая страница работает,
// следующие ломаются»).

const CACHE_VERSION = 'v5';
const CACHE_NAME = `tea-shelf-${CACHE_VERSION}`;

self.addEventListener('install', () => {
  // новый SW занимает место сразу, не ждёт закрытия вкладок
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // сносим все кэши старых версий (v4 и ниже)
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith(self.location.origin)) return;

  // ---------- страницы: network-first ----------
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(request);
        return cached || (await caches.match('/index.html'));
      }
    })());
    return;
  }

  // ---------- ассеты: stale-while-revalidate ----------
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    const network = fetch(request)
      .then((res) => {
        if (res && res.status === 200) cache.put(request, res.clone());
        return res;
      })
      .catch(() => null);

    if (cached) return cached;          // мгновенно из кэша, обновление фоном
    const res = await network;          // первый запрос — из сети
    if (res) return res;
    return new Response('Офлайн режим: ресурс недоступен', { status: 503, statusText: 'Offline' });
  })());
});