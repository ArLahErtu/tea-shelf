// ============================================================
// ui.js — общие UI-хелперы и справочники
// Используется всеми страницами: тосты, модалки, формы, словари
// Неделя 4: словари типов приведены к реальным значениям БД;
// trackEvent шлёт продуктовые события в PostHog.
// ============================================================

// ---------- DOM ----------
export const $  = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- Тосты ----------
export function showToast(message, type = 'ok') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'warn' ? ' warn' : '');
  t.textContent = message;
  box.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 250);
  }, 3500);
}

// ---------- Оверлеи / модалки ----------
export function openOverlay(ov) {
  ov.hidden = false;
  requestAnimationFrame(() => ov.classList.add('show'));
}

export function closeOverlay(ov) {
  ov.classList.remove('show');
  setTimeout(() => { ov.hidden = true; }, 200);
}

// Закрытие по клику в подложку
export function wireOverlay(ov) {
  ov.addEventListener('click', (e) => {
    if (e.target === ov) closeOverlay(ov);
  });
}

// ---------- Подтверждение действий (вместо native confirm) ----------
let confirmOv = null;

function buildConfirmOverlay() {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.hidden = true;
  ov.innerHTML = `
    <div class="modal narrow" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
      <div class="modal-head">
        <h2 id="confirmTitle"></h2>
        <button class="icon-btn" type="button" data-confirm="close" aria-label="Закрыть">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>
      <p class="modal-sub" id="confirmText"></p>
      <div class="modal-foot">
        <button class="btn btn-ghost" type="button" data-confirm="cancel">Отмена</button>
        <button class="btn btn-danger" type="button" data-confirm="ok"></button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  wireOverlay(ov);
  return ov;
}

// Возвращает Promise<boolean>.
// Esc / клик в подложку / «Отмена» → false, красная кнопка → true.
export function askConfirm({ title = 'Вы уверены?', text = '', okLabel = 'Убрать' } = {}) {
  if (!confirmOv) confirmOv = buildConfirmOverlay();
  const ov = confirmOv;
  $('#confirmTitle', ov).textContent = title;
  $('#confirmText', ov).textContent = text;
  $('[data-confirm="ok"]', ov).textContent = okLabel;

  return new Promise((resolve) => {
    let settled = false;
    const mo = new MutationObserver(() => {
      if (!ov.classList.contains('show')) settle(false);
    });
    const settle = (val) => {
      if (settled) return;
      settled = true;
      mo.disconnect();
      ov.removeEventListener('click', onClick);
      resolve(val);
    };
    const onClick = (e) => {
      if (e.target.closest('[data-confirm="ok"]')) {
        closeOverlay(ov);
        settle(true);
      }
    };
    ov.addEventListener('click', onClick);
    mo.observe(ov, { attributes: true, attributeFilter: ['class'] });
    openOverlay(ov);
  });
}

// ---------- Формы ----------
export function setInvalid(fieldEl, invalid) {
  fieldEl.classList.toggle('invalid', invalid);
  return !invalid;
}

export function isValidEmail(v) {
  return /^\S+@\S+\.\S+$/.test(String(v || '').trim());
}

// ---------- Утилиты ----------
export function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// plural(3, ['заваривание','заваривания','завариваний'])
export function plural(n, forms) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
  return forms[2];
}

export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
  });
}

// Приводит теги из БД к массиву:
// массив, Postgres-литерал '{a,b}', JSON '[...]' или строка через запятую
export function toTags(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    if (s.startsWith('{') && s.endsWith('}')) {
      const inner = s.slice(1, -1).trim();
      if (!inner) return [];
      return inner
        .split(',')
        .map((x) => x.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
    }
    if (s.startsWith('[')) {
      try {
        const p = JSON.parse(s);
        if (Array.isArray(p)) return p;
      } catch {
        // падаем в вариант с запятыми
      }
    }
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

// ---------- Аналитика (PostHog) ----------
// Неделя 4, Блок E. События: signup / login / tea_card_opened /
// tea_added_to_shelf / tea_proposed / favorite_toggled.
// Сниппет в common.js создаёт window.posthog; до загрузки SDK
// вызовы capture попадают в его очередь. Аналитика не должна
// ломать приложение — всё в try/catch.
export function trackEvent(name, props) {
  try {
    if (window.posthog?.capture) {
      window.posthog.capture(name, props || {});
    }
  } catch (e) { /* ignore */ }
}

// ---------- Справочники чая ----------
// value из HTML-селектов и форм → значение, как хранится в БД (по-русски).
// Неделя 4: дополнено реальными типами из боевой БД.
export const TYPE_TO_DB = {
  black:  'чёрный',
  green:  'зелёный',
  white:  'белый',
  yellow: 'жёлтый',
  oolong: 'улун',
  red:    'красный',
  puerh:  'пуэр',
  dark:   'хэй ча',
  floral: 'цветочный',
  matte:  'матте',
  matcha: 'матча',
  herbal: 'травяной',
  blend:  'смесь',
};

// ключ → человекочитаемая метка (для подсказок и селектов)
export const TYPE_LABELS = {
  black:  'Чёрный',
  green:  'Зелёный',
  white:  'Белый',
  yellow: 'Жёлтый',
  oolong: 'Улун',
  red:    'Красный',
  puerh:  'Пуэр',
  dark:   'Хэй ча',
  floral: 'Цветочный',
  matte:  'Матте',
  matcha: 'Матча',
  herbal: 'Травяной',
  blend:  'Смесь',
};

// значение type из БД (нижний регистр) → CSS-класс чипа
export const TYPE_CLASS = {
  'чёрный':   'tc-black',
  'черный':   'tc-black',
  'зелёный':  'tc-green',
  'зеленый':  'tc-green',
  'белый':    'tc-white',
  'жёлтый':   'tc-yellow',
  'желтый':   'tc-yellow',
  'улун':     'tc-oolong',
  'красный':  'tc-red',
  'пуэр':     'tc-puerh',
  'хэйча':    'tc-dark',
  'хэй ча':   'tc-dark',
  'цветочный':'tc-floral',
  'матте':    'tc-matte',
  'матча':    'tc-matcha',
  'травяной': 'tc-herbal',
  'смесь':    'tc-blend',
  'купаж':    'tc-blend',
};

export function typeClass(type) {
  return TYPE_CLASS[String(type || '').toLowerCase()] || 'tc-blend';
}

// Алиас для старых импортов — не даёт коду упасть
export const typeChipClass = typeClass;

// ---------- Единицы измерения ----------
export const UNIT_LABELS = {
  g: 'г',
  sachet: 'пакетик',
  pcs: 'упаковка',
};