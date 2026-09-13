# Архитектура «Чайной полки» v2

Документ описывает, как устроен фронтенд после редизайна: точки входа, поток
авторизации, контракты DOM между разметкой и js-модулями, данные и офлайн.

## 1. Слои

```
HTML-страницы  — каркас страницы + функциональные оверлеи/темплейты (id-контракт)
css/           — base (токены, шапка, таб-бар) → components (блоки) → pages/* (страницы)
js/            — ES-модули без сборщика; CDN supabase-js через jsDelivr
Supabase       — Postgres + Auth + RLS + Storage + RPC + Edge Function ai-assistant
Vercel         — статика, /_vercel/insights, 404
```

Сборщиков нет: страница подключает `<script type="module" src="js/<page>.js">`,
дальше граф импортов тянет остальное.

## 2. Точки входа страниц

| Страница | Модуль | Роль |
|---|---|---|
| index.html | main.js | лонгрид для гостей, библиотека топ-6, авто-вход при `?next=` |
| catalog.html | catalog.js | каталог + модерация + заявки (публичен) |
| shelf.html | shelf.js | полка, покупки, избранное, архив, заваривание |
| journal.html | journal.js | лента журнала, фильтры, архив |
| profile.html | profile.js | профиль, фото, безопасность, уведомления, план |
| privacy.html | doc.js | документ (только общие блоки) |
| 404.html | — | статика без JS |

Каждый модуль начинает с `await initCommon()` (common.js): статус БД → `initAuth()`
→ `initGate()` → модалка количества → чат → триггеры чата → FAB → cookie-гейт → SW.

## 3. Поток авторизации и «две страницы» (gate.js)

```
гость  → index.html            (лонгрид; ?next=… открывает модалку входа)
гость  → shelf/journal/profile → replace(index.html?next=<file>)
вошёл  → index.html            → replace(next || shelf.html)
вошёл  → shelf/journal/profile → работаем
вошёл  → catalog/privacy       → работаем (публичные)
вышел  → любая защищённая      → replace(index.html?next=…)
```

Реализовано подпиской `onAuthChange` + одноразовым флагом `redirected`, чтобы не
гонять пользователя по кругу при повторных эмитах сессии.

## 4. DOM-контракты

Разметка страниц обязана содержать id, которые ждут боевые модули. Полный список
проверяется скриптом `work/check.py` (id из HTML ∪ id, создаваемые самим js, против
`$('#…')` / `getElementById` транзитивных импортов страницы).

- auth.js: `authOpen, userArea, avatarBtn, userMenu, userEmail, openModerationBtn,
  logoutBtn, authOverlay, authForm, tabLogin, tabRegister, fieldEmail, fieldPassword,
  fieldName, authEmail, authPassword, authName, authTitle, authSubmit, authError, authClose`
- shelf.js: `shelfGrid, shelfSearch, shelfTypeFilter, shelfSort, countAll, countLow,
  statTeas, statBrews, statRating, statRestock, shelfBanner, shelfBannerText,
  shelfBannerAction, favoritesPanel/List/Count, moderationPanel/List/Count,
  openArchiveBtn, openJournalArchiveBtn, brewOverlay(+brew*), teaOverlay(+tea*),
  journalOverlay(+journalOv*), amountOverlay(+amount*), archiveOverlay(+archive*),
  шаблоны shelfCardTemplate / shoppingRowTemplate / favoritesRowTemplate /
  moderationRowTemplate / archiveRowTemplate / journalEntryTemplate`
- catalog.js: `catalogSearch, catalogTypeFilter, catalogSort, typeChips, catalogGrid,
  moreWrap, moreBtn, modeSwitch, pendingCount, proposeOverlay, editTeaOverlay,
  moderateOverlay, rejectOverlay, teaCardTemplate`
- profile.js: `profileGuest, profileContent, profileEmail, profileSince, profileAvatar,
  avatarBtnUpload, avatarInput, passwordForm(curPass/newPass/repeatPass),
  emailForm(newEmail), deleteAccountBtn, notifyEmailSwitch, notifyTelegramSwitch,
  aiBar, aiBarWrap, aiLimitText`
- journal.js: `journalFeed, journalSearch, journalTeaFilter, journalRatingChips,
  journalCount, jStatBrews, jStatRating, jStatTeas, jStatMonth, openJournalArchiveBtn`
- common.js: `brewFab` (опционально), `data-open-chat` (опционально), `toasts`

Новые блоки v2 создаются самим js и не требуют разметки: оверлеи таймера
(`brewTimerOffer`, `brewTimerOverlay`), выбор чая (`brewChooseOverlay`),
подтверждения, cookie-плашка, окно чата.

## 5. Заваривание: поток

```
[data-action="brew"] / FAB / [data-brew-choose]
        ↓
shelf.js: offerBrewTimer(row.tea, () => openBrew(row))   ← brewTimer.js
        ↓
окно-вопрос:  Нет → openBrew(row)  (brewOverlay: количество, ★, заметка → RPC brew_tea)
              Да  → таймер
                    режим gongfu:   first = верх границы time из карточки
                                    step  = +15 сек (минутные карточки +30 сек)
                                    «Следующий пролив» увеличивает steep и total
                    режим infusion: пресеты 120/180/240 сек, дефолт из карточки
                    «Готово — в журнал» → openBrew(row)
Закрытие оверлея (Esc/фон) гасит интервал таймера (MutationObserver по class).
```

## 6. Данные и офлайн

- shelf.js хранит снапшот `{user_id, timestamp, shelf, journal, catalog, favorites}`
  в localStorage и показывает его при сетевой ошибке supabase-js (`{error}` + offline).
- journal.js читает `brew_journal` + `brew_journal_archive` + имена из `tea_catalog`,
  `user_tisanes(tisane_catalog(name))`, `unknown_teas`.
- Фото: карточки каталога — bucket фото (SEO-имена по типу чая); аватар — bucket
  `user-avatars`, путь `<user_id>/avatar-<ts>.<ext>`, upsert в `profiles.avatar_url`.
- Аналитика: Метрика только после согласия (`tea_shelf_cookie_consent`), Vercel
  Insights — всегда; события `trackEvent` уходят в `ym(..., 'reachGoal', …)`.

## 7. PWA

- `sw.js` v4: precache фактического списка страниц/стилей/скриптов/фото, cache-first,
  навигация — network с фолбэком на кэш и `/404.html`.
- `manifest.webmanifest`: standalone, кремовая тема, иконки 192/512 (any + maskable).

## 8. Соглашения кода

- Комментарии и строки интерфейса — русские; логи — `[модуль] сообщение`.
- Никаких инлайн-стилей в новой разметке, кроме одноразовых переопределений паддингов;
  все повторяющиеся блоки — классы из components.css.
- Любая модалка: `.overlay > .modal` + `wireOverlay` + закрытие по Esc из common.js.
- Тосты — только `showToast`; подтверждения — `askConfirm` (деструктивные действия
  всегда с подтверждением, удаление аккаунта — двойное).
