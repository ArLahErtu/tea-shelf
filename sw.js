// sw.js
// Service Worker для PWA «Чайная полка»
// Стратегия: Cache-first (сначала из кэша) + Network fallback (сеть, если нет в кэше)

const CACHE_VERSION = 'v2';
const CACHE_NAME = `tea-shelf-${CACHE_VERSION}`;

// Список всех статических файлов, которые нужны для работы сайта
const STATIC_ASSETS = [
  // Основные страницы
  '/',
  '/index.html',
  '/catalog.html',
  '/shelf.html',
  '/profile.html',
  '/privacy.html',
  
  // Системные файлы
  '/manifest.webmanifest',
  '/robots.txt',
  '/sitemap.xml',

  // Иконки
  '/img/favicon.svg',
  '/img/icon-192.png',
  '/img/icon-512.png',

  // Стили (CSS)
  '/css/base.css',
  '/css/components.css',
  '/css/chatbot.css',
  '/css/pages/index.css',
  '/css/pages/catalog.css',
  '/css/pages/shelf.css',
  '/css/pages/profile.css',

  // Скрипты (JS)
  '/js/main.js',
  '/js/catalog.js',
  '/js/shelf.js',
  '/js/common.js',
  '/js/auth.js',
  '/js/supabaseClient.js',
  '/js/config.js',
  '/js/ui.js',
  '/js/teaModal.js',
  '/js/amountModal.js',
  '/js/chatbot.js',
  '/js/chatbotHTML.js',
  '/js/notifications.js',
  '/js/tisanes.js',
  '/js/unknowns.js',
  '/js/profile.js'
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
              return caches.match('/index.html');
            }
            // Для остальных ресурсов отдаем системный ответ "Нет сети"
            return new Response('Офлайн режим: ресурс недоступен', { status: 503, statusText: 'Offline' });
          });
      })
  );
});