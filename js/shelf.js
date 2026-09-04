// ============================================================
// shelf.js — логика страницы shelf.html
// ЭТАП 6: Архив вынесен в модальное окно с тремя вкладками.
// Архив журналов также с разделением на чай/тизаны/неизвестные.
// ============================================================
import { initCommon } from './common.js';
import { supabase } from './supabaseClient.js';
import { TABLES } from './config.js';
import {
  $, $$, showToast, openOverlay, closeOverlay, wireOverlay,
  escapeHtml, plural, formatDate, typeClass, TYPE_TO_DB,
  UNIT_LABELS, toTags, trackEvent, askConfirm, setInvalid,
} from './ui.js';
import { getUser, onAuthChange } from './auth.js';
import { initTisanes, reloadTisanes, renderTisanes, tisaneJournalName } from './tisanes.js';
import { initUnknowns, reloadUnknowns, renderUnknowns, unknownJournalName } from './unknowns.js';
import { openTeaModal } from './teaModal.js';
import { initAmountModal, openAmountModal } from './amountModal.js';

let shelf = [];
let journal = [];
let catalog = [];

const filters = { q: '', status: 'all', type: 'all', sort: 'ending' };

const statusOf = (r) =>
  r.amount <= 0 ? 'finished'
  : (r.amount <= (r.low_threshold ?? 0) ? 'low' : 'available');

// ---------- Загрузка данных ----------
async function loadData() {
  const user = getUser();
  if (!user) {
    shelf = [];
    journal = [];
    catalog = [];
    return;
  }

  const [sh, j, cat] = await Promise.all([
    supabase.from(TABLES.shelf)
      .select('*, tea:tea_catalog(*)')
      .eq('user_id', user.id),
    supabase.from('brew_journal')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from(TABLES.catalog)
      .select('id, name, type, region, photo_url, temp, time, grams, steeps, tags, description')
      .eq('status', 'published'),
  ]);

  shelf = sh.data || [];
  journal = j.data || [];
  catalog = cat.data || [];
}

// ---------- Сводка ----------
function renderStats() {
  const active = shelf.filter((r) => statusOf(r) !== 'finished');
  const low = active.filter((r) => statusOf(r) === 'low');
  $('#statTotal').textContent = active.length;
  $('#statLow').textContent = low.length;
  $('#statBrews').textContent = journal.length;
}

// ---------- Сетка полки ----------
function renderGrid() {
  const grid = $('#shelfGrid');
  grid.setAttribute('aria-busy', 'false');
  grid.innerHTML = '';

  const user = getUser();
  if (!user) {
    grid.innerHTML = `<div class="empty grid-col-span">
      <h3>Войдите, чтобы видеть полку</h3>
      <p>Полка привязана к аккаунту — остатки и заваривания хранятся в облаке.</p>
    </div>`;
    return;
  }

  const active = shelf.filter((r) => statusOf(r) !== 'finished');
  $('#countAll').textContent = active.length;
  $('#countLow').textContent = active.filter((r) => statusOf(r) === 'low').length;

  if (!active.length) {
    grid.innerHTML = `<div class="empty grid-col-span" id="shelfEmpty">
      <h3>Полка пока пуста</h3>
      <p>Добавьте первый чай из каталога — остатки и заваривания будут привязаны к вашему аккаунту.</p>
      <a class="btn btn-primary" href="catalog.html">Добавить из каталога</a>
    </div>`;
    return;
  }

  const list = active
    .filter((r) => !filters.q || (r.tea?.name || '').toLowerCase().includes(filters.q))
    .filter((r) => filters.status === 'all' || statusOf(r) === filters.status)
    .filter((r) =>
      filters.type === 'all' || r.tea?.type === TYPE_TO_DB[filters.type])
    .sort((a, b) => {
      if (filters.sort === 'ending') return a.amount - b.amount;
      if (filters.sort === 'name') return (a.tea?.name || '').localeCompare(b.tea?.name || '', 'ru');
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });

  if (!list.length) {
    grid.innerHTML = `<div class="empty grid-col-span">
      <h3>Ничего не найдено</h3>
      <p>Попробуйте изменить фильтры.</p>
    </div>`;
    return;
  }

  list.forEach((r) => grid.appendChild(cardNode(r)));
}

// ---------- Карточка чая ----------
function cardNode(r) {
  const node = $('#shelfCardTemplate').content.firstElementChild.cloneNode(true);
  node.dataset.shelfId = r.id;
  node.dataset.teaId = r.tea_id;

  const tea = r.tea || {};
  const st = statusOf(r);

  const pill = node.querySelector('.pill');
  if (st === 'low') {
    pill.className = 'pill pill-low';
    pill.innerHTML = '<i aria-hidden="true"></i>Мало';
  } else {
    pill.className = 'pill pill-active';
    pill.innerHTML = '<i aria-hidden="true"></i>' + (tea.type || '');
  }

  node.querySelector('.card-name').textContent = tea.name || 'Без названия';

  const qtyVal = node.querySelector('.qty-val');
  qtyVal.innerHTML = `${r.amount} <em>${UNIT_LABELS[r.unit] || 'г'}</em>`;

  // Прогресс-бар
  const bar = node.querySelector('.bar-fill');
  const maxAmount = Math.max(r.amount, r.low_threshold * 2, 1);
  const pct = Math.min(100, Math.round((r.amount / maxAmount) * 100));
  bar.style.width = pct + '%';
  bar.className = 'bar-fill ' + (st === 'low' ? 'bar-low' : 'bar-active');

  return node;
}

// ---------- «Что докупить» ----------
function renderBuyList() {
  const box = $('#buyList');
  if (!box) return;

  const active = shelf.filter((r) => statusOf(r) === 'low');
  $('#buyCount').textContent = active.length;

  box.innerHTML = '';
  if (!active.length) {
    box.innerHTML = '<p class="hint">Всё в порядке — ничего не заканчивается.</p>';
    return;
  }

  active
    .sort((a, b) => a.amount - b.amount)
    .forEach((r) => {
      const node = document.createElement('div');
      node.className = 'buyrow';
      node.innerHTML = `
        <div class="wn">
          <b>${escapeHtml(r.tea?.name || '—')}</b>
          <span>Осталось ${r.amount} ${UNIT_LABELS[r.unit] || 'г'}</span>
        </div>
        <button class="btn btn-outline btn-sm" type="button" data-action="restock">Пополнить</button>`;
      box.appendChild(node);
    });
}

// ---------- Журнал полки ----------
function renderJournal() {
  const box = $('#journalList');
  if (!box) return;

  box.innerHTML = '';
  if (!journal.length) {
    box.innerHTML = '<p class="hint">Пока нет записей. Заварите первый чай!</p>';
    return;
  }

  journal.slice(0, 10).forEach((j) => {
    const node = document.createElement('div');
    node.className = 'jentry';

    let name = '—';
    if (j.tea_id) {
      const tea = catalog.find((t) => t.id === j.tea_id);
      name = tea?.name || 'Чай из каталога';
    } else if (j.tisane_id) {
      name = tisaneJournalName(j.tisane_id);
    } else if (j.unknown_id) {
      name = unknownJournalName(j.unknown_id);
    }

    const d = j.created_at
      ? new Date(j.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
      : '—';

    node.innerHTML = `
      <div class="jdate">${d}</div>
      <div class="jbody">
        <b>${escapeHtml(name)}</b>
        <div class="jm">${j.amount} ${UNIT_LABELS[j.unit] || 'г'}</div>
        ${j.note ? `<div class="jnote">${escapeHtml(j.note)}</div>` : ''}
        ${j.rating ? `<div class="jstars">${'★'.repeat(j.rating)}${'☆'.repeat(5 - j.rating)}</div>` : ''}
      </div>`;
    box.appendChild(node);
  });
}

// ============================================================
// АРХИВ ЧАЯ (модальное окно с тремя вкладками)
// ============================================================
async function openArchiveModal() {
  const ov = $('#archiveOverlay');
  openOverlay(ov);

  // Загружаем данные для всех трёх вкладок
  const user = getUser();
  if (!user) return;

  // Чай: закончившиеся из user_shelf
  const finishedTeas = shelf.filter((r) => statusOf(r) === 'finished');
  renderArchiveTeaList(finishedTeas);

  // Тизаны: закончившиеся
  await reloadTisanes();
  const { data: finTisanes } = await supabase.from('user_tisanes')
    .select('*, tisane_catalog(*)')
    .eq('user_id', user.id)
    .lte('quantity', 0);
  renderArchiveTisaneList(finTisanes || []);

  // Неизвестные: архивные и закончившиеся
  const { data: unknowns } = await supabase.from('unknown_teas')
    .select('*')
    .eq('user_id', user.id)
    .in('status', ['finished', 'archived']);
  renderArchiveUnknownList(unknowns || []);
}

function renderArchiveTeaList(rows) {
  const box = $('#archiveTeaList');
  box.innerHTML = '';

  if (!rows.length) {
    box.innerHTML = '<p class="hint">Пока пусто. Когда чай закончится, он переедет сюда.</p>';
    return;
  }

  rows
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .forEach((r) => {
      const node = document.createElement('div');
      node.className = 'archrow';
      node.dataset.shelfId = r.id;
      node.innerHTML = `
        <div class="wn">
          <b>${escapeHtml(r.tea?.name || '—')}</b>
          <span>Закончился · ${r.amount} ${UNIT_LABELS[r.unit] || 'г'}</span>
        </div>
        <div class="arch-actions">
          <button class="btn btn-outline btn-sm" type="button" data-action="restock">Пополнить</button>
          <button class="btn btn-ghost btn-sm" type="button" data-action="journal">Журнал</button>
          <button class="btn btn-ghost btn-sm danger-text" type="button" data-action="remove">Удалить</button>
        </div>`;
      box.appendChild(node);
    });
}

function renderArchiveTisaneList(rows) {
  const box = $('#archiveTisaneList');
  box.innerHTML = '';

  if (!rows.length) {
    box.innerHTML = '<p class="hint">Пока пусто. Когда тизан закончится, он переедет сюда.</p>';
    return;
  }

  rows
    .sort((a, b) => (b.tisane_catalog?.tisane_number || 0) - (a.tisane_catalog?.tisane_number || 0))
    .forEach((r) => {
      const name = r.custom_name || r.tisane_catalog?.name || `Тизан #${r.tisane_catalog?.tisane_number ?? '–'}`;
      const node = document.createElement('div');
      node.className = 'archrow';
      node.dataset.tisaneId = r.id;
      node.innerHTML = `
        <div class="wn">
          <b>${escapeHtml(name)}</b>
          <span>Закончился · ${Number(r.quantity)} ${UNIT_LABELS[r.quantity_unit] || 'г'}</span>
        </div>
        <div class="arch-actions">
          <button class="btn btn-outline btn-sm" type="button" data-action="restock">Пополнить</button>
          <button class="btn btn-ghost btn-sm" type="button" data-action="journal">Журнал</button>
          <button class="btn btn-ghost btn-sm danger-text" type="button" data-action="remove">Удалить</button>
        </div>`;
      box.appendChild(node);
    });
}

function renderArchiveUnknownList(rows) {
  const box = $('#archiveUnknownList');
  box.innerHTML = '';

  if (!rows.length) {
    box.innerHTML = '<p class="hint">Пока пусто.</p>';
    return;
  }

  rows
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .forEach((r) => {
      const name = r.name || `Неизвестный чай #${r.unknown_number}`;
      const statusLabel = r.status === 'archived' ? 'В архиве' : 'Закончился';
      const node = document.createElement('div');
      node.className = 'archrow';
      node.dataset.unknownId = r.id;
      node.innerHTML = `
        <div class="wn">
          <b>${escapeHtml(name)}</b>
          <span>${statusLabel} · ${Number(r.quantity || 0)} ${UNIT_LABELS[r.quantity_unit] || 'г'}</span>
        </div>
        <div class="arch-actions">
          <button class="btn btn-ghost btn-sm" type="button" data-action="journal">Журнал</button>
          <button class="btn btn-ghost btn-sm danger-text" type="button" data-action="remove">Удалить</button>
        </div>`;
      box.appendChild(node);
    });
}

// ============================================================
// АРХИВ ЖУРНАЛОВ (модальное окно с тремя вкладками)
// ============================================================
async function openJournalArchiveModal() {
  const ov = $('#journalArchiveOverlay');
  openOverlay(ov);

  const user = getUser();
  if (!user) return;

  const list = $('#journalArchiveList');
  list.innerHTML = '<p class="hint">Загружаем...</p>';

  const { data } = await supabase.from('brew_journal_archive')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const rows = data || [];
  list.innerHTML = '';

  if (!rows.length) {
    list.innerHTML = '<p class="hint">Архив журналов пуст.</p>';
    return;
  }

  // Разделяем по типу
  const teaRows = rows.filter((r) => r.source_type === 'tea' || !r.source_type);
  const tisaneRows = rows.filter((r) => r.source_type === 'tisane');
  const unknownRows = rows.filter((r) => r.source_type === 'unknown');

  // Вкладки
  list.innerHTML = `
    <div class="archive-tabs" role="tablist">
      <button class="archive-tab active" type="button" data-jtab="tea" role="tab" aria-selected="true">Чай</button>
      <button class="archive-tab" type="button" data-jtab="tisane" role="tab" aria-selected="false">Тизаны</button>
      <button class="archive-tab" type="button" data-jtab="unknown" role="tab" aria-selected="false">Неизвестные</button>
    </div>
    <div id="jArchiveTea" class="archive-section"></div>
    <div id="jArchiveTisane" class="archive-section hidden"></div>
    <div id="jArchiveUnknown" class="archive-section hidden"></div>`;

  renderJournalArchiveSection($('#jArchiveTea'), teaRows);
  renderJournalArchiveSection($('#jArchiveTisane'), tisaneRows);
  renderJournalArchiveSection($('#jArchiveUnknown'), unknownRows);

  // Переключение вкладок
  list.querySelector('.archive-tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.archive-tab');
    if (!btn) return;
    list.querySelectorAll('.archive-tab').forEach((b) => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');

    const tab = btn.dataset.jtab;
    $('#jArchiveTea')?.classList.toggle('hidden', tab !== 'tea');
    $('#jArchiveTisane')?.classList.toggle('hidden', tab !== 'tisane');
    $('#jArchiveUnknown')?.classList.toggle('hidden', tab !== 'unknown');
  });
}

function renderJournalArchiveSection(box, rows) {
  if (!box) return;
  box.innerHTML = '';

  if (!rows.length) {
    box.innerHTML = '<p class="hint">Нет записей.</p>';
    return;
  }

  rows.forEach((a) => {
    const node = document.createElement('div');
    node.className = 'jentry';
    const d = a.created_at
      ? new Date(a.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' })
      : '—';
    const entries = Array.isArray(a.payload) ? a.payload : [];
    node.innerHTML = `
      <div class="jdate">${d}</div>
      <div class="jbody">
        <b>${escapeHtml(a.source_ref || '—')}</b>
        <div class="jm">${entries.length} ${plural(entries.length, ['запись', 'записи', 'записей'])}</div>
      </div>
      <button class="btn btn-outline btn-sm" type="button" data-csv="${escapeHtml(a.id)}">CSV</button>`;
    node.querySelector('[data-csv]')?.addEventListener('click', () => downloadJournalCsv(a));
    box.appendChild(node);
  });
}

function downloadJournalCsv(archiveRow) {
  const entries = Array.isArray(archiveRow.payload) ? archiveRow.payload : [];
  if (!entries.length) return showToast('Нет данных для экспорта', 'warn');

  const headers = ['Дата', 'Количество', 'Единица', 'Оценка', 'Заметка'];
  const rows = entries.map((e) => [
    e.created_at ? new Date(e.created_at).toLocaleDateString('ru-RU') : '',
    e.amount || '',
    UNIT_LABELS[e.unit] || e.unit || '',
    e.rating || '',
    (e.note || '').replace(/;/g, ','),
  ]);

  const csv = '\uFEFF' + [headers, ...rows].map((r) => r.join(';')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `journal-${(archiveRow.source_ref || 'archive').replace(/[^\wа-яё-]+/gi, '_')}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ============================================================
// ДЕЙСТВИЯ В АРХИВЕ
// ============================================================

// Пополнить чай из архива
function restockArchivedTea(shelfId) {
  const row = shelf.find((r) => String(r.id) === String(shelfId));
  if (!row) return;

  openAmountModal({
    mode: 'restock',
    teaName: row.tea?.name || 'Чай',
    unit: row.unit,
    onSubmit: async (p) => {
      const { error } = await supabase.from(TABLES.shelf)
        .update({ amount: Number(row.amount) + p.amount })
        .eq('id', row.id);
      if (error) return showToast('Ошибка: ' + error.message, 'warn');
      showToast('Пополнено');
      closeOverlay($('#archiveOverlay'));
      await loadData();
      renderAll();
    },
  });
}

// Пополнить тизан из архива
function restockArchivedTisane(tisaneId) {
  openAmountModal({
    mode: 'restock',
    teaName: 'Тизан',
    onSubmit: async (p) => {
      const { data: row } = await supabase.from('user_tisanes')
        .select('*')
        .eq('id', tisaneId)
        .single();
      if (!row) return;

      const { error } = await supabase.from('user_tisanes')
        .update({ quantity: Number(row.quantity) + p.amount })
        .eq('id', tisaneId);
      if (error) return showToast('Ошибка: ' + error.message, 'warn');
      showToast('Пополнено');
      closeOverlay($('#archiveOverlay'));
      await reloadTisanes();
      renderTisanes();
      await loadData();
      renderAll();
    },
  });
}

// Удалить чай из архива (со снапшотом журнала)
async function removeArchivedTea(shelfId) {
  const row = shelf.find((r) => String(r.id) === String(shelfId));
  if (!row) return;

  const confirmed = await askConfirm(
    `Удалить «${row.tea?.name || 'чай'}» из архива? Журнал завариваний будет сохранён в архиве журналов.`
  );
  if (!confirmed) return;

  const user = getUser();
  if (!user) return;

  // Снапшот журнала
  const { data: journalEntries } = await supabase.from('brew_journal')
    .select('*')
    .eq('tea_id', row.tea_id)
    .eq('user_id', user.id);

  if (journalEntries && journalEntries.length) {
    await supabase.from('brew_journal_archive').insert({
      user_id: user.id,
      source_type: 'tea',
      source_ref: row.tea?.name || 'Чай',
      payload: journalEntries,
    });
  }

  // Удаляем журнал
  await supabase.from('brew_journal')
    .delete()
    .eq('tea_id', row.tea_id)
    .eq('user_id', user.id);

  // Удаляем из полки
  const { error } = await supabase.from(TABLES.shelf)
    .delete()
    .eq('id', row.id);

  if (error) return showToast('Ошибка удаления: ' + error.message, 'warn');

  showToast('Удалено. Журнал сохранён в архиве.');
  await loadData();
  renderAll();
  openArchiveModal(); // обновляем модалку
}

// Удалить тизан из архива (со снапшотом журнала)
async function removeArchivedTisane(tisaneId) {
  const confirmed = await askConfirm(
    'Удалить тизан из архива? Журнал завариваний будет сохранён в архиве журналов.'
  );
  if (!confirmed) return;

  const user = getUser();
  if (!user) return;

  // Получаем имя тизана
  const { data: row } = await supabase.from('user_tisanes')
    .select('*, tisane_catalog(*)')
    .eq('id', tisaneId)
    .single();
  if (!row) return;

  const name = row.custom_name || row.tisane_catalog?.name || `Тизан #${row.tisane_catalog?.tisane_number ?? '–'}`;

  // Снапшот журнала
  const { data: journalEntries } = await supabase.from('brew_journal')
    .select('*')
    .eq('tisane_id', tisaneId)
    .eq('user_id', user.id);

  if (journalEntries && journalEntries.length) {
    await supabase.from('brew_journal_archive').insert({
      user_id: user.id,
      source_type: 'tisane',
      source_ref: name,
      payload: journalEntries,
    });
  }

  // Удаляем журнал
  await supabase.from('brew_journal')
    .delete()
    .eq('tisane_id', tisaneId)
    .eq('user_id', user.id);

  // Удаляем тизан
  const { error } = await supabase.from('user_tisanes')
    .delete()
    .eq('id', tisaneId);

  if (error) return showToast('Ошибка удаления: ' + error.message, 'warn');

  showToast('Удалено. Журнал сохранён в архиве.');
  await reloadTisanes();
  renderTisanes();
  await loadData();
  renderAll();
  openArchiveModal();
}

// Удалить неизвестный чай из архива
async function removeArchivedUnknown(unknownId) {
  const confirmed = await askConfirm(
    'Удалить неизвестный чай из архива? Журнал завариваний будет сохранён в архиве журналов.'
  );
  if (!confirmed) return;

  const user = getUser();
  if (!user) return;

  // Получаем имя
  const { data: row } = await supabase.from('unknown_teas')
    .select('*')
    .eq('id', unknownId)
    .single();
  if (!row) return;

  const name = row.name || `Неизвестный чай #${row.unknown_number}`;

  // Снапшот журнала
  const { data: journalEntries } = await supabase.from('brew_journal')
    .select('*')
    .eq('unknown_id', unknownId)
    .eq('user_id', user.id);

  if (journalEntries && journalEntries.length) {
    await supabase.from('brew_journal_archive').insert({
      user_id: user.id,
      source_type: 'unknown',
      source_ref: name,
      payload: journalEntries,
    });
  }

  // Удаляем журнал
  await supabase.from('brew_journal')
    .delete()
    .eq('unknown_id', unknownId)
    .eq('user_id', user.id);

  // Удаляем неизвестный чай
  const { error } = await supabase.from('unknown_teas')
    .delete()
    .eq('id', unknownId);

  if (error) return showToast('Ошибка удаления: ' + error.message, 'warn');

  showToast('Удалено. Журнал сохранён в архиве.');
  await reloadUnknowns();
  renderUnknowns();
  await loadData();
  renderAll();
  openArchiveModal();
}

// Открыть журнал для архивного элемента
async function openArchivedJournal(type, id, name) {
  let entries = [];

  if (type === 'tea') {
    const { data } = await supabase.from('brew_journal')
      .select('*').eq('tea_id', id)
      .order('created_at', { ascending: false });
    entries = data || [];
  } else if (type === 'tisane') {
    const { data } = await supabase.from('brew_journal')
      .select('*').eq('tisane_id', id)
      .order('created_at', { ascending: false });
    entries = data || [];
  } else if (type === 'unknown') {
    const { data } = await supabase.from('brew_journal')
      .select('*').eq('unknown_id', id)
      .order('created_at', { ascending: false });
    entries = data || [];
  }

  if (!entries.length) {
    showToast('Нет записей в журнале', 'info');
    return;
  }

  // Используем модалку журнала тизанов как универсальную
  const journalOv = $('#tisaneJournalOverlay');
  if (journalOv) {
    $('#tisaneJournalTeaName').textContent = name;
    const list = $('#tisaneJournalList');
    list.innerHTML = '';
    entries.forEach((j) => {
      const node = document.createElement('div');
      node.className = 'jentry';
      const d = j.created_at
        ? new Date(j.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
        : '—';
      node.innerHTML = `
        <div class="jdate">${d}</div>
        <div class="jbody">
          <div class="jm">${j.amount} ${UNIT_LABELS[j.unit] || 'г'}</div>
          ${j.note ? `<div class="jnote">${escapeHtml(j.note)}</div>` : ''}
          ${j.rating ? `<div class="jstars">${'★'.repeat(j.rating)}${'☆'.repeat(5 - j.rating)}</div>` : ''}
        </div>`;
      list.appendChild(node);
    });
    openOverlay(journalOv);
  }
}

// ---------- Рендер всего ----------
function renderAll() {
  renderStats();
  renderGrid();
  renderBuyList();
  renderJournal();
}

// ---------- Инициализация ----------
async function init() {
  await initCommon();
  initAmountModal();

  // Инициализация модулей тизанов и неизвестных
  await initTisanes();
  await initUnknowns();

  // Фильтры
  $('#shelfSearch')?.addEventListener('input', (e) => {
    filters.q = e.target.value.trim().toLowerCase();
    renderGrid();
  });

  // Вкладки Все / Мало
  $$('.tabs .tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tabs .tab').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      filters.status = btn.dataset.status;
      renderGrid();
    });
  });

  // Фильтр по типу
  $('#shelfTypeFilter')?.addEventListener('change', (e) => {
    filters.type = e.target.value;
    renderGrid();
  });

  // Сортировка
  $('#shelfSort')?.addEventListener('change', (e) => {
    filters.sort = e.target.value;
    renderGrid();
  });

  // Кнопки архива
  $('#openArchiveBtn')?.addEventListener('click', openArchiveModal);
  $('#openJournalArchiveBtn')?.addEventListener('click', openJournalArchiveModal);

  // Модалка архива
  const archiveOv = $('#archiveOverlay');
  if (archiveOv) {
    wireOverlay(archiveOv);
    $('#archiveModalClose')?.addEventListener('click', () => closeOverlay(archiveOv));

    // Переключение вкладок
    archiveOv.querySelector('.archive-tabs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.archive-tab');
      if (!btn) return;
      archiveOv.querySelectorAll('.archive-tab').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      const tab = btn.dataset.tab;
      $('#archiveTeaList')?.classList.toggle('hidden', tab !== 'tea');
      $('#archiveTisaneList')?.classList.toggle('hidden', tab !== 'tisane');
      $('#archiveUnknownList')?.classList.toggle('hidden', tab !== 'unknown');
    });

    // Клики по элементам архива чая
    $('#archiveTeaList')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const row = btn.closest('.archrow');
      if (!row) return;
      const shelfId = row.dataset.shelfId;

      if (btn.dataset.action === 'restock') return restockArchivedTea(shelfId);
      if (btn.dataset.action === 'remove') return removeArchivedTea(shelfId);
      if (btn.dataset.action === 'journal') {
        const shelfRow = shelf.find((r) => String(r.id) === String(shelfId));
        if (shelfRow) return openArchivedJournal('tea', shelfRow.tea_id, shelfRow.tea?.name || 'Чай');
      }
    });

    // Клики по элементам архива тизанов
    $('#archiveTisaneList')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const row = btn.closest('.archrow');
      if (!row) return;
      const tisaneId = row.dataset.tisaneId;

      if (btn.dataset.action === 'restock') return restockArchivedTisane(tisaneId);
      if (btn.dataset.action === 'remove') return removeArchivedTisane(tisaneId);
      if (btn.dataset.action === 'journal') {
        const name = row.querySelector('b')?.textContent || 'Тизан';
        return openArchivedJournal('tisane', tisaneId, name);
      }
    });

    // Клики по элементам архива неизвестных
    $('#archiveUnknownList')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const row = btn.closest('.archrow');
      if (!row) return;
      const unknownId = row.dataset.unknownId;

      if (btn.dataset.action === 'remove') return removeArchivedUnknown(unknownId);
      if (btn.dataset.action === 'journal') {
        const name = row.querySelector('b')?.textContent || 'Неизвестный чай';
        return openArchivedJournal('unknown', unknownId, name);
      }
    });
  }

  // Модалка архива журналов
  const jArchiveOv = $('#journalArchiveOverlay');
  if (jArchiveOv) {
    wireOverlay(jArchiveOv);
    $('#journalArchiveClose')?.addEventListener('click', () => closeOverlay(jArchiveOv));
  }

  // Клики по сетке полки
  $('#shelfGrid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = btn.closest('.card');
    if (!card) return;
    const row = shelf.find((r) => String(r.id) === card.dataset.shelfId);
    if (!row) return;

    if (btn.dataset.action === 'brew') return openBrewModal(row);
    if (btn.dataset.action === 'restock') return restockRow(row);
    if (btn.dataset.action === 'open-journal') return openTeaJournal(row.tea_id, row.tea?.name);
  });

  // Клики по «Что докупить»
  $('#buyList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const row = btn.closest('.buyrow');
    if (!row) return;
    const name = row.querySelector('b')?.textContent || '';
    const shelfRow = shelf.find((r) => r.tea?.name === name);
    if (shelfRow && btn.dataset.action === 'restock') return restockRow(shelfRow);
  });

  // Перезагрузка при входе/выходе
  onAuthChange(async () => {
    await loadData();
    renderAll();
    await reloadTisanes();
    renderTisanes();
    await reloadUnknowns();
    renderUnknowns();
  });

  // Слушаем событие изменения полки (например, после опознания неизвестного)
  window.addEventListener('tea-shelf-changed', async () => {
    await loadData();
    renderAll();
  });

  // Начальная загрузка
  await loadData();
  renderAll();
}

// ---------- Заваривание ----------
function openBrewModal(row) {
  openAmountModal({
    mode: 'brew',
    teaName: row.tea?.name || 'Чай',
    unit: row.unit,
    maxAmount: row.amount,
    onSubmit: async (p) => {
      const { data, error } = await supabase.rpc('brew_tea', {
        p_shelf_id: row.id,
        p_amount: p.amount,
        p_rating: p.rating || null,
        p_note: p.note || null,
      });
      if (error) return showToast('Ошибка: ' + error.message, 'warn');

      const left = Number(data);
      showToast(left <= 0
        ? `Чай закончился и перемещён в архив.`
        : `Заваривание записано. Осталось ${left} ${UNIT_LABELS[row.unit] || 'г'}`);

      await loadData();
      renderAll();
    },
  });
}

// ---------- Пополнение ----------
function restockRow(row) {
  openAmountModal({
    mode: 'restock',
    teaName: row.tea?.name || 'Чай',
    unit: row.unit,
    onSubmit: async (p) => {
      const { error } = await supabase.from(TABLES.shelf)
        .update({ amount: Number(row.amount) + p.amount })
        .eq('id', row.id);
      if (error) return showToast('Ошибка: ' + error.message, 'warn');
      showToast(`Пополнено на ${p.amount} ${UNIT_LABELS[row.unit] || 'г'}`);
      await loadData();
      renderAll();
    },
  });
}

// ---------- Журнал чая ----------
async function openTeaJournal(teaId, teaName) {
  const journalOv = $('#tisaneJournalOverlay');
  if (!journalOv) return;

  $('#tisaneJournalTeaName').textContent = teaName || 'Чай';
  const list = $('#tisaneJournalList');
  list.innerHTML = '<p class="hint">Загружаем...</p>';
  openOverlay(journalOv);

  const { data } = await supabase.from('brew_journal')
    .select('*').eq('tea_id', teaId)
    .order('created_at', { ascending: false });

  const entries = data || [];
  list.innerHTML = '';
  if (!entries.length) {
    list.innerHTML = '<p class="hint">Нет записей.</p>';
    return;
  }
  entries.forEach((j) => {
    const node = document.createElement('div');
    node.className = 'jentry';
    const d = j.created_at
      ? new Date(j.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
      : '—';
    node.innerHTML = `
      <div class="jdate">${d}</div>
      <div class="jbody">
        <div class="jm">${j.amount} ${UNIT_LABELS[j.unit] || 'г'}</div>
        ${j.note ? `<div class="jnote">${escapeHtml(j.note)}</div>` : ''}
        ${j.rating ? `<div class="jstars">${'★'.repeat(j.rating)}${'☆'.repeat(5 - j.rating)}</div>` : ''}
      </div>`;
    list.appendChild(node);
  });
}

init();