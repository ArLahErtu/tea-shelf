// ============================================================
// tisanes.js — ЭТАП 2: тизаны (травяные сборы) на полке.
// Сам инъектит разметку: секция «🌿 Тизаны», форма добавления,
// экран результата, модалки заваривания и журнала.
// RPC: tisane_find_or_create, brew_tisane, suggest_herb.
// ============================================================
import { supabase } from './supabaseClient.js';
import {
  $, $$, showToast, openOverlay, closeOverlay, wireOverlay,
  escapeHtml, UNIT_LABELS,
} from './ui.js';
import { getUser } from './auth.js';
import { openAmountModal } from './amountModal.js';

let herbs = [];
let myTisanes = [];
let injected = false;
let brewRow = null;
let brewRating = 0;

const herbById = new Map();
const nameByUserTisaneId = new Map();
const selected = new Map(); // herb_id -> { primary }

function tisaneName(row) {
  const num = row.tisane_catalog?.tisane_number ?? '–';
  return row.custom_name || row.tisane_catalog?.name || `Тизан #${num}`;
}

// Имя для записей общего журнала (использует shelf.js)
export function tisaneJournalName(j) {
  if (!j.tisane_id) return null;
  return nameByUserTisaneId.get(j.tisane_id) || 'Тизан';
}

// ---------- Загрузка ----------
export async function reloadTisanes() {
  const user = getUser();
  if (!user) {
    herbs = [];
    myTisanes = [];
  } else {
    const [h, t] = await Promise.all([
      supabase.from('herbs').select('*').order('name'),
      supabase.from('user_tisanes')
        .select('*, tisane_catalog(*)')
        .eq('user_id', user.id),
    ]);
    herbs = h.data || [];
    myTisanes = t.data || [];
  }
  herbById.clear();
  herbs.forEach((h) => herbById.set(h.id, h));
  nameByUserTisaneId.clear();
  myTisanes.forEach((r) => nameByUserTisaneId.set(r.id, tisaneName(r)));
}

// ---------- Секция на полке ----------
export function renderTisanes() {
  const grid = $('#tisanesGrid');
  if (!grid) return;
  $('#tisanesCount').textContent = myTisanes.length;
  grid.innerHTML = '';

  if (!getUser()) {
    grid.innerHTML = '<p class="hint">Раздел доступен после входа.</p>';
    return;
  }
  if (!myTisanes.length) {
    grid.innerHTML = '<p class="hint">Пока нет тизанов. Соберите первый сбор — минимум две травы.</p>';
    return;
  }

  myTisanes
    .slice()
    .sort((a, b) =>
      (a.tisane_catalog?.tisane_number || 0) - (b.tisane_catalog?.tisane_number || 0))
    .forEach((r) => grid.appendChild(tisaneCard(r)));
}

function tisaneCard(r) {
  const node = document.createElement('article');
  node.className = 'card tisane-card';
  node.dataset.tisaneId = r.id;

  const comp = (r.tisane_catalog?.composition || [])
    .map((c) => {
      const name = escapeHtml(herbById.get(c.herb_id)?.name || '—');
      return c.is_primary ? `<b>${name}</b>` : name;
    })
    .join(', ');
  const props = (r.tisane_catalog?.properties || []).join(', ');
  const qty = Number(r.quantity);

  node.innerHTML = `
    <div class="card-top">
      <span class="pill pill-tisane"><i aria-hidden="true"></i>Тизан #${escapeHtml(String(r.tisane_catalog?.tisane_number ?? '–'))}</span>
    </div>
    <h3 class="card-name">${escapeHtml(tisaneName(r))}</h3>
    <p class="tisane-comp">${comp || '—'}</p>
    ${props ? `<p class="tisane-props">${escapeHtml(props)}</p>` : ''}
    <div class="qty-row">
      <span class="qty-val">${qty} <em>${UNIT_LABELS[r.quantity_unit] || 'г'}</em></span>
    </div>
    <div class="card-actions">
      <button class="btn btn-primary btn-sm" type="button" data-action="brew">Заварил</button>
      <button class="btn btn-outline btn-sm" type="button" data-action="restock">Пополнить</button>
      <button class="btn btn-ghost btn-sm" type="button" data-action="journal">📖 Журнал</button>
    </div>`;
  return node;
}

// ---------- Пополнение ----------
function restockTisane(r) {
  openAmountModal({
    mode: 'restock',
    teaName: tisaneName(r),
    unit: r.quantity_unit,
    onSubmit: async (p) => {
      const { error } = await supabase.from('user_tisanes')
        .update({ quantity: Number(r.quantity) + p.amount })
        .eq('id', r.id);
      if (error) return showToast('Ошибка: ' + error.message, 'warn');
      showToast(`Пополнено на ${p.amount} ${UNIT_LABELS[r.quantity_unit] || 'г'}`);
      await reloadTisanes();
      renderTisanes();
    },
  });
}

// ---------- Заваривание ----------
function openTisaneBrew(r) {
  brewRow = r;
  brewRating = 0;
  $('#tisaneBrewName').textContent = tisaneName(r);
  $('#tisaneBrewAmount').value = Math.min(7, Number(r.quantity)) || 1;
  $('#tisaneBrewNote').value = '';
  $$('#tisaneBrewStars .star-btn').forEach((s) => {
    s.classList.remove('on');
    s.setAttribute('aria-checked', 'false');
  });
  openOverlay($('#tisaneBrewOverlay'));
}

async function submitTisaneBrew() {
  if (!brewRow) return;
  const used = Number($('#tisaneBrewAmount').value);
  if (!used || used <= 0) return showToast('Укажите количество', 'warn');
  if (used > Number(brewRow.quantity)) {
    return showToast('На полке меньше этого количества', 'warn');
  }

  const { data, error } = await supabase.rpc('brew_tisane', {
    p_user_tisane_id: brewRow.id,
    p_amount: used,
    p_rating: brewRating || null,
    p_note: $('#tisaneBrewNote').value.trim() || null,
  });
  if (error) return showToast('Ошибка: ' + error.message, 'warn');

  closeOverlay($('#tisaneBrewOverlay'));
  const left = Number(data);
  const num = brewRow.tisane_catalog?.tisane_number ?? '–';
  showToast(left <= 0
    ? `Тизан #${num} закончился.`
    : `Заваривание записано ☕ Осталось ${left} ${UNIT_LABELS[brewRow.quantity_unit] || 'г'}`);

  await reloadTisanes();
  renderTisanes();
}

// ---------- Журнал тизана ----------
async function openTisaneJournal(r) {
  $('#tisaneJournalTeaName').textContent = tisaneName(r);
  const list = $('#tisaneJournalList');
  list.innerHTML = '<p class="hint">Загружаем…</p>';
  openOverlay($('#tisaneJournalOverlay'));

  const { data } = await supabase.from('brew_journal')
    .select('*').eq('tisane_id', r.id)
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

// ---------- Форма: список трав ----------
function renderHerbList(filter = '') {
  const box = $('#tisaneHerbList');
  box.innerHTML = '';
  const q = filter.trim().toLowerCase();

  herbs
    .filter((h) => !q || h.name.toLowerCase().includes(q))
    .forEach((h) => {
      const sel = selected.get(h.id);
      const row = document.createElement('div');
      row.className = 'herb-row';
      row.innerHTML = `
        <input type="checkbox" id="herb-${h.id}" data-herb="${h.id}" ${sel ? 'checked' : ''}>
        <label class="herb-name" for="herb-${h.id}">
          ${escapeHtml(h.name)}${h.is_approved ? '' : ' <em class="herb-pending">(ваша трава, на одобрении)</em>'}
        </label>
        <button type="button" class="star-btn herb-star ${sel && sel.primary ? 'on' : ''}"
          data-primary="${h.id}" title="Основная трава" ${sel ? '' : 'hidden'}>★</button>`;
      box.appendChild(row);
    });
}

// ---------- Форма: сохранение ----------
async function submitTisaneForm(e) {
  e.preventDefault();
  const user = getUser();
  if (!user) return showToast('Сначала войдите', 'warn');

  const ids = [...selected.keys()];
  if (ids.length < 2) return showToast('Тизан — это сбор: нужно минимум 2 травы', 'warn');

  const qty = Number($('#tisaneQty').value);
  if (!qty || qty <= 0) return showToast('Укажите количество', 'warn');
  const unit = $('#tisaneUnitSel').value || 'g';
  const name = $('#tisaneName').value.trim() || null;

  const primaries = ids.filter((i) => selected.get(i) && selected.get(i).primary);

  const { data, error } = await supabase.rpc('tisane_find_or_create', {
    p_herb_ids: ids,
    p_primary_herb_ids: primaries,
    p_name: name,
  });
  if (error) return showToast(error.message, 'warn');
  const rec = Array.isArray(data) ? data[0] : data;

  const existing = myTisanes.find((r) => r.tisane_catalog_id === rec.id);
  if (existing) {
    const { error: e2 } = await supabase.from('user_tisanes')
      .update({ quantity: Number(existing.quantity) + qty })
      .eq('id', existing.id);
    if (e2) return showToast('Ошибка: ' + e2.message, 'warn');
  } else {
    const { error: e2 } = await supabase.from('user_tisanes').insert({
      user_id: user.id,
      tisane_catalog_id: rec.id,
      quantity: qty,
      quantity_unit: unit,
    });
    if (e2) return showToast('Ошибка: ' + e2.message, 'warn');
  }

  closeOverlay($('#tisaneOverlay'));
  await reloadTisanes();
  renderTisanes();
  showResult(rec, qty, unit);

  e.target.reset();
  selected.clear();
  renderHerbList();
}

function showResult(rec, qty, unit) {
  $('#tisaneResultTitle').textContent = rec.is_new
    ? `🎉 Создан Тизан #${rec.tisane_number}!`
    : `✅ Это Тизан #${rec.tisane_number}`;

  const comp = (rec.composition || [])
    .map((c) => {
      const n = escapeHtml(herbById.get(c.herb_id)?.name || '—');
      return c.is_primary ? `★ ${n}` : n;
    })
    .join(', ');

  const propsLine = (rec.properties && rec.properties.length)
    ? `<p><b>Свойства:</b> ${escapeHtml(rec.properties.join(', '))}</p>`
    : '';

  $('#tisaneResultBody').innerHTML = `
    <p><b>Состав:</b> ${comp}</p>
    ${propsLine}
    ${rec.is_new ? '<p>Добавлен в общий каталог тизанов.</p>' : ''}
    <p>${qty} ${UNIT_LABELS[unit] || 'г'} — на вашу полку.</p>`;
  openOverlay($('#tisaneResultOverlay'));
}

// ---------- Инъекция разметки ----------
function injectMarkup() {
  const journal = $('#journalPanel');
  const section = document.createElement('section');
  section.className = 'panel tisanes-panel';
  section.id = 'tisanesPanel';
  section.setAttribute('aria-labelledby', 'tisanesTitle');
  section.innerHTML = `
    <div class="panel-head-row">
      <h3 id="tisanesTitle">🌿 Тизаны <span class="cnt" id="tisanesCount">0</span></h3>
      <button class="btn btn-primary btn-sm" id="addTisaneBtn" type="button">+ Добавить тизан</button>
    </div>
    <p class="psub">Травяные сборы: минимум две травы, дубликаты определяются по составу.</p>
    <div class="tisanes-grid" id="tisanesGrid"></div>`;
  journal.parentNode.insertBefore(section, journal);

  const overlays = document.createElement('div');
  overlays.innerHTML = `
  <div class="overlay" id="tisaneOverlay" hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="tisaneFormTitle">
      <div class="modal-head">
        <h2 id="tisaneFormTitle">Добавить тизан</h2>
        <button class="icon-btn" id="tisaneClose" type="button" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <form id="tisaneForm" novalidate>
        <div class="field">
          <label for="tisaneName">Название (опционально)</label>
          <input id="tisaneName" type="text" maxlength="255" placeholder="Например, «Вечерний сбор»">
        </div>
        <div class="field">
          <label for="tisaneHerbSearch">Состав (минимум 2 травы)</label>
          <input id="tisaneHerbSearch" type="search" placeholder="Поиск травы…">
        </div>
        <div class="herb-list" id="tisaneHerbList"></div>
        <div class="field">
          <button class="btn btn-outline btn-sm" type="button" id="tisaneNewHerbToggle">+ Добавить другую траву</button>
          <div class="row2 hidden" id="tisaneNewHerbRow">
            <input id="tisaneNewHerbName" type="text" placeholder="Название новой травы">
            <button class="btn btn-sm" type="button" id="tisaneNewHerbSubmit">Добавить</button>
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <label for="tisaneQty">Количество на полку <span class="req">*</span></label>
            <input id="tisaneQty" type="number" min="1" step="1" value="100" required>
          </div>
          <div class="field">
            <label for="tisaneUnitSel">Единица</label>
            <select id="tisaneUnitSel">
              <option value="g">граммы</option>
              <option value="sachet">пакетики</option>
              <option value="pcs">упаковки</option>
            </select>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" type="button" id="tisaneCancel">Отмена</button>
          <button class="btn btn-primary" type="submit">Сохранить и добавить на полку</button>
        </div>
      </form>
    </div>
  </div>

  <div class="overlay" id="tisaneResultOverlay" hidden>
    <div class="modal narrow" role="dialog" aria-modal="true" aria-labelledby="tisaneResultTitle">
      <div class="modal-head">
        <h2 id="tisaneResultTitle">Тизан</h2>
        <button class="icon-btn" id="tisaneResultClose" type="button" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div id="tisaneResultBody" class="tisane-result"></div>
      <div class="modal-foot">
        <button class="btn btn-primary" id="tisaneResultGoShelf" type="button">Перейти к полке</button>
      </div>
    </div>
  </div>

  <div class="overlay" id="tisaneBrewOverlay" hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="tisaneBrewTitle">
      <div class="modal-head">
        <h2 id="tisaneBrewTitle">Заварить тизан</h2>
        <button class="icon-btn" id="tisaneBrewClose" type="button" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <p class="modal-sub" id="tisaneBrewName">—</p>
      <form id="tisaneBrewForm" novalidate>
        <div class="field">
          <label for="tisaneBrewAmount">Количество</label>
          <input id="tisaneBrewAmount" type="number" inputmode="decimal" min="1" step="1" value="7" required>
        </div>
        <div class="field">
          <label for="tisaneBrewNote">Заметка</label>
          <textarea id="tisaneBrewNote" rows="3" maxlength="500" placeholder="Вкус, аромат, впечатления…"></textarea>
        </div>
        <div class="field">
          <label>Оценка</label>
          <div class="stars-input" id="tisaneBrewStars" role="radiogroup" aria-label="Оценка заваривания">
            <button class="star-btn" type="button" role="radio" aria-checked="false" data-value="1">★</button>
            <button class="star-btn" type="button" role="radio" aria-checked="false" data-value="2">★</button>
            <button class="star-btn" type="button" role="radio" aria-checked="false" data-value="3">★</button>
            <button class="star-btn" type="button" role="radio" aria-checked="false" data-value="4">★</button>
            <button class="star-btn" type="button" role="radio" aria-checked="false" data-value="5">★</button>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" id="tisaneBrewCancel" type="button">Отмена</button>
          <button class="btn btn-primary" type="submit">Заварил</button>
        </div>
      </form>
    </div>
  </div>

  <div class="overlay" id="tisaneJournalOverlay" hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="tisaneJournalTitle">
      <div class="modal-head">
        <h2 id="tisaneJournalTitle">Журнал завариваний</h2>
        <button class="icon-btn" id="tisaneJournalClose" type="button" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <p class="modal-sub" id="tisaneJournalTeaName">—</p>
      <div id="tisaneJournalList" class="journal-tea-list"></div>
    </div>
  </div>`;
  document.body.appendChild(overlays);
}

// ---------- Старт ----------
export async function initTisanes() {
  if (!injected) {
    injected = true;
    injectMarkup();

    $('#addTisaneBtn').addEventListener('click', () => {
      if (!getUser()) return showToast('Сначала войдите', 'warn');
      renderHerbList();
      openOverlay($('#tisaneOverlay'));
    });
    $('#tisaneClose').addEventListener('click', () => closeOverlay($('#tisaneOverlay')));
    $('#tisaneCancel').addEventListener('click', () => closeOverlay($('#tisaneOverlay')));
    $('#tisaneForm').addEventListener('submit', submitTisaneForm);

    $('#tisaneHerbSearch').addEventListener('input', (e) => renderHerbList(e.target.value));

    $('#tisaneHerbList').addEventListener('change', (e) => {
      const cb = e.target.closest('[data-herb]');
      if (!cb) return;
      const id = cb.dataset.herb;
      const rowEl = cb.closest('.herb-row');
      const star = rowEl ? rowEl.querySelector('.herb-star') : null;
      if (cb.checked) {
        selected.set(id, { primary: false });
        if (star) star.hidden = false;
      } else {
        selected.delete(id);
        if (star) { star.hidden = true; star.classList.remove('on'); }
      }
    });

    $('#tisaneHerbList').addEventListener('click', (e) => {
      const star = e.target.closest('.herb-star');
      if (!star) return;
      const id = star.dataset.primary;
      const sel = selected.get(id);
      if (!sel) return;
      sel.primary = !sel.primary;
      star.classList.toggle('on', sel.primary);
    });

    $('#tisaneNewHerbToggle').addEventListener('click', () => {
      $('#tisaneNewHerbRow').classList.toggle('hidden');
    });

    $('#tisaneNewHerbSubmit').addEventListener('click', async () => {
      const name = $('#tisaneNewHerbName').value.trim();
      if (!name) return showToast('Введите название травы', 'warn');
      const { data, error } = await supabase.rpc('suggest_herb', { p_name: name });
      if (error) return showToast(error.message, 'warn');
      const rec = Array.isArray(data) ? data[0] : data;
      if (!herbById.has(rec.id)) {
        herbs.push(rec);
        herbById.set(rec.id, rec);
      }
      selected.set(rec.id, { primary: false });
      renderHerbList($('#tisaneHerbSearch').value);
      $('#tisaneNewHerbName').value = '';
      showToast(rec.is_approved
        ? `Трава «${rec.name}» добавлена в состав`
        : `«${rec.name}» — ваша трава: станет общей после 5 голосов`);
    });

    $('#tisaneResultClose').addEventListener('click', () => closeOverlay($('#tisaneResultOverlay')));
    $('#tisaneResultGoShelf').addEventListener('click', () => {
      closeOverlay($('#tisaneResultOverlay'));
      const panel = $('#tisanesPanel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    wireOverlay($('#tisaneBrewOverlay'));
    $('#tisaneBrewClose').addEventListener('click', () => closeOverlay($('#tisaneBrewOverlay')));
    $('#tisaneBrewCancel').addEventListener('click', () => closeOverlay($('#tisaneBrewOverlay')));
    $('#tisaneBrewStars').addEventListener('click', (e) => {
      const b = e.target.closest('.star-btn');
      if (!b) return;
      brewRating = Number(b.dataset.value);
      $$('#tisaneBrewStars .star-btn').forEach((s) => {
        s.classList.toggle('on', Number(s.dataset.value) <= brewRating);
        s.setAttribute('aria-checked', String(s === b));
      });
    });
    $('#tisaneBrewForm').addEventListener('submit', (e) => {
      e.preventDefault();
      submitTisaneBrew();
    });

    wireOverlay($('#tisaneJournalOverlay'));
    $('#tisaneJournalClose').addEventListener('click', () => closeOverlay($('#tisaneJournalOverlay')));

    $('#tisanesGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.tisane-card');
      if (!card) return;
      const row = myTisanes.find((r) => r.id === card.dataset.tisaneId);
      if (!row) return;
      if (e.target.closest('[data-action="brew"]')) return openTisaneBrew(row);
      if (e.target.closest('[data-action="restock"]')) return restockTisane(row);
      if (e.target.closest('[data-action="journal"]')) return openTisaneJournal(row);
    });
  }

  await reloadTisanes();
  renderTisanes();
}