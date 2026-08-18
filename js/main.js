// ============================================================
// main.js — точка входа для главной страницы
// «Библиотека» оживает без правки index.html (топ-6 по popularity,
// статика в HTML — фолбэк).
// Неделя 4: карусель «Возможности» на мобильном — автопрокрутка
// с паузой при взаимодействии пользователя.
// ============================================================
import { initCommon } from './common.js';
import { supabase, isConfigured } from './supabaseClient.js';
import { TABLES } from './config.js';
import { $, escapeHtml } from './ui.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

async function loadLibrary() {
  const grid = $('.tea-grid');
  if (!grid || !isConfigured()) return;

  const { data, error } = await supabase
    .from(TABLES.catalog)
    .select('id, name, type, region, photo_url, popularity')
    .eq('status', 'published')
    .order('popularity', { ascending: false })
    .order('id', { ascending: true })
    .limit(6);

  if (error || !data?.length) {
    console.warn('[library]', error?.message || 'каталог пуст');
    return;
  }

  grid.innerHTML = '';
  data.forEach((t) => {
    const a = document.createElement('a');
    a.className = 'tmini';
    a.href = 'catalog.html';
    a.title = t.name;
    a.innerHTML = `
      <div class="tm">
        ${t.photo_url
          ? `<img src="${escapeHtml(t.photo_url)}" alt="${escapeHtml(t.name)}" loading="lazy">`
          : `<div class="ph"><svg viewBox="0 0 24 24"><path d="M5 20c0-8 5-13 14-15-1 9-6 14-14 15Z"/></svg></div>`}
      </div>
      <div class="tb">
        <b>${escapeHtml(t.name)}</b>
        <span>${escapeHtml(cap(t.type) || '—')}${t.region ? ' · ' + escapeHtml(t.region) : ''}</span>
      </div>`;
    grid.appendChild(a);
  });
}

// ---------- Карусель «Возможности» (только мобильные) ----------
function initFeatCarousel() {
  const grid = $('.feat-grid');
  if (!grid) return;

  const mq = window.matchMedia('(max-width: 640px)');
  let timer = null;
  let pauseUntil = 0;

  const cardStep = () => {
    const card = grid.querySelector('.feat');
    if (!card) return 280;
    return card.getBoundingClientRect().width + 12; // ширина + gap
  };

  function tick() {
    if (Date.now() < pauseUntil) return;      // пользователь трогал — ждём
    const max = grid.scrollWidth - grid.clientWidth - 4;
    if (grid.scrollLeft >= max) {
      grid.scrollTo({ left: 0, behavior: 'smooth' });   // зацикливаем
    } else {
      grid.scrollBy({ left: cardStep(), behavior: 'smooth' });
    }
  }

  function start() {
    stop();
    if (mq.matches) timer = setInterval(tick, 4000);
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  // Любое касание — пауза автопрокрутки на 8 секунд
  const pause = () => { pauseUntil = Date.now() + 8000; };
  grid.addEventListener('touchstart', pause, { passive: true });
  grid.addEventListener('pointerdown', pause);
  grid.addEventListener('wheel', pause, { passive: true });

  if (mq.addEventListener) mq.addEventListener('change', start);
  start();
}

async function init() {
  await initCommon();
  initFeatCarousel();
  try {
    await loadLibrary();
  } catch (e) {
    console.warn('[library]', e?.message || e);
  }
}

init();