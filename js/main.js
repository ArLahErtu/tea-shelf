// ============================================================
// main.js — точка входа лонгрида (index.html).
// «Библиотека» — мини-каталог с поиском и отбором по типу:
// максимум 3 карточки; полный каталог — ссылкой в примечании.
// ============================================================
import { initCommon } from './common.js';
import { supabase, isConfigured } from './supabaseClient.js';
import { TABLES } from './config.js';
import { $, escapeHtml, typeClass } from './ui.js';
import { openAuth } from './auth.js';
import { nextParam } from './gate.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

function signalReady() {
  window.dispatchEvent(new Event('tea-app-ready'));
}

function initPreloader() {
  const pre = document.getElementById('pre');
  const hide = () => pre && pre.classList.add('done');
  window.addEventListener('load', () => setTimeout(hide, 350));
  setTimeout(hide, 1600);
}

const libState = { q: '', type: 'all' };
let libTimer = null;

function buildLibQuery() {
  let query = supabase
    .from(TABLES.catalog)
    .select('id, name, type, region, photo_url, temp, time')
    .eq('status', 'published');

  if (libState.type !== 'all') query = query.ilike('type', libState.type);

  const term = libState.q.replace(/[,()"']/g, '').trim();
  if (term) {
    query = query.or(`name.ilike.%${term}%,region.ilike.%${term}%`);
  }

  return query
    .order('popularity', { ascending: false })
    .order('id', { ascending: true })
    .limit(3);
}

function libCard(t) {
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
  return a;
}

async function loadLibrary() {
  const grid = $('#libGrid');
  if (!grid) {
    console.warn('[library] grid not found');
    return;
  }
  if (!isConfigured()) {
    console.warn('[library] supabase not configured — оставлен статический фолбэк');
    signalReady();
    return;
  }

  console.log('[library] запрос к каталогу...');
  const { data, error } = await buildLibQuery();
  if (error) {
    console.warn('[library] ошибка Supabase:', error.message, error);
    // сретраим один раз через 1.5 с
    await new Promise((r) => setTimeout(r, 1500));
    const { data: retryData, error: retryError } = await buildLibQuery();
    if (retryError) {
      console.warn('[library] ретрай тоже упал:', retryError.message);
      signalReady();
      return;
    }
    if (retryData?.length) {
      grid.innerHTML = '';
      retryData.slice(0, 3).forEach((t) => grid.appendChild(libCard(t)));
    }
    signalReady();
    return;
  }

  console.log('[library] получено записей:', data?.length);
  if (!data?.length) {
    grid.innerHTML = `<div class="empty grid-col-span">
      <h3>Ничего не нашлось</h3>
      <p>Попробуйте другой запрос или тип — в полном каталоге сортов значительно больше.</p>
    </div>`;
    signalReady();
    return;
  }

  grid.innerHTML = '';
  data.slice(0, 3).forEach((t) => grid.appendChild(libCard(t)));
  signalReady();
}

function initLibFilters() {
  const search = $('#libSearch');
  const type = $('#libType');
  if (!search || !type) return;

  search.addEventListener('input', () => {
    clearTimeout(libTimer);
    libTimer = setTimeout(() => {
      libState.q = search.value;
      loadLibrary();
    }, 300);
  });

  type.addEventListener('change', () => {
    libState.type = type.value;
    loadLibrary();
  });
}

async function init() {
  initPreloader();
  await initCommon();

  if (nextParam()) openAuth();

  initLibFilters();
  try {
    await loadLibrary();
  } catch (e) {
    console.warn('[library]', e?.message || e);
    signalReady();
  }
}

init();