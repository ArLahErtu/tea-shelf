// ============================================================
// main.js — точка входа для главной страницы
// Блок 4 (переделан): «Библиотека» оживает БЕЗ правки index.html —
// скрипт сам находит .tea-grid и подставляет топ-6 по popularity.
// Статичные карточки в HTML остаются фолбэком при ошибке сети/БД.
// ============================================================
import { initCommon } from './common.js';
import { supabase, isConfigured } from './supabaseClient.js';
import { TABLES } from './config.js';
import { $, escapeHtml } from './ui.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

async function loadLibrary() {
  // На главной ровно одна сетка мини-карточек каталога
  const grid = $('.tea-grid');
  if (!grid || !isConfigured()) return;

  const { data, error } = await supabase
    .from(TABLES.catalog)
    .select('id, name, type, region, photo_url, popularity')
    .eq('status', 'published')
    .order('popularity', { ascending: false })
    .order('id', { ascending: true })
    .limit(6);

  // Ошибка или пусто — молча оставляем статичный фолбэк
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

async function init() {
  await initCommon();
  try {
    await loadLibrary();
  } catch (e) {
    console.warn('[library]', e?.message || e);
  }
}

init();