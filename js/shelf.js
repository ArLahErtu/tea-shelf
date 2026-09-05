// ============================================================
// shelf.js — логика страницы shelf.html
// Восстановлена рабочая версия + архив в модальном окне
// (три вкладки: чай / тизаны / неизвестные) и архив журналов.
// ============================================================
import { initCommon } from './common.js';
import { supabase } from './supabaseClient.js';
import { TABLES } from './config.js';
import {
  $, $$, showToast, openOverlay, closeOverlay, wireOverlay,
  escapeHtml, plural, formatDate, typeClass, TYPE_TO_DB, UNIT_LABELS,
  askConfirm,
} from './ui.js';
import { getUser, onAuthChange } from './auth.js';
import { openTeaModal } from './teaModal.js';
import { initAmountModal, openAmountModal } from './amountModal.js';
import { initTisanes, reloadTisanes, renderTisanes, tisaneJournalName } from './tisanes.js';
import { initUnknowns, reloadUnknowns, renderUnknowns, unknownJournalName } from './unknowns.js';

let shelf = [];
let journal = [];
let requests = [];
let favorites = [];
let catalogAll = [];
let brewRow = null;
let brewRating = 0;
let currentRow = null;

const filters = { status: 'all', type: 'all', sort: 'ending' };
const expanded = { favorites: false, moderation: false };
const COLLAPSE_LIMIT = 3;

const statusOf = (r) =>
  r.amount <= 0 ? 'finished'
  : (r.amount <= (r.low_threshold ?? 0) ? 'low' : 'available');

// Имя записи журнала (чай из каталога, тизан или неизвестный)
function journalName(j) {
  if (j.tisane_id) return tisaneJournalName(j.tisane_id) || 'Тизан';
  if (j.unknown_id) return unknownJournalName(j) || 'Неизвестный чай';
  const tea = catalogAll.find((t) => t.id === j.tea_id);
  return tea ? tea.name : 'Чай';
}

// ---------- Загрузка ----------
async function load() {
  const user = getUser();
  if (!user) { shelf = []; journal = []; requests = []; favorites = []; return; }

  const [sh, j, rq, cat, fav] = await Promise.all([
    supabase.from(TABLES.shelf).select('*').eq('user_id', user.id),
    supabase.from(TABLES.journal).select('*').eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase.from(TABLES.catalog).select('*')
      .eq('status', 'pending').eq('author_id', user.id),
    supabase.from(TABLES.catalog).select('*'),
    supabase.from(TABLES.wishlist).select('tea_id').eq('user_id', user.id),
  ]);

  const uid = user.id;
  catalogAll = (cat.data || [])
    .filter((t) => t.status === 'published' || t.author_id === uid);

  const teaById = new Map(catalogAll.map((t) => [t.id, t]));
  shelf = (sh.data || []).map((r) => ({
    ...r,
    tea: teaById.get(r.tea_id) || { name: 'Чай', type: '—', region: '' },
  }));
  journal = j.data || [];
  requests = rq.data || [];
  favorites = (fav.data || []).map((r) => r.tea_id);
}

// ---------- Статистика ----------
function renderStats() {
  const rated = journal.filter((j) => j.rating);
  $('#statTeas').textContent =
    shelf.filter((r) => statusOf(r) !== 'finished').length || '0';
  $('#statBrews').textContent = journal.length || '0';
  $('#statRating').textContent = rated.length
    ? (rated.reduce((s, j) => s + j.rating, 0) / rated.length).toFixed(1)
    : '–';
  $('#statRestock').textContent =
    shelf.filter((r) => statusOf(r) !== 'available').length || '0';
}

// ---------- Что докупить ----------
function shoppingRowNode(r) {
  const node = document.createElement('div');
  node.className = 'buyrow';
  node.dataset.shelfId = r.id;
  node.innerHTML = `<label class="buy-check">
      <input type="checkbox" checked aria-label="Выбрать к закупке">
    </label>
    <div class="buy-info">
      <b>${escapeHtml(r.tea.name)}</b>
      <span class="${statusOf(r) === 'low' ? 'st-low' : 'st-fin'}">
        ${statusOf(r) === 'low' ? 'Мало' : 'Закончился'} · осталось ${r.amount} ${UNIT_LABELS[r.unit] || 'г'}
      </span>
    </div>
    <div class="buy-amt">
      <input type="number" min="1" step="1" value="50" inputmode="numeric" aria-label="Количество к дозакупке">
      <em>${UNIT_LABELS[r.unit] || 'г'}</em>
    </div>`;
  return node;
}

async function restockFromContainer(container) {
  const jobs = [];
  $$('.buyrow', container).forEach((node) => {
    if (!node.querySelector('input[type="checkbox"]').checked) return;
    const row = shelf.find((r) => String(r.id) === node.dataset.shelfId);
    const qty = Number(node.querySelector('input[type="number"]').value) || 0;
    if (row && qty > 0) {
      jobs.push(supabase.from(TABLES.shelf)
        .update({ amount: row.amount + qty }).eq('id', row.id));
    }
  });
  if (!jobs.length) return showToast('Отметьте хотя бы одну позицию', 'warn');

  await Promise.all(jobs);
  showToast('Полка пополнена');
  await load();
  renderAll();
  return true;
}

// ---------- Модальное окно пополнения (кнопка «Посмотреть») ----------
function ensureRestockModal() {
  if ($('#restockModalOverlay')) return;
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.id = 'restockModalOverlay';
  ov.hidden = true;
  ov.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="restockModalTitle">
      <div class="modal-head">
        <h2 id="restockModalTitle">Заканчиваются</h2>
        <button class="icon-btn" id="restockModalClose" type="button" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <p class="modal-sub">Отметьте, что дозакупить, и укажите количество.</p>
      <div id="restockModalList"></div>
      <div class="modal-foot">
        <button class="btn btn-ghost" type="button" id="restockModalCancel">Отмена</button>
        <button class="btn btn-primary" type="button" id="restockModalSubmit">Пополнить выбранные</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  wireOverlay(ov);
  $('#restockModalClose').addEventListener('click', () => closeOverlay(ov));
  $('#restockModalCancel').addEventListener('click', () => closeOverlay(ov));
  $('#restockModalSubmit').addEventListener('click', async () => {
    const ok = await restockFromContainer($('#restockModalList'));
    if (ok) {
      closeOverlay(ov);
      openRestockModal();
    }
  });
}

function openRestockModal() {
  ensureRestockModal();
  const box = $('#restockModalList');
  const rows = shelf.filter((r) => statusOf(r) === 'low');
  box.innerHTML = '';
  if (!rows.length) {
    box.innerHTML = '<p class="hint">Всё в порядке — ничего не заканчивается.</p>';
  } else {
    rows.forEach((r) => box.appendChild(shoppingRowNode(r)));
  }
  openOverlay($('#restockModalOverlay'));
}

// ---------- Избранное ----------
function favoritesRowNode(t) {
  const node = document.createElement('div');
  node.className = 'wrow';
  node.dataset.teaId = t.id;
  node.innerHTML = `<div class="wn"><b>${escapeHtml(t.name)}</b>
    <span>${escapeHtml(t.region || 'Избранное')}</span></div>
    <button class="btn btn-outline btn-sm" type="button" data-action="add-from-favorites">На полку</button>`;
  return node;
}

function renderFavorites() {
  const box = $('#favoritesList');
  if (!box) return;
  box.innerHTML = '';
  const teas = catalogAll.filter((t) => favorites.includes(t.id));
  $('#favoritesCount').textContent = teas.length;

  if (!teas.length) {
    box.innerHTML = '<p class="hint">Пока пусто. Отмечайте чаи сердцем в каталоге или на полке.</p>';
    return;
  }

  const list = expanded.favorites ? teas : teas.slice(0, COLLAPSE_LIMIT);
  list.forEach((t) => box.appendChild(favoritesRowNode(t)));

  if (teas.length > COLLAPSE_LIMIT) {
    box.appendChild(collapseBtn('favorites', teas.length));
  }
}

// ---------- Модерация ----------
function moderationRowNode(r) {
  const node = document.createElement('div');
  node.className = 'mrow';
  node.innerHTML = `<div class="wn"><b>${escapeHtml(r.name)}</b>
    <span>Заявка от ${r.created_at ? formatDate(r.created_at) : '—'}</span></div>`;
  return node;
}

function renderModeration() {
  const box = $('#moderationList');
  if (!box) return;
  $('#moderationCount').textContent = requests.length;
  box.innerHTML = '';

  if (!requests.length) {
    box.innerHTML = '<p class="hint">Заявок пока нет.</p>';
    return;
  }

  const list = expanded.moderation ? requests : requests.slice(0, COLLAPSE_LIMIT);
  list.forEach((r) => box.appendChild(moderationRowNode(r)));

  if (requests.length > COLLAPSE_LIMIT) {
    box.appendChild(collapseBtn('moderation', requests.length));
  }
}

function collapseBtn(key, total) {
  const btn = document.createElement('button');
  btn.className = 'btn btn-outline btn-sm';
  btn.type = 'button';
  btn.dataset.collapse = key;
  btn.textContent = expanded[key]
    ? 'Свернуть'
    : `Показать ещё (${total - COLLAPSE_LIMIT})`;
  return btn;
}

// ---------- Сетка полки ----------
function renderGrid() {
  const grid = $('#shelfGrid');
  grid.setAttribute('aria-busy', 'false');
  grid.innerHTML = '';

  const user = getUser();
  if (!user) {
    grid.innerHTML = `<div class="empty grid-col-span">
      <h3>Полка доступна после входа</h3>
      <p>Остатки и журнал привязаны к аккаунту.</p>
    </div>`;
    return;
  }

  const active = shelf.filter((r) => statusOf(r) !== 'finished');
  $('#countAll').textContent = active.length;
  $('#countLow').textContent = active.filter((r) => statusOf(r) === 'low').length;

  if (!shelf.length) {
    grid.innerHTML = `<div class="empty grid-col-span">
      <h3>Полка пока пуста</h3>
      <p>Добавьте первый чай из каталога — остатки и заваривания будут привязаны к вашему аккаунту.</p>
      <a class="btn btn-primary" href="catalog.html">Добавить из каталога</a>
    </div>`;
    return;
  }

  const list = active
    .filter((r) => !filters.q || (r.tea.name || '').toLowerCase().includes(filters.q))
    .filter((r) => filters.status === 'all' || statusOf(r) === filters.status)
    .filter((r) =>
      filters.type === 'all' || r.tea.type === TYPE_TO_DB[filters.type])
    .sort((a, b) => {
      if (filters.sort === 'ending') return a.amount - b.amount;
      if (filters.sort === 'name') return a.tea.name.localeCompare(b.tea.name, 'ru');
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });

  if (!list.length) {
    grid.innerHTML = `<div class="empty grid-col-span">
      <h3>Ничего не найдено</h3>
      <p>Попробуйте другой фильтр.</p>
    </div>`;
    return;
  }

  list.forEach((r) => grid.appendChild(cardNode(r)));
}

// ---------- Карточка полки ----------
function cardNode(r) {
  const node = $('#shelfCardTemplate').content.firstElementChild.cloneNode(true);
  node.dataset.shelfId = r.id;
  node.dataset.teaId = r.tea_id;

  const st = statusOf(r);
  const pill = node.querySelector('.pill');
  pill.className = 'pill ' + { available: 'pill-active', low: 'pill-low', finished: 'pill-finished' }[st];
  pill.lastChild.textContent = { available: 'В наличии', low: 'Мало', finished: 'Закончился' }[st];

  const chip = node.querySelector('.typechip');
  chip.textContent = r.tea.type || '—';
  chip.className = 'typechip ' + typeClass(r.tea.type);

  const brews = journal.filter((j) => j.tea_id === r.tea_id);
  const rated = brews.filter((j) => j.rating);
  const rate = node.querySelector('.rate-badge');
  if (rated.length) {
    rate.textContent = '★ ' + (rated.reduce((s, j) => s + j.rating, 0) / rated.length).toFixed(1);
    rate.classList.remove('hidden');
  }

  node.querySelector('.card-name').textContent = r.tea.name;

  const qtyVals = node.querySelectorAll('.qty-val');
  const qtySep = node.querySelector('.qty-sep');

  qtyVals[0].innerHTML = `${r.amount} <em>${UNIT_LABELS[r.unit] || 'г'}</em>`;

  const dose = r.tea.grams ? Number(r.tea.grams) : 0;
  if (r.unit === 'g' && dose > 0 && r.amount > 0) {
    const approx = Math.floor(r.amount / dose);
    qtySep.classList.remove('hidden');
    qtyVals[1].classList.remove('hidden');
    qtyVals[1].innerHTML =
      `~${approx} <em>${plural(approx, ['заваривание', 'заваривания', 'завариваний'])}</em>`;
  } else {
    qtySep.classList.add('hidden');
    qtyVals[1].classList.add('hidden');
  }

  node.querySelector('.journal-btn')
    .classList.toggle('hidden', brews.length === 0);

  const fill = node.querySelector('.bar-fill');
  fill.className = 'bar-fill ' + { available: 'bar-active', low: 'bar-low', finished: 'bar-finished' }[st];
  fill.style.width = Math.max(4, Math.min(100, (r.amount / 150) * 100)) + '%';

  node.querySelector('.fav-btn').classList.toggle('on', favorites.includes(r.tea_id));
  node.classList.toggle('low-ring', st === 'low');
  return node;
}



function renderAll() {
  renderStats();
  renderFavorites();
  renderModeration();
  renderGrid();
  renderTisanes();
  renderUnknowns();

  const low = shelf.filter((r) => statusOf(r) === 'low').length;
  $('#shelfBanner')?.classList.toggle('hidden', !low);
  if (low && $('#shelfBannerText')) {
    $('#shelfBannerText').textContent =
      `${low} ${plural(low, ['чай заканчивается', 'чая заканчиваются', 'чаёв заканчиваются'])}.`;
  }
}

// ---------- Журнал записей (универсальная модалка) ----------
function openJournalEntries(name, entries) {
  const ov = $('#journalOverlay');
  if (!ov) return;
  $('#journalOvTeaName').textContent = name;
  const list = $('#journalOvList');
  list.innerHTML = '';

  if (!entries.length) {
    list.innerHTML = '<p class="hint">Нет записей.</p>';
  } else {
    entries.forEach((j) => {
      const node = document.createElement('div');
      node.className = 'jentry';
      node.innerHTML = `
        <div class="jdate">${j.created_at ? formatDate(j.created_at) : '—'}</div>
        <div class="jbody">
          <div class="jm">${j.amount} ${UNIT_LABELS[j.unit] || 'г'}</div>
          ${j.note ? `<div class="jnote">${escapeHtml(j.note)}</div>` : ''}
          ${j.rating ? `<div class="jstars">${'★'.repeat(j.rating)}${'☆'.repeat(5 - j.rating)}</div>` : ''}
        </div>`;
      list.appendChild(node);
    });
  }
  openOverlay(ov);
}

function openTeaJournal(teaId, teaName) {
  openJournalEntries(teaName, journal.filter((j) => j.tea_id === teaId));
}

function initJournalOverlay() {
  const ov = $('#journalOverlay');
  if (!ov) return;
  wireOverlay(ov);
  $('#journalOvClose')?.addEventListener('click', () => closeOverlay(ov));
}

// ============================================================
// АРХИВ ЧАЯ: модальное окно с тремя вкладками
// ============================================================
// ---------- Модалки архива: создание и защита от старой разметки ----------
let archiveModalsWired = false;

function ensureArchiveModals() {
  // Если в HTML остались старые версии модалок с другой разметкой — удаляем
  const oldArchive = $('#archiveOverlay');
  if (oldArchive && !$('#archiveTeaList')) oldArchive.remove();
  const oldJournal = $('#journalArchiveOverlay');
  if (oldJournal && !$('#journalArchiveTea')) oldJournal.remove();

  if (!$('#archiveOverlay')) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.id = 'archiveOverlay';
    ov.hidden = true;
    ov.innerHTML = `
      <div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="archiveModalTitle">
        <div class="modal-head">
          <h2 id="archiveModalTitle">Архив чая</h2>
          <button class="icon-btn" id="archiveModalClose" type="button" aria-label="Закрыть">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div class="archive-tabs" role="tablist">
          <button class="archive-tab active" type="button" data-tab="tea" role="tab" aria-selected="true">Чай</button>
          <button class="archive-tab" type="button" data-tab="tisane" role="tab" aria-selected="false">Тизаны</button>
          <button class="archive-tab" type="button" data-tab="unknown" role="tab" aria-selected="false">Неизвестные</button>
        </div>
        <div class="archive-content">
          <div id="archiveTeaList" class="archive-section" role="tabpanel"></div>
          <div id="archiveTisaneList" class="archive-section hidden" role="tabpanel"></div>
          <div id="archiveUnknownList" class="archive-section hidden" role="tabpanel"></div>
        </div>
      </div>`;
    document.body.appendChild(ov);
  }

  if (!$('#journalArchiveOverlay')) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.id = 'journalArchiveOverlay';
    ov.hidden = true;
    ov.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="journalArchiveTitle">
        <div class="modal-head">
          <h2 id="journalArchiveTitle">Журналы завариваний</h2>
          <button class="icon-btn" id="journalArchiveClose" type="button" aria-label="Закрыть">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <p class="modal-sub">Все журналы завариваний: текущие записи и архив удалённых.</p>
        <div class="archive-tabs" role="tablist">
          <button class="archive-tab active" type="button" data-tab="tea" role="tab" aria-selected="true">Чай</button>
          <button class="archive-tab" type="button" data-tab="tisane" role="tab" aria-selected="false">Тизаны</button>
          <button class="archive-tab" type="button" data-tab="unknown" role="tab" aria-selected="false">Неизвестные</button>
        </div>
        <div id="journalArchiveTea" class="archive-section journal-tea-list"></div>
        <div id="journalArchiveTisane" class="archive-section journal-tea-list hidden"></div>
        <div id="journalArchiveUnknown" class="archive-section journal-tea-list hidden"></div>
      </div>`;
    document.body.appendChild(ov);
  }

  // Вешаем обработчики только один раз
  if (archiveModalsWired) return;
  archiveModalsWired = true;

  wireOverlay($('#archiveOverlay'));
  $('#archiveModalClose')?.addEventListener('click', () => closeOverlay($('#archiveOverlay')));
  wireOverlay($('#journalArchiveOverlay'));
  $('#journalArchiveClose')?.addEventListener('click', () => closeOverlay($('#journalArchiveOverlay')));

  // Переключение вкладок (обе модалки)
  [['#archiveOverlay', { tea: '#archiveTeaList', tisane: '#archiveTisaneList', unknown: '#archiveUnknownList' }],
   ['#journalArchiveOverlay', { tea: '#journalArchiveTea', tisane: '#journalArchiveTisane', unknown: '#journalArchiveUnknown' }]]
    .forEach(([sel, map]) => {
      const ov = $(sel);
      ov.querySelector('.archive-tabs')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.archive-tab');
        if (!btn) return;
        ov.querySelectorAll('.archive-tab').forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        Object.entries(map).forEach(([tab, id]) => {
          $(id)?.classList.toggle('hidden', tab !== btn.dataset.tab);
        });
      });
    });

  // Действия в архиве чая
  $('#archiveTeaList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const rowEl = btn.closest('.archrow');
    const row = shelf.find((r) => String(r.id) === rowEl?.dataset.shelfId);
    if (!row) return;
    if (btn.dataset.action === 'restock') return restockRow(row);
    if (btn.dataset.action === 'remove') return removeTeaFromArchive(row);
    if (btn.dataset.action === 'open-journal') return openTeaJournal(row.tea_id, row.tea.name);
  });

  $('#archiveTisaneList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const rowEl = btn.closest('.archrow');
    const id = rowEl?.dataset.tisaneId;
    if (!id) return;
    if (btn.dataset.action === 'restock') return restockArchivedTisane(id);
    if (btn.dataset.action === 'remove') return removeTisaneFromArchive(id, rowEl.querySelector('b')?.textContent || 'Тизан');
    if (btn.dataset.action === 'open-journal') {
      openJournalEntries(rowEl.querySelector('b')?.textContent || 'Тизан',
        journal.filter((j) => j.tisane_id === id));
    }
  });

  $('#archiveUnknownList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const rowEl = btn.closest('.archrow');
    const id = rowEl?.dataset.unknownId;
    if (!id) return;
    if (btn.dataset.action === 'remove') return removeUnknownFromArchive(id, rowEl.querySelector('b')?.textContent || 'Неизвестный чай');
    if (btn.dataset.action === 'open-journal') {
      openJournalEntries(rowEl.querySelector('b')?.textContent || 'Неизвестный чай',
        journal.filter((j) => j.unknown_id === id));
    }
  });
}

function archiveRowNode(dataset, name, sub, actions) {
  const node = document.createElement('div');
  node.className = 'archrow';
  Object.entries(dataset).forEach(([k, v]) => { node.dataset[k] = v; });
  node.innerHTML = `
    <div class="wn">
      <b>${escapeHtml(name)}</b>
      <span>${escapeHtml(sub)}</span>
    </div>
    <div class="arch-actions">
      ${actions.includes('restock') ? '<button class="btn btn-outline btn-sm" type="button" data-action="restock">Пополнить</button>' : ''}
      <button class="btn btn-ghost btn-sm" type="button" data-action="open-journal">Журнал</button>
      <button class="btn btn-ghost btn-sm danger-text" type="button" data-action="remove">Удалить</button>
    </div>`;
  return node;
}

async function openArchiveModal() {
  ensureArchiveModals();
  const user = getUser();
  if (!user) return;

  // Чай
  const teaBox = $('#archiveTeaList');
  teaBox.innerHTML = '';
  const finishedTeas = shelf.filter((r) => statusOf(r) === 'finished');
  if (!finishedTeas.length) {
    teaBox.innerHTML = '<p class="hint">Пока пусто. Когда чай закончится, он переедет сюда.</p>';
  } else {
    finishedTeas
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .forEach((r) => teaBox.appendChild(archiveRowNode(
        { shelfId: r.id },
        r.tea.name,
        `Закончился · ${r.amount} ${UNIT_LABELS[r.unit] || 'г'}`,
        ['restock'],
      )));
  }

  // Тизаны
  const { data: finTisanes } = await supabase.from('user_tisanes')
    .select('*, tisane_catalog(*)')
    .eq('user_id', user.id)
    .lte('quantity', 0);
  const tisBox = $('#archiveTisaneList');
  tisBox.innerHTML = '';
  const tRows = finTisanes || [];
  if (!tRows.length) {
    tisBox.innerHTML = '<p class="hint">Пока пусто. Когда тизан закончится, он переедет сюда.</p>';
  } else {
    tRows.forEach((r) => {
      const name = r.custom_name || r.tisane_catalog?.name || `Тизан #${r.tisane_catalog?.tisane_number ?? '–'}`;
      tisBox.appendChild(archiveRowNode(
        { tisaneId: r.id },
        name,
        `Закончился · ${Number(r.quantity)} ${UNIT_LABELS[r.quantity_unit] || 'г'}`,
        ['restock'],
      ));
    });
  }

  // Неизвестные
  const { data: unknowns } = await supabase.from('unknown_teas')
    .select('*')
    .eq('user_id', user.id)
    .in('status', ['finished', 'archived']);
  const unBox = $('#archiveUnknownList');
  unBox.innerHTML = '';
  const uRows = unknowns || [];
  if (!uRows.length) {
    unBox.innerHTML = '<p class="hint">Пока пусто.</p>';
  } else {
    uRows.forEach((r) => {
      unBox.appendChild(archiveRowNode(
        { unknownId: r.id },
        `${r.name || 'Неизвестный чай'} #${r.unknown_number}`,
        r.status === 'archived' ? 'В архиве' : 'Завершён',
        [],
      ));
    });
  }

  openOverlay($('#archiveOverlay'));
}

// ---------- Удаление из архива со снапшотом журнала ----------
async function snapshotAndDeleteJournal(user, filter, sourceType, sourceRef) {
  const { data: entries } = await supabase.from(TABLES.journal)
    .select('*').eq('user_id', user.id);
  const mine = (entries || []).filter(filter);
  if (mine.length) {
    await supabase.from('brew_journal_archive').insert({
      user_id: user.id,
      source_type: sourceType,
      source_ref: sourceRef,
      payload: mine,
    });
    await supabase.from(TABLES.journal).delete()
      .eq('user_id', user.id);
    // удаляем только нужные строки по id
    await Promise.all(mine.map((m) =>
      supabase.from(TABLES.journal).delete().eq('id', m.id)));
  }
}

async function removeTeaFromArchive(row) {
  const ok = await askConfirm({
    title: 'Удалить из архива',
    text: `Вы уверены, что хотите удалить «${row.tea.name}» из архива? Журнал завариваний будет сохранён в архиве журналов.`,
    okLabel: 'Удалить',
  });
  if (!ok) return;
  const user = getUser();
  if (!user) return;

  await snapshotAndDeleteJournal(user, (j) => j.tea_id === row.tea_id, 'tea', row.tea.name);
  const { error } = await supabase.from(TABLES.shelf).delete().eq('id', row.id);
  if (error) return showToast('Ошибка удаления: ' + error.message, 'warn');

  showToast('Удалено. Журнал сохранён в архиве журналов.');
  await load();
  renderAll();
  openArchiveModal();
}

async function restockArchivedTisane(id) {
  const { data: row } = await supabase.from('user_tisanes')
    .select('*').eq('id', id).single();
  if (!row) return;
  openAmountModal({
    mode: 'restock',
    teaName: 'Тизан',
    unit: row.quantity_unit,
    onSubmit: async (p) => {
      const { error } = await supabase.from('user_tisanes')
        .update({ quantity: Number(row.quantity) + p.amount }).eq('id', id);
      if (error) return showToast('Ошибка: ' + error.message, 'warn');
      showToast('Пополнено');
      await reloadTisanes();
      renderTisanes();
      await load();
      renderAll();
      openArchiveModal();
    },
  });
}

async function removeTisaneFromArchive(id, name) {
  const ok = await askConfirm({
    title: 'Удалить из архива',
    text: `Вы уверены, что хотите удалить «${name}» из архива? Журнал завариваний будет сохранён в архиве журналов.`,
    okLabel: 'Удалить',
  });
  if (!ok) return;
  const user = getUser();
  if (!user) return;

  await snapshotAndDeleteJournal(user, (j) => j.tisane_id === id, 'tisane', name);
  const { error } = await supabase.from('user_tisanes').delete().eq('id', id);
  if (error) return showToast('Ошибка удаления: ' + error.message, 'warn');

  showToast('Удалено. Журнал сохранён в архиве журналов.');
  await reloadTisanes();
  renderTisanes();
  await load();
  renderAll();
  openArchiveModal();
}

async function removeUnknownFromArchive(id, name) {
  const ok = await askConfirm({
    title: 'Удалить из архива',
    text: `Вы уверены, что хотите удалить «${name}» из архива? Журнал завариваний будет сохранён в архиве журналов.`,
    okLabel: 'Удалить',
  });
  if (!ok) return;

  const { error } = await supabase.rpc('unknown_lifecycle_action', {
    p_unknown_id: id,
    p_action: 'delete',
  });
  if (error) return showToast('Ошибка удаления: ' + error.message, 'warn');

  showToast('Удалено. Журнал сохранён в архиве журналов.');
  await reloadUnknowns();
  renderUnknowns();
  await load();
  renderAll();
  openArchiveModal();
}

// ============================================================
// АРХИВ ЖУРНАЛОВ: три вкладки + CSV
// ============================================================
function downloadCsv(a) {
  const rows = [['дата', 'чай', 'количество', 'единица', 'оценка', 'заметка']];
  (a.payload || []).forEach((e) => rows.push([
    e.created_at ? new Date(e.created_at).toLocaleDateString('ru-RU') : '',
    a.source_ref,
    e.amount ?? '',
    e.unit ?? '',
    e.rating ?? '',
    e.note ?? '',
  ]));
  const csv = rows
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'))
    .join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `journal-${(a.source_ref || 'archive').replace(/[^\wа-яё-]+/gi, '_')}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function journalArchiveRow(a) {
  const node = document.createElement('div');
  node.className = 'jentry';
  node.innerHTML = `
    <div class="jdate">${new Date(a.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' })}</div>
    <div class="jbody">
      <b>${escapeHtml(a.source_ref)}</b>
      <div class="jm">${(a.payload || []).length} ${plural((a.payload || []).length, ['запись', 'записи', 'записей'])}</div>
    </div>
    <button class="btn btn-outline btn-sm" type="button">CSV</button>`;
  node.querySelector('button').addEventListener('click', () => downloadCsv(a));
  return node;
}

// ---------- Строка текущего журнала ----------
function liveJournalRow(j) {
  const node = document.createElement('div');
  node.className = 'jentry';
  node.innerHTML = `
    <div class="jdate">${j.created_at ? formatDate(j.created_at) : '—'}</div>
    <div class="jbody">
      <b>${escapeHtml(journalName(j))}</b>
      <div class="jm">${j.amount} ${UNIT_LABELS[j.unit] || 'г'}</div>
      ${j.note ? `<div class="jnote">${escapeHtml(j.note)}</div>` : ''}
      ${j.rating ? `<div class="jstars">${'★'.repeat(j.rating)}${'☆'.repeat(5 - j.rating)}</div>` : ''}
    </div>`;
  return node;
}

// ============================================================
// ЖУРНАЛ ЗАВАРИВАНИЙ (модалка «Архив журналов»): ВСЕ журналы —
// текущие записи + архив удалённых, по вкладкам чай/тизаны/неизвестные
// ============================================================
async function openJournalArchiveModal() {
  ensureArchiveModals();
  const user = getUser();
  if (!user) return;

  // Текущие (живые) журналы
  const { data: live } = await supabase.from(TABLES.journal)
    .select('*').eq('user_id', user.id)
    .order('created_at', { ascending: false });
  const liveRows = live || [];

  const liveGroups = {
    tea: liveRows.filter((j) => j.tea_id),
    tisane: liveRows.filter((j) => j.tisane_id),
    unknown: liveRows.filter((j) => j.unknown_id),
  };

  // Архивные снапшоты удалённых
  const { data: arch } = await supabase.from('brew_journal_archive')
    .select('*').eq('user_id', user.id)
    .order('created_at', { ascending: false });
  const archRows = arch || [];

  const archGroups = {
    tea: archRows.filter((r) => r.source_type === 'tea' || !r.source_type),
    tisane: archRows.filter((r) => r.source_type === 'tisane'),
    unknown: archRows.filter((r) => r.source_type === 'unknown'),
  };

  const sections = {
    tea: '#journalArchiveTea',
    tisane: '#journalArchiveTisane',
    unknown: '#journalArchiveUnknown',
  };

  Object.entries(sections).forEach(([key, sel]) => {
    const box = $(sel);
    box.innerHTML = '';

    const liveTitle = document.createElement('p');
    liveTitle.className = 'hint';
    liveTitle.textContent = 'Текущий журнал';
    box.appendChild(liveTitle);

    if (!liveGroups[key].length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'Нет записей.';
      box.appendChild(empty);
    } else {
      liveGroups[key].slice(0, 50).forEach((j) => box.appendChild(liveJournalRow(j)));
    }

    const archTitle = document.createElement('p');
    archTitle.className = 'hint';
    archTitle.style.marginTop = '12px';
    archTitle.textContent = 'Архив (удалённые)';
    box.appendChild(archTitle);

    if (!archGroups[key].length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'Архив пуст.';
      box.appendChild(empty);
    } else {
      archGroups[key].forEach((a) => box.appendChild(journalArchiveRow(a)));
    }
  });

  openOverlay($('#journalArchiveOverlay'));
}

// ---------- Заваривание (RPC brew_tea) ----------
function initBrew() {
  const ov = $('#brewOverlay');
  if (!ov) return;
  wireOverlay(ov);
  $('#brewClose')?.addEventListener('click', () => closeOverlay(ov));
  $('#brewCancel')?.addEventListener('click', () => closeOverlay(ov));

  const amount = $('#brewAmount');
  if (!amount) return;
  const preview = () => {
    if (!brewRow) return;
    const left = Math.max(0, brewRow.amount - Number(amount.value || 0));
    $('#brewRemaining').textContent = `${left} ${UNIT_LABELS[brewRow.unit] || 'г'}`;
  };
  amount.addEventListener('input', preview);

  $('#brewPresets')?.addEventListener('click', (e) => {
    const b = e.target.closest('.preset');
    if (!b) return;
    $$('#brewPresets .preset').forEach((p) => p.classList.remove('sel'));
    b.classList.add('sel');
    amount.value = b.dataset.amount;
    preview();
  });

  $('#brewStars')?.addEventListener('click', (e) => {
    const b = e.target.closest('.star-btn');
    if (!b) return;
    brewRating = Number(b.dataset.value);
    $$('#brewStars .star-btn').forEach((s) => {
      s.classList.toggle('on', Number(s.dataset.value) <= brewRating);
      s.setAttribute('aria-checked', String(s === b));
    });
  });

  $('#brewForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!brewRow) return;
    const used = Number(amount.value);
    if (!used || used <= 0) return showToast('Укажите количество', 'warn');
    if (used > brewRow.amount) return showToast('На полке меньше этого количества', 'warn');

    const unit = brewRow.unit;

    const { data, error } = await supabase.rpc('brew_tea', {
      p_shelf_id: brewRow.id,
      p_amount: used,
      p_rating: brewRating || null,
      p_note: $('#brewNote').value.trim() || null,
    });
    if (error) return showToast('Ошибка: ' + error.message, 'warn');

    closeOverlay(ov);
    $('#brewForm').reset();
    brewRow = null;
    brewRating = 0;
    $$('#brewStars .star-btn').forEach((s) => {
      s.classList.remove('on');
      s.setAttribute('aria-checked', 'false');
    });
    $$('#brewPresets .preset').forEach((p) => p.classList.remove('sel'));

    const left = Number(data);
    showToast(left <= 0
      ? 'Заваривание записано. Чай закончился и переехал в архив'
      : `Заваривание записано. Осталось ${left} ${UNIT_LABELS[unit] || 'г'}`);
    await load();
    renderAll();
  });
}

function openBrew(row) {
  brewRow = row;
  brewRating = 0;
  $('#brewTeaName').textContent = row.tea.name;
  $('#brewTeaId').value = row.tea_id;
  $('#brewAmount').value = Math.min(7, row.amount) || 1;
  $('#brewNote').value = '';
  $$('#brewStars .star-btn').forEach((s) => {
    s.classList.remove('on');
    s.setAttribute('aria-checked', 'false');
  });
  $$('#brewPresets .preset').forEach((p) => p.classList.remove('sel'));
  openOverlay($('#brewOverlay'));
  $('#brewAmount').dispatchEvent(new Event('input'));
}

// ---------- Операции с количеством ----------
function restockRow(row) {
  openAmountModal({
    mode: 'restock',
    teaName: row.tea.name,
    unit: row.unit,
    onSubmit: async (p) => {
      await supabase.from(TABLES.shelf)
        .update({ amount: row.amount + p.amount }).eq('id', row.id);
      showToast(`Пополнено на ${p.amount} ${UNIT_LABELS[row.unit] || 'г'}`);
      await load(); renderAll();
    },
  });
}

function editAmount(row) {
  openAmountModal({
    mode: 'edit',
    teaName: row.tea.name,
    unit: row.unit,
    amount: row.amount,
    threshold: row.low_threshold ?? 20,
    onSubmit: async (p) => {
      await supabase.from(TABLES.shelf)
        .update({
          amount: p.amount,
          unit: p.unit,
          low_threshold: p.threshold,
        })
        .eq('id', row.id);
      showToast('Позиция обновлена');
      await load(); renderAll();
    },
  });
}

async function removeRow(row) {
  const ok = await askConfirm({
    title: 'Убрать с полки',
    text: `Убрать «${row.tea.name}» с полки? История завариваний останется в журнале.`,
    okLabel: 'Убрать',
  });
  if (!ok) return;

  await supabase.from(TABLES.shelf).delete().eq('id', row.id);
  showToast('Чай убран с полки');
  await load(); renderAll();
}

// ---------- Избранное ----------
function syncFavBtn(teaId) {
  const label = $('#wishlistBtnText');
  if (!label || teaId == null) return;
  label.textContent = favorites.includes(teaId) ? 'В избранном ✓' : 'В избранное';
}

async function toggleFav(row) {
  const user = getUser();
  if (!user) { showToast('Сначала войдите', 'warn'); return; }
  const id = row.tea_id;

  if (favorites.includes(id)) {
    await supabase.from(TABLES.wishlist).delete()
      .eq('user_id', user.id).eq('tea_id', id);
    favorites = favorites.filter((x) => x !== id);
    showToast(`«${row.tea.name}» убран из избранного`);
  } else {
    const { error } = await supabase.from(TABLES.wishlist)
      .insert({ user_id: user.id, tea_id: id });
    if (error) return showToast('Не удалось добавить: ' + error.message, 'warn');
    favorites.push(id);
    showToast(`«${row.tea.name}» — в избранном`);
  }
  syncFavBtn(id);
  renderGrid();
  renderFavorites();
}

function addFromFavorites(teaId) {
  const tea = catalogAll.find((t) => String(t.id) === String(teaId));
  if (!tea) return;
  if (shelf.some((r) => r.tea_id === tea.id)) {
    return showToast('Этот чай уже на полке', 'warn');
  }

  openAmountModal({
    mode: 'add',
    teaName: tea.name,
    onSubmit: async (p) => {
      const user = getUser();
      const { error } = await supabase.from(TABLES.shelf).insert({
        user_id: user.id,
        tea_id: tea.id,
        amount: p.amount,
        unit: p.unit,
        low_threshold: p.threshold,
      });
      if (error) {
        if (error.code === '23505') return showToast('Этот чай уже на полке', 'warn');
        return showToast('Не удалось добавить: ' + error.message, 'warn');
      }
      showToast(`«${tea.name}» добавлен на полку`);
      await load(); renderAll();
    },
  });
}

function initFavorites() {
  $('#favoritesList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="add-from-favorites"]');
    if (!btn) return;
    const row = btn.closest('.wrow');
    addFromFavorites(row.dataset.teaId);
  });
}

// ---------- Фильтры ----------
function initFilters() {
  $$('.tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tabs .tab').forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-pressed', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-pressed', 'true');
      filters.status = tab.dataset.status;
      renderGrid();
    });
  });

  $('#shelfSearch')?.addEventListener('input', (e) => {
    filters.q = e.target.value.trim().toLowerCase();
    renderGrid();
  });

  $('#shelfTypeFilter')?.addEventListener('change', (e) => { filters.type = e.target.value; renderGrid(); });
  $('#shelfSort')?.addEventListener('change', (e) => { filters.sort = e.target.value; renderGrid(); });
}

// ---------- Старт ----------
async function init() {
  await initCommon();
  initAmountModal();
  initFilters();
  initBrew();
  initFavorites();
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-collapse]');
    if (!btn) return;
    const key = btn.dataset.collapse;
    expanded[key] = !expanded[key];
    if (key === 'favorites') renderFavorites();
    if (key === 'moderation') renderModeration();
  });
  initJournalOverlay();
  ensureArchiveModals();

  $('#openArchiveBtn')?.addEventListener('click', openArchiveModal);
  $('#openJournalArchiveBtn')?.addEventListener('click', openJournalArchiveModal);
  $('#shelfBannerAction')?.addEventListener('click', openRestockModal);

  $('#addToShelfBtn')?.addEventListener('click', () => {
    if (currentRow) restockRow(currentRow);
  });
  $('#wishlistBtn')?.addEventListener('click', async () => {
    if (currentRow) await toggleFav(currentRow);
  });

  $('#shelfGrid')?.addEventListener('click', async (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const row = shelf.find((r) => String(r.id) === card.dataset.shelfId);
    if (!row) return;

    if (e.target.closest('[data-action="brew"]')) return openBrew(row);
    if (e.target.closest('[data-action="restock"]')) return restockRow(row);
    if (e.target.closest('[data-action="edit"]')) return editAmount(row);
    if (e.target.closest('[data-action="remove"]')) return removeRow(row);
    if (e.target.closest('[data-action="toggle-favorite"]')) return toggleFav(row);
    if (e.target.closest('[data-action="open-journal"]')) return openTeaJournal(row.tea_id, row.tea.name);
    if (e.target.closest('[data-action="open-menu"]')) {
      const menu = e.target.closest('.menu-wrap').querySelector('.menu');
      $$('#shelfGrid .menu').forEach((m) => m !== menu && m.classList.add('hidden'));
      menu.classList.toggle('hidden');
      return;
    }

    currentRow = row;
    openTeaModal(row.tea, catalogAll);
    syncFavBtn(row.tea_id);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-wrap')) {
      $$('#shelfGrid .menu').forEach((m) => m.classList.add('hidden'));
    }
  });

  onAuthChange(async () => {
    await load();
    await reloadTisanes();
    await reloadUnknowns();
    renderAll();
  });

  window.addEventListener('tea-shelf-changed', async () => {
    await load();
    renderAll();
  });

  try {
    await load();
    await initTisanes();
    await initUnknowns();
    renderAll();
  } catch (err) {
    $('#shelfGrid')?.setAttribute('aria-busy', 'false');
    if ($('#shelfGrid')) {
      $('#shelfGrid').innerHTML = `<div class="empty grid-col-span">
        <h3>Не удалось загрузить полку</h3>
        <p>${escapeHtml(err.message || 'Проверьте подключение и ключи Supabase.')}</p>
      </div>`;
    }
  }
}

init();