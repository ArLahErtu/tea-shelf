# Аудит 2-го уровня: структура репозитория, скорость, остаточный UI-полиш

**Объект:** сборка редизайна v2.0 → v2.1 (папка `redesign/`).
**Метод и скилы:** протокол `vercel-labs/skills → find-skills` (`npx skills find …`);
из open-design применены `web-design-guidelines` (Vercel Web Interface Guidelines,
раздел Performance), `impeccable-design-polish` (режим harden), `emil-design-eng`
(формат ревью таблицей Before/After/Why и рамки анимаций), `redesign-skill`.
Найденное в skills.sh (`project-structure` для .NET/Magento, `vercel-react-best-practices`)
**отклонено**: стеки не совпадают (у нас vanilla HTML/CSS/JS + Supabase), установки <1.5K.

Замеры выполнены скриптом `work/measure.py`: считает css-ссылки, транзитивный граф
ES-модулей с глубиной, modulepreload и внешние origin’ы по каждой странице.

---

## 1. Структура: что было не так

| Было (v2.0) | Проблема | Стало (v2.1) |
| --- | --- | --- |
| `js/` — 20 файлов в одной папке: инфраструктура (`config`, `supabaseClient`, `ui`), домен (`auth`, `tisanes`, `chatbot`), страницы (`main`, `shelf`) | невозможно понять «где что лежит», нельзя применить правила зависимостей | `js/app.js` (корень композиции) + `js/core/` + `js/features/` + `js/pages/` |
| `main.js` для `index.html`, `chatbotHTML.js`/`brewTimer.js` в camelCase, `chatbot.js` | несогласованные имена, связь «файл ↔ страница» угадывается | страницы: `pages/index.js … pages/doc.js`; фичи в kebab-case: `chat.js`, `chat-html.js`, `brew-timer.js`, `tea-modal.js`, `amount-modal.js` |
| `css/pages/*.css` + `css/chatbot.css` | лишний слой каталога, имя `chatbot` ≠ сущность «чат» | плоско: `css/base.css components.css chat.css index.css catalog.css shelf.css journal.css profile.css` |
| импорты шли цепочками до 4 уровней (page → common → auth → ui → config) | водопад запросов модулей, хрупкость | глубина графа ≤2; линт слоёв в аудите — 0 нарушений |
| шрифты с `fonts.googleapis.com` (2 origin, render-blocking CSS) | лишние DNS/TLS-узлы, поздние запросы woff2 | самохост `fonts/` (4 woff2, OFL) + `preload` кириллицы |
| нет политик кэширования | каждый визит тянет css/js заново | `vercel.json`: immutable для шрифтов, SWR для css/js/img, must-revalidate для html/sw |

### Правила слоёв (внедрены и проверяются)

```
core/     инфраструктура без домена: config, supabase, ui      → не импортирует features/pages
features/ доменные фичи: auth, gate, brew-timer, chat, модалки → импортируют только core
pages/    тонкая оркестрация страницы                           → core + features, никогда другие pages
app.js    корень композиции: единственный, кто связывает features между собой (initCommon)
```

Проверка линтером зависимостей: **нарушений 0**. Граф модуля страницы теперь
«page → {core, features}» без промежуточных узлов-прокси и баррелей — запрос к каждому
файлу прямой, без лишних слоёв.

### Итоговое дерево

```
/  (publish-корень Vercel)
├── index.html catalog.html shelf.html journal.html profile.html privacy.html 404.html
├── app-файлы: sw.js manifest.webmanifest robots.txt sitemap.xml vercel.json
├── google….html yandex….html        # верификации: обязаны лежать в корне (требование площадок)
├── css/      base · components · chat · index · catalog · shelf · journal · profile
├── js/
│   ├── app.js
│   ├── core/      config.js supabase.js ui.js
│   ├── features/  auth.js gate.js brew-timer.js notifications.js chat.js chat-html.js
│   │              tea-modal.js amount-modal.js tisanes.js unknowns.js
│   └── pages/     index.js catalog.js shelf.js journal.js profile.js doc.js
├── fonts/    manrope-{cyrillic,latin}.woff2 prata-{cyrillic,latin}.woff2
├── img/      favicon.svg icon-192/512.(png|svg) photo-*.jpg
└── docs/     ARCHITECTURE.md REDESIGN.md UIUX_REVIEW.md AUDIT.md
```

Человеку достаточно трёх правил ориентации: «страница = `pages/<имя>.js` +
`css/<имя>.css` + `<имя>.html`», «переиспользуемое = `features/` или `components.css`»,
«инфраструктура = `core/` или `base.css`».

---

## 2. Скорость: замеры до/после

| Страница | Запросов v2.0 | Запросов v2.1 | Глубина JS v2.0 → v2.1 | Внешние origin v2.0 → v2.1 |
| --- | --- | --- | --- | --- |
| index | 21 | 16 | 3 → 2 | 5 → 2 |
| catalog | 22 | 17 | 3 → 2 | 5 → 2 |
| shelf | 25 | 20 | 3 → 2 | 5 → 2 |
| journal | 21 | 15 | 2 → 2 | 5 → 2 |
| profile | 22 | 16 | 3 → 2 | 5 → 2 |
| privacy | 21 | 10 | 4 → 1 | 5 → 2 |
| 404 | 8 | 8 | 0 → 0 | 3 → 3 |

Что дало эффект:

1. **Самохост шрифтов** −2 render-blocking запроса и −2 origin на каждую страницу;
   кириллические woff2 уходят в `preload` (первая отрисовка без FOUT-скачка).
2. **`modulepreload` генерируется сборщиком** из транзитивного графа импортов:
   браузер тянет модули параллельно вместо водопада (5–10 ссылок на страницу).
3. **`preconnect`** к Supabase и jsDelivr (оттуда supabase-js) — соединение готово
   до первого запроса данных.
4. **Плоский css**: `components.css` (36 КБ, ≈7 КБ brotli) грузится один раз и живёт
   в кэше/SW на всех страницах; страницные css — 1–8 КБ.
5. **`vercel.json`**: шрифты immutable на год; css/js/img — `max-age=86400,
   stale-while-revalidate=604800`; html и sw.js — `must-revalidate` (мгновенные обновы).
6. **SW v5** прекэшит фактический список (страницы, css, js, шрифты, фото) — повторный
   визит работает офлайн и без сети.
7. Изображения: `width/height` (нет CLS), `loading="lazy"` ниже фолда,
   `fetchpriority="high"` у LCP-фото лендинга.

Веса: html страниц 15–35 КБ; css на страницу 47–56 КБ raw; js-граф страницы 38–160 КБ raw
(shelf — самый тяжёлый из-за тизанов/неизвестных, грузится отложенно после первой отрисовки).

---

## 3. Остаточный UI-полиш (формат emil-design-eng)

| Before | After | Why |
| --- | --- | --- |
| `transition: opacity .2s ease` у оверлея | `opacity .18s ease-out` + `transform .22s cubic-bezier(.22,1,.36,1)` у модалки | Вход должен стартовать мгновенно: ease-out даёт отклик в первые миллисекунды |
| нет `:active` у чипов, табов, сегмент-табов | `transform: scale(.97–.98)` на `:active` | Нажатие без отклика ощущается как «не нажал» |
| тост уходил только прозрачностью | уход `opacity + translateY(6px)` симметрично входу | Пространственная согласованность: тост «уезжает» туда, откуда появился |
| анимация ховера карточек −4px везде | оставлена только для каталога/лендинга (редкое взаимодействие); частые списки полки — без подъёма | То, что пользователь видит десятки раз в день, не должно анимироваться |
| `html { scroll-behavior: smooth }` без исключений | + `prefers-reduced-motion: reduce` → `auto` | Клавиатурная навигация не должна «плыть» |

Дополнительно проверено и чисто: `:focus-visible` везде, деструктивные действия с
подтверждением, `aria-*` у переключателей и таймера, `overscroll-behavior: contain`
в оверлеях, таймер гаснет при закрытии по Esc.

---

## 4. Что проверить после деплоя

1. Первая загрузка в инкогнито: Network → нет запросов к `fonts.googleapis/gstatic`,
   woff2 уходят первыми (preload), css/js с кодом 200 и заголовками Cache-Control из vercel.json.
2. Повторная загрузка: css/js/шрифты из memory/disk cache или SW (`sw.js` v5).
3. Офлайн: открытая ранее полка отдаёт снапшот и статику из SW.
4. `journal.html`, `shelf.html` под нагрузкой: modulepreload не даёт водопада
   (Waterfall в DevTools — параллельные старты модулей).
5. Линт структуры: `python3 work/check.py` (id/ресурсы) + линт слоёв из §1 — 0 нарушений.

## 5. Остаточные риски и следующие шаги

- `components.css` общий для всех страниц: при росте доменов (>10) разобрать на
  `components/*.css` с подключением по странице; сейчас один кэшируемый файл выгоднее.
- Фото лендинга — JPEG: при появлении тулчинга конвертировать в AVIF/WebP (−30–40% веса).
- Если граф модулей страницы превысит ~25 файлов — ввести сборку (esbuild) только для
  `pages/*`, не трогая ручную структуру исходников.
- 404.html ждёт ваш файл: текущий — заглушка в общем языке.
