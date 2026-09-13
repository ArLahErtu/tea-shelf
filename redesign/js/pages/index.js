// ============================================================
// main.js — точка входа лонгрида (index.html, редизайн v2).
// Страница только для гостей: вошедших уводит gate.js.
// «Библиотека» оживает без правки разметки: топ-6 по популярности,
// статика в HTML — фолбэк и LCP-картинка.
// ============================================================
import { initCommon } from '../app.js';
import { supabase, isConfigured } from '../core/supabase.js';
import { TABLES } from '../core/config.js';
import { $, escapeHtml, typeClass } from '../core/ui.js';
import { openAuth } from '../features/auth.js';
import { nextParam } from '../features/gate.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

// ---------- прелоадер: энсо ----------
function initPreloader() {
  const pre = document.getElementById('pre');
  const hide = () => pre && pre.classList.add('done');
  window.addEventListener('load', () => setTimeout(hide, 350));
  setTimeout(hide, 1600); // страховка
}

// ---------- библиотека: топ-6 из каталога ----------
async function loadLibrary() {
  const grid = $('#libGrid');
  if (!grid || !isConfigured()) return;

  const { data, error } = await supabase
    .from(TABLES.catalog)
    .select('id, name, type, region, photo_url, temp, time')
    .eq('status', 'published')
    .order('popularity', { ascending: false })
    .order('id', { ascending: true })
    .limit(6);

  if (error || !data?.length) {
    console.warn('[library]', error?.message || 'каталог пуст');
    return;
  }

  grid.innerHTML = '';
  data.slice(0, 3).forEach((t) => {
    const a = document.createElement('a');
    a.className = 'tea';
    a.href = 'catalog.html';
    a.innerHTML = `
      <div class="ph-wrap">
        ${t.photo_url
          ? `<img src="${escapeHtml(t.photo_url)}" width="960" height="720" loading="lazy" alt="${escapeHtml(t.name)}">`
          : `<div class="ph"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20c0-8 5-13 14-15-1 9-6 14-14 15Z"/></svg></div>`}
      </div>
      <div class="b">
        <span class="t">${escapeHtml(t.name)}</span>
        <span class="r">${escapeHtml(cap(t.type) || '—')}${t.region ? ' · ' + escapeHtml(t.region) : ''}</span>
        <span class="p ${typeClass(t.type)}">${escapeHtml([t.temp, t.time].filter(Boolean).join(' · ') || 'параметры в карточке')}</span>
      </div>`;
    grid.appendChild(a);
  });
}

async function init() {
  initPreloader();
  await initCommon();

  // гость пришёл с сервисной страницы (?next=…) — сразу показываем вход
  if (nextParam()) openAuth();

  try {
    await loadLibrary();
  } catch (e) {
    console.warn('[library]', e?.message || e);
  }
}

init();
