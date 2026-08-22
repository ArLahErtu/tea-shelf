# Чайная полка ☕ — личный учёт чая

Веб-сервис личного учёта чая: остатки, журнал завариваний с оценками,
список покупок, общий каталог чаёв с модерацией и ИИ-помощник на YandexGPT.

**Статус:** активное использование, сбор обратной связи.

## Что умеет (реализовано)

### Личная полка
- Вход/регистрация (Supabase Auth), данные только свои (RLS).
- Остатки в граммах, пакетиках или упаковках.
- Статусы «Мало» / «Закончился» с автонапоминанием.
- Список «Что докупить» с дозакупкой одной кнопкой.
- Избранное (хотелки).

### Журнал завариваний
- Количество, оценка ★★★★★, заметка о вкусе.
- Атомарное списание остатков через RPC `brew_tea`.
- Счётчик популярности в общем каталоге.

### Общий каталог
- Поиск по названию, региону и тегам.
- Фильтр по типу чая, сортировки (популярность, название).
- Карточка чая с параметрами заваривания (температура, время, доза, проливы).
- «На полку» с выбором количества и порога «мало».
- Предложите свой чай — заявка попадает на модерацию.

### Чат-помощник
- **Командный режим:** «Добавь Сенча 100г», «Заварил Пуэр 7г», «Что докупить?», «Статистика».
- **ИИ-режим (YandexGPT):** советы по чаю с учётом вашей полки и журнала завариваний.
- История диалогов 7 дней в localStorage.
- Уведомления о модерации заявок (в чате при следующем входе).
- Лимит ИИ-запросов: 7 в день на бесплатном тарифе (счётчик в модалке чата).

### Модерация
- Режим модератора (тумблер в меню аватара).
- Просмотр всех pending-заявок, одобрение с редактированием полей.
- Отклонение с причиной, удаление дубликатов.
- Редактирование любых карточек каталога (фото, параметры, теги).
- SEO-оптимизированная загрузка фото (папки по типу чая, транслитерация имён).

### Прочее
- PWA: манифест, иконки, установка на телефон.
- Аналитика: Яндекс Метрика + Vercel Analytics.
- Адаптивный дизайн, шрифты Manrope + Prata.

## Стек

- **Фронтенд:** чистые HTML + модульный CSS + Vanilla JS (ES-модули, без сборщиков).
- **Бэкенд:** Supabase (Postgres + Auth + RLS + Storage + RPC + Edge Functions).
- **ИИ:** YandexGPT (yandexgpt-lite) через Supabase Edge Function.
- **Хостинг:** Vercel (автодеплой с main).

## Структура
- index.html / catalog.html / shelf.html — страницы
- js/
main.js / catalog.js / shelf.js — логика страниц
common.js — инициализация общих блоков
auth.js — авторизация + роли
supabaseClient.js — клиент Supabase
config.js — URL и anon-ключ
ui.js — общие UI-хелперы
teaModal.js / amountModal.js — модалки
chatbot.js / chatbotHTML.js — чат-помощник
notifications.js — настройки уведомлений
- css/
base.css / components.css — базовые стили
pages/index.css / catalog.css / shelf.css — стили страниц
chatbot.css — стили чата
- img/ — иконки, favicon
- manifest.webmanifest — PWA-манифест

## База данных (Supabase)

### Таблицы
- `tea_catalog` — общий каталог (id, name, type, region, description, temp, time, grams, steeps, tags, status, author_id, photo_url, popularity).
- `user_shelf` — личная полка (user_id, tea_id, amount, unit, low_threshold).
- `brew_journal` — журнал завариваний (user_id, tea_id, amount, unit, rating, note, created_at).
- `wishlist` — избранное (user_id, tea_id).
- `user_roles` — роли пользователей (user_id, role: 'user' | 'moderator' | 'admin').
- `user_subscriptions` — подписки и лимиты ИИ (user_id, plan, daily_requests_used, premium_until).
- `user_notifications` — настройки уведомлений (user_id, email, telegram_chat_id).
- `ai_request_log` — история запросов к ИИ (user_id, request_text, response_text, plan).
- `moderation_log` — лог модерации (tea_id, moderator_id, action, reason).

### RPC-функции
- `brew_tea(p_shelf_id, p_amount, p_rating, p_note)` — атомарное списание + запись в журнал + популярность+1.
- `get_pending_teas()` — все pending-заявки (только для модераторов).
- `approve_tea(p_tea_id, p_moderator_id, p_edited_data)` — одобрение с редактированием.
- `reject_tea(p_tea_id, p_moderator_id, p_reason, p_duplicate_exists)` — отклонение.
- `update_tea(p_tea_id, p_user_id, p_edited_data)` — редактирование карточки (модератор — любые, автор — свои pending).
- `get_user_limits(p_user_id, p_timezone)` — лимиты ИИ-запросов.
- `increment_ai_request(p_user_id, p_timezone)` — проверка + инкремент счётчика.

### RLS-политики
- `tea_catalog`: select = published OR автор; insert = authenticated+pending; update/delete = автор (только pending) или модератор (через RPC).
- `user_shelf`, `brew_journal`, `wishlist`: только свои данные.
- `user_subscriptions`, `user_notifications`: только свои данные (без self-upgrade плана).

## Локальный запуск

1. Любым статическим сервером: `npx serve` или Live Server в VS Code.
2. Ключи Supabase уже в `js/config.js`; для своего проекта — заменить `SUPABASE_URL` / `SUPABASE_ANON_KEY` (Dashboard → Settings → API).
3. Схема БД: таблицы и RPC применены SQL-блоками (см. миграции в Supabase Dashboard → Database → Migrations).

Тестовые аккаунты отключены (`SHOW_DEMO_ACCOUNTS = false` в `config.js`).

## Деплой

Статика без сборки: репозиторий импортируется в Vercel с пресетом «Other», publish-каталог — корень репозитория. Автодеплой с ветки `main`.

## Edge Functions (Supabase)

- `ai-assistant` — ИИ-ассистент на YandexGPT с проверкой лимитов и историей запросов.
- Секреты: `YANDEX_API_KEY`, `YANDEX_FOLDER_ID`, `SERVICE_ROLE_KEY`.

## Дорожная карта

### Реализовано (Этапы 1–3)
- ✅ MVP: полка, журнал, каталог, модерация.
- ✅ Чат-бот с командами + ИИ-режим (YandexGPT).
- ✅ Режим модератора с редактированием карточек.
- ✅ SEO-загрузка фото, поиск по тегам.
- ✅ Тарификация ИИ (лимит 7/день, счётчик в чате).
- ✅ Уведомления о модерации (в чате).

### В планах (по мере сбора обратной связи)
- 🔜 Подписка с расширенным ИИ (безлимит, больше токенов).
- 🔜 Telegram-бот для управления полкой.
- 🔜 Email/Telegram-уведомления при одобрении/отклонении заявок.
- 🔜 Экспорт статистики в CSV/Excel.
- 🔜 Красивые отчёты и графики.

## Обратная связь

[Google Form](https://forms.gle/rCcAXQ7kSTANzhqm7)

## Лицензия

MIT