// sw.js
// Service Worker PWA «Чайная полка» v2.1
// Cache-first + network fallback; навигация — network с офлайн-фолбэком.
// Прекаш только реально существующих файлов (addAll падает на 404).

const CACHE_VERSION = 'v5';
const CACHE_NAME = `tea-shelf-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  // страницы
  '/', '/index.html', '/catalog.html', '/shelf.html',
  '/journal.html', '/profile.html', '/privacy.html', '/404.html',

  // служебное
  '/manifest.webmanifest', '/robots.txt', '/sitemap.xml',

  // шрифты (самохост, immutable на практике)
  '/fonts/manrope-cyrillic.woff2', '/fonts/manrope-latin.woff2',
  '/fonts/prata-cyrillic.woff2', '/fonts/prata-latin.woff2',

  // иконки и фото
  '/img/favicon.svg', '/img/icon-192.png', '/img/icon-512.png',
  '/img/photo-gaiwan.jpg', '/img/photo-leaves.jpg',
  '/img/photo-cup.jpg', '/img/photo-jars.jpg',

  // стили (плоско)
  '/css/base.css', '/css/components.css', '/css/chat.css',
  '/css/index.css', '/css/catalog.css', '/css/shelf.css',
  '/css/journal.css', '/css/profile.css',

  // скрипты: корень композиции → core → features → pages
  '/js/app.js',
  '/js/core/config.js', '/js/core/supabase.js', '/js/core/ui.js',
  '/js/features/auth.js', '/js/features/gate.js', '/js/features/brew-timer.js',
  '/js/features/notifications.js', '/js/features/chat.js', '/js/features/chat-html.js',
  '/js/features/tea-modal.js', '/js/features/amount-modal.js',
  '/js/features/tisanes.js', '/js/features/unknowns.js',
  '/js/pages/index.js', '/js/pages/catalog.js', '/js/pages/shelf.js',
  '/js/pages/journal.js', '/js/pages/profile.js', '/js/pages/doc.js',
];

// Установка: скачиваем все файлы из списка в кэш браузера
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Открыт кэш, пре-кэширование статики:', CACHE_NAME);
        // Скачиваем файлы. Если один файл не загрузился, пишем ошибку, но не прерываем установку
        return Promise.all(
          STATIC_ASSETS.map((url) =>
            cache.add(url).catch((err) => {
              console.warn(`[SW] Не удалось закэшировать ${url}:`, err);
            })
          )
        );
      })
  );
  // Заставляем браузер сразу использовать новую версию скрипта
  self.skipWaiting();
});

// Активация: удаляем старые версии кэша, если они были
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Удаление старого кэша:', name);
            return caches.delete(name);
          })
      );
    })
  );
  // Берем контроль над всеми открытыми вкладками сразу
  self.clients.claim();
});

// Обработка запросов сети
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Игнорируем не-GET запросы (например, POST при отправке формы или сохранении чая)
  if (request.method !== 'GET') return;

  // Игнорируем запросы к сторонним API (Supabase, Метрика и т.д.)
  if (!request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        // Cache-first: если файл есть в кэше, отдаем его сразу (работает офлайн)
        if (cachedResponse) {
          return cachedResponse;
        }

        // Network fallback: если файла нет в кэше, идем за ним в интернет
        return fetch(request)
          .then((networkResponse) => {
            // Кэшируем новые успешные скачивания (картинки, шрифты, css, js)
            if (networkResponse && networkResponse.status === 200) {
              const isCacheable = request.destination === 'image' || 
                                  request.destination === 'style' || 
                                  request.destination === 'script' ||
                                  request.destination === 'font';
              
              if (isCacheable) {
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(request, responseToCache);
                });
              }
            }
            return networkResponse;
          })
          .catch(() => {
            // Если интернета нет и человек пытается перейти на другую страницу
            if (request.mode === 'navigate') {
              return caches.match('/404.html') || caches.match('/index.html');
            }
            // Для остальных ресурсов отдаем системный ответ "Нет сети"
            return new Response('Офлайн режим: ресурс недоступен', { status: 503, statusText: 'Offline' });
          });
      })
  );
});