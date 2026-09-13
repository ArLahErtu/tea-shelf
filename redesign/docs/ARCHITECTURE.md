# Архитектура «Чайной полки» v2.1

Документ описывает структуру репозитория, слои зависимостей, точки входа, DOM-контракты,
потоки данных и производительность. Аудит обоснований — `docs/AUDIT.md`.

## 1. Слои репозитория

```
/  publish-корень (Vercel, пресет Other)
├── *.html            страницы: index catalog shelf journal profile privacy 404
├── sw.js             service worker (precache v5, cache-first)
├── vercel.json       политики Cache-Control
├── manifest.webmanifest robots.txt sitemap.xml
├── google….html yandex….html   верификации площадок (обязаны быть в корне)
├── css/              плоско: base · components · chat · <страница>.css
├── js/
│   ├── app.js        корень композиции: initCommon() для всех страниц
│   ├── core/         config.js · supabase.js · ui.js          (без домена)
│   ├── features/     auth gate brew-timer notifications chat chat-html
│   │                 tea-modal amount-modal tisanes unknowns  (домен, только → core)
│   └── pages/        index catalog shelf journal profile doc  (оркестрация, → core+features)
├── fonts/            manrope/prata woff2 (cyrillic+latin, самохост, OFL)
├── img/              иконки PWA, фото лендинга
└── docs/             ARCHITECTURE · REDESIGN · UIUX_REVIEW · AUDIT
```

### Правила зависимостей (линтуются)

| Слой | Может импортировать | Не может |
|---|---|---|
| `core/` | ничего локального, кроме соседей по core | features, pages |
| `features/` | `core/`, файлы своей фичи (`chat → chat-html`) | pages, чужие фичи* |
| `pages/` | `core/`, `features/` | другие pages |
| `app.js` | core + features | pages |

\* исключение историческое и единственное: `pages/shelf.js` использует `features/tisanes.js`
и `features/unknowns.js` — это фичи, не страницы, правило не нарушено.
Нарушений на момент аудита: **0**.

Баррелей, прокси-модулей и динамических `import()` нет: граф страницы — звезда
«page → {core, features}», глубина ≤2, каждый файл запрашивается напрямую.

## 2. Точки входа

| Страница | Модуль | CSS | Роль |
|---|---|---|---|
| index.html | pages/index.js | index.css | лонгрид гостей, топ-6 каталога, авто-вход при `?next=` |
| catalog.html | pages/catalog.js | catalog.css | каталог, модерация, заявки (публичен) |
| shelf.html | pages/shelf.js | shelf.css | полка, покупки, избранное, архив, заваривание |
| journal.html | pages/journal.js | journal.css | лента журнала, фильтры, архив |
| profile.html | pages/profile.js | profile.css | фото, безопасность, уведомления, план |
| privacy.html | pages/doc.js | — (components) | документ |
| 404.html | — | base+components | статика |

Каждая страница: `await initCommon()` из `app.js` → статус БД → `initAuth()` →
`initGate()` → модалка количества → чат + триггеры → FAB → cookie-гейт → SW.

## 3. Head-контракт (генерируется сборщиком)

- `preload` кириллических woff2 (Manrope + Prata) с `crossorigin`;
- `preconnect` к `https://zpcajyjrrzksrymygeck.supabase.co` и `https://cdn.jsdelivr.net`;
- css: `base → components → chat → <страница>`;
- `modulepreload` для транзитивного графа модулей страницы (считается сборщиком из
  импортов, поэтому не расходится с кодом);
- `theme-color`, OG/Twitter, canonical, ld+json, Vercel Insights (defer).

## 4. DOM-контракты

Разметка содержит id, которые ждут боевые модули; создаваемые js-ом оверлеи
(таймер, выбор чая, подтверждения, чат, cookie) в разметке не нужны.
Полный список проверяет `work/check.py` (id из HTML ∪ id из js-шаблонов против
`$('#…')`/`getElementById` транзитивных импортов страницы).

- features/auth.js: `authOpen, userArea, avatarBtn, userMenu, userEmail, openModerationBtn,
  logoutBtn, authOverlay, authForm, tabLogin, tabRegister, field*, auth*, authError, authClose`
- pages/shelf.js: `shelfGrid, shelfSearch, shelfTypeFilter, shelfSort, countAll, countLow,
  stat*, shelfBanner*, favorites*, moderation*, openArchiveBtn, openJournalArchiveBtn,
  shelfSeg, seg-shelf/shop/fav, shoppingInline, brewOverlay(+brew*), teaOverlay(+tea*),
  journalOverlay(+journalOv*), amountOverlay(+amount*), archiveOverlay(+archive*),
  шаблоны shelfCard/shoppingRow/favoritesRow/moderationRow/archiveRow/journalEntry`
- pages/catalog.js: `catalogSearch, catalogTypeFilter, catalogSort, typeChips, catalogGrid,
  moreWrap, moreBtn, modeSwitch, pendingCount, propose/editTea/moderate/reject Overlay,
  teaCardTemplate`
- pages/profile.js: `profileGuest, profileContent, profileEmail, profileSince, profileAvatar,
  avatarBtnUpload, avatarInput, passwordForm, emailForm, deleteAccountBtn,
  notifyEmailSwitch, notifyTelegramSwitch, aiBar, aiBarWrap, aiLimitText`
- pages/journal.js: `journalFeed, journalSearch, journalTeaFilter, journalRatingChips,
  journalCount, jStat*, openJournalArchiveBtn`
- app.js: `brewFab` и `[data-open-chat]` — опциональны, `toasts` — обязателен.

## 5. Потоки

### Авторизация и «две страницы» (features/gate.js)
гость: index — работает; shelf/journal/profile → `replace(index.html?next=…)`;
вошёл: index → `replace(next || shelf.html)`; catalog/privacy публичны всегда.

### Заваривание (features/brew-timer.js)
`[data-action="brew"] / FAB / [data-brew-choose]` → офер «Да/Нет» →
«Да»: режимы «Проливы·гунфу» (первый пролив = верх границы `time` карточки, шаг +15 сек,
минутные карточки +30 сек) / «Настоем» (120/180/240 сек); «Нет»/«Готово» → `openBrew(row)`
(brewOverlay → RPC `brew_tea`). Закрытие оверлея гасит интервал (MutationObserver).

### Данные и офлайн
- полка хранит снапшот в localStorage и показывает его при сетевой ошибке;
- журнал: `brew_journal` + `brew_journal_archive`, имена из `tea_catalog`,
  `user_tisanes(tisane_catalog(name))`, `unknown_teas`;
- фото: карточки — bucket фото каталога; аватар — `user-avatars` → `profiles.avatar_url`;
- аналитика: Метрика только после согласия, Vercel Insights всегда, цели через `trackEvent`.

## 6. Производительность (итоги, детали в AUDIT.md)

- Запросов на страницу: 10–20 (было 8–25), глубина графа модулей ≤2 (было до 4).
- Сторонних render-blocking origin: 0 (шрифты самохост); данные — 2 preconnect’а.
- Кэш: шрифты immutable 1 год; css/js/img — 1 день + SWR 7 дней; html/sw — must-revalidate.
- SW v5: офлайн-статику и снапшот полки; список прекэша = фактические файлы.
- Изображения: явные размеры (нет CLS), lazy ниже фолда, `fetchpriority="high"` у LCP.

## 7. Соглашения

- Имена: страницы — как html; фичи — kebab-case; css — как страница или сущность.
- Комментарии и интерфейс — русские; логи — `[модуль] сообщение`.
- Модалка: `.overlay > .modal` + `wireOverlay`; Esc закрывает всё из `app.js`.
- Тосты — `showToast`, подтверждения — `askConfirm` (удаление аккаунта — двойное).
- Новая разметка без инлайн-стилей, кроме одноразовых паддингов; иконки — inline SVG
  с `aria-hidden`, текстовые подписи там, где действие необратимо или неочевидно.
