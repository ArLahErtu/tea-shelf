// ============================================================
// tisanes.js — тизаны (травяные сборы) на полке.
// Сам инъектит разметку: секция «Тизаны», форма добавления,
// экран результата, модалки заваривания и журнала.
// RPC: tisane_find_or_create, brew_tisane, suggest_herb.
// Архив тизанов вынесен в общую модалку архива (shelf.js).
// ============================================================
import { supabase } from './supabaseClient.js';
import {
  $, $$, showToast, openOverlay, closeOverlay, wireOverlay,
  escapeHtml, plural, UNIT_LABELS, askConfirm, trackEvent,
} from './ui.js';
import { getUser } from './auth.js';
import { openAmountModal } from './amountModal.js';

// ---------- Модульное состояние ----------
let herbs = [];
let myTisanes = [];
let activeTisanes = [];
let finishedTisanes = [];
let herbById = new Map();
let nameByUserTisaneId = new Map();
let brewRow = null;
let brewRating = 0;
let selected = new Map();

// ---------- Имя тизана ----------
function tisaneName(r) {
  if (r.custom_name) return r.custom_name;
  if (r.tisane_catalog?.name) return r.tisane_catalog.name;
  return `Тизан #${r.tisane_catalog?.tisane_number ?? '–'}`;
}

// ---------- Загрузка ----------
export async function reloadTisanes() {
  const user = getUser();
  if (!user) {
    herbs = [];
    myTisanes = [];
    activeTisanes = [];
    finishedTisanes = [];
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

  activeTisanes = myTisanes.filter((r) => Number(r.quantity) > 0);
  finishedTisanes = myTisanes.filter((r) => Number(r.quantity) <= 0);
}

// ---------- Экспорт для журнала полки ----------
export function tisaneJournalName(userTisaneId) {
  return nameByUserTisaneId.get(userTisaneId) || 'Тизан';
}

// ---------- Секция на полке: только активные тизаны ----------
export function renderTisanes() {
  const grid = $('#tisanesGrid');
  if (!grid) return;
  $('#tisanesCount').textContent = activeTisanes.length;
  grid.innerHTML = '';

  if (!getUser()) {
    grid.innerHTML = '<p class="hint">Раздел доступен после входа.</p>';
    return;
  }
  if (!activeTisanes.length) {
    grid.innerHTML = '<p class="hint">Пока нет тизанов. Соберите первый сбор — минимум две травы.</p>';
    return;
  }

  activeTisanes
    .slice()
    .sort((a, b) =>
      (a.tisane_catalog?.tisane_number || 0) - (b.tisane_catalog?.tisane_number || 0))
    .forEach((r) => grid.appendChild(tisaneCard(r)));
}

// ---------- Карточка активного тизана ----------
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
      <button class="btn btn-ghost btn-sm" type="button" data-action="journal">Журнал</button>
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
    ? `Тизан #${num} закончился и перемещён в архив.`
    : `Заваривание записано. Осталось ${left} ${UNIT_LABELS[brewRow.quantity_unit] || 'г'}`);

  await reloadTisanes();
  renderTisanes();
}

// ---------- Журнал тизана ----------
async function openTisaneJournal(r) {
  $('#tisaneJournalTeaName').textContent = tisaneName(r);
  const list = $('#tisaneJournalList');
  list.innerHTML = '<p class="hint">Загружаем...</p>';
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
          data-primary="${h.id}" title="Основная трава" ${sel ? '' : 'hidden'}>&#9733;</button>`;
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

// ---------- Экран результата ----------
function showResult(rec, qty, unit) {
  const isNew = rec.is_new;
  const num = rec.tisane_number;
  $('#tisaneResultTitle').textContent = isNew
    ? `Создан Тизан #${num}`
    : `Это Тизан #${num}`;
  $('#tisaneResultQty').textContent = `${qty} ${UNIT_LABELS[unit] || 'г'}`;

  const props = (rec.properties || []).join(', ');
  $('#tisaneResultProps').textContent = props || '—';

  const comp = (rec.composition || [])
    .map((c) => {
      const name = herbById.get(c.herb_id)?.name || '—';
      return c.is_primary ? `<b>${escapeHtml(name)}</b>` : escapeHtml(name);
    })
    .join(', ');
  $('#tisaneResultComp').innerHTML = comp || '—';

  openOverlay($('#tisaneResultOverlay'));
}

// ---------- Инъекция разметки ----------
function injectMarkup() {
  const journal = $('#shelfGrid');

  // Секция тизанов (без архива — он в общей модалке)
  const section = document.createElement('section');
  section.className = 'panel tisanes-panel';
  section.id = 'tisanesPanel';
  section.setAttribute('aria-labelledby', 'tisanesTitle');
  section.innerHTML = `
    <div class="panel-head-row">
      <h3 id="tisanesTitle">Тизаны <span class="cnt" id="tisanesCount">0</span></h3>
      <button class="btn btn-primary btn-sm" id="addTisaneBtn" type="button">+ Добавить тизан</button>
    </div>
    <p class="psub">Травяные сборы: минимум две травы, дубликаты определяются по составу.</p>
    <div class="tisanes-grid" id="tisanesGrid"></div>`;
  journal.parentNode.insertBefore(section, journal.nextSibling);

  // Форма добавления тизана
  const formOv = document.createElement('div');
  formOv.className = 'overlay';
  formOv.id = 'tisaneOverlay';
  formOv.hidden = true;
  formOv.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="tisaneFormTitle">
      <div class="modal-head">
        <h2 id="tisaneFormTitle">Добавить тизан</h2>
        <button class="icon-btn" id="tisaneFormClose" type="button" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <form id="tisaneForm" novalidate>
        <div class="field">
          <label for="tisaneName">Название (необязательно)</label>
          <input id="tisaneName" type="text" placeholder="Например: Вечерний сбор">
        </div>
        <div class="field">
          <label>Травы (минимум 2) <span class="req">*</span></label>
          <input type="search" id="tisaneHerbSearch" placeholder="Поиск травы..." class="sel">
          <div id="tisaneHerbList" class="herb-list"></div>
        </div>
        <div id="tisaneCustomHerbRows"></div>
        <button type="button" class="btn btn-outline btn-sm" id="addHerbBtn">+ Другая трава</button>
        <div class="row2">
          <div class="field">
            <label for="tisaneQty">Количество <span class="req">*</span></label>
            <input id="tisaneQty" type="number" min="1" step="1" value="50" required>
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
          <button class="btn btn-ghost" type="button" id="tisaneFormCancel">Отмена</button>
          <button class="btn btn-primary" type="submit">Создать тизан</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(formOv);

  // Экран результата
  const resultOv = document.createElement('div');
  resultOv.className = 'overlay';
  resultOv.id = 'tisaneResultOverlay';
  resultOv.hidden = true;
  resultOv.innerHTML = `
    <div class="modal narrow" role="dialog" aria-modal="true" aria-labelledby="tisaneResultTitle">
      <div class="modal-head">
        <h2 id="tisaneResultTitle">Тизан создан</h2>
        <button class="icon-btn" id="tisaneResultClose" type="button" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <p><b>Состав:</b> <span id="tisaneResultComp"></span></p>
      <p><b>Количество:</b> <span id="tisaneResultQty"></span></p>
      <p><b>Свойства:</b> <span id="tisaneResultProps"></span></p>
      <div class="modal-foot">
        <button class="btn btn-primary" type="button" id="tisaneResultOk">Отлично</button>
      </div>
    </div>`;
  document.body.appendChild(resultOv);

  // Модалка заваривания
  const brewOv = document.createElement('div');
  brewOv.className = 'overlay';
  brewOv.id = 'tisaneBrewOverlay';
  brewOv.hidden = true;
  brewOv.innerHTML = `
    <div class="modal narrow" role="dialog" aria-modal="true" aria-labelledby="tisaneBrewTitle">
      <div class="modal-head">
        <h2 id="tisaneBrewTitle">Заварить тизан</h2>
        <button class="icon-btn" id="tisaneBrewClose" type="button" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <p class="modal-sub" id="tisaneBrewName">—</p>
      <form id="tisaneBrewForm" novalidate>
        <div class="field">
          <label for="tisaneBrewAmount">Количество (г) <span class="req">*</span></label>
          <input id="tisaneBrewAmount" type="number" min="1" step="0.5" value="5" required>
        </div>
        <div class="field">
          <label>Оценка</label>
          <div class="stars" id="tisaneBrewStars">
            ${[1,2,3,4,5].map((i) => `<button type="button" class="star-btn" data-star="${i}" aria-checked="false" aria-label="${i} звёзд">&#9733;</button>`).join('')}
          </div>
        </div>
        <div class="field">
          <label for="tisaneBrewNote">Заметка</label>
          <textarea id="tisaneBrewNote" rows="2" placeholder="Вкус, аромат, впечатления..."></textarea>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" type="button" id="tisaneBrewCancel">Отмена</button>
          <button class="btn btn-primary" type="submit">Заварил</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(brewOv);

  // Модалка журнала тизана
  const journalOv = document.createElement('div');
  journalOv.className = 'overlay';
  journalOv.id = 'tisaneJournalOverlay';
  journalOv.hidden = true;
  journalOv.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="tisaneJournalTitle">
      <div class="modal-head">
        <h2 id="tisaneJournalTitle">Журнал завариваний</h2>
        <button class="icon-btn" id="tisaneJournalClose" type="button" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <p class="modal-sub" id="tisaneJournalTeaName">—</p>
      <div id="tisaneJournalList" class="journal-tea-list"></div>
    </div>`;
  document.body.appendChild(journalOv);
}

// ---------- Своя трава: строка ввода вместо всплывающего окна ----------
async function submitCustomHerb(row) {
  const input = row.querySelector('input');
  const name = (input.value || '').trim();
  if (!name) return showToast('Введите название травы', 'warn');

  const btn = row.querySelector('button');
  btn.disabled = true;

  const { data, error } = await supabase.rpc('suggest_herb', { p_name: name });
  if (error) {
    btn.disabled = false;
    return showToast(error.message, 'warn');
  }

  await reloadTisanes();
  if (data) selected.set(data, { primary: false });
  renderHerbList($('#tisaneHerbSearch')?.value || '');
  row.remove();
  showToast('Трава добавлена в список. Одобрение — после 5 голосов');
}

// ---------- Старт ----------
export async function initTisanes() {
  injectMarkup();

  // Кнопка добавления
  $('#addTisaneBtn')?.addEventListener('click', () => {
    if (!getUser()) return showToast('Сначала войдите', 'warn');
    renderHerbList();
    openOverlay($('#tisaneOverlay'));
  });

  // Форма тизана
  const formOv = $('#tisaneOverlay');
  if (formOv) {
    wireOverlay(formOv);
    $('#tisaneFormClose')?.addEventListener('click', () => closeOverlay(formOv));
    $('#tisaneFormCancel')?.addEventListener('click', () => closeOverlay(formOv));
    $('#tisaneForm')?.addEventListener('submit', submitTisaneForm);
    $('#tisaneHerbSearch')?.addEventListener('input', (e) => renderHerbList(e.target.value));

    // Чекбоксы трав: синхронизируем набор selected
    $('#tisaneHerbList')?.addEventListener('change', (e) => {
      const cb = e.target.closest('input[data-herb]');
      if (!cb) return;
      const id = cb.dataset.herb;
      const row = cb.closest('.herb-row');
      const star = row?.querySelector('[data-primary]');
      if (cb.checked) {
        selected.set(id, { primary: false });
      } else {
        selected.delete(id);
        if (star) star.classList.remove('on');
      }
      if (star) star.hidden = !cb.checked;
    });

    // Звёздочка — основная трава
    $('#tisaneHerbList')?.addEventListener('click', (e) => {
      const star = e.target.closest('[data-primary]');
      if (!star) return;
      const sel = selected.get(star.dataset.primary);
      if (!sel) return;
      sel.primary = !sel.primary;
      star.classList.toggle('on', sel.primary);
    });

    // «+ Другая трава» — добавляет заполняющуюся строку
    $('#addHerbBtn')?.addEventListener('click', () => {
      const box = $('#tisaneCustomHerbRows');
      const row = document.createElement('div');
      row.className = 'row2 custom-herb-row';
      row.innerHTML = `
        <input type="text" placeholder="Название новой травы" maxlength="60">
        <button type="button" class="btn btn-primary btn-sm">Добавить</button>`;
      box.appendChild(row);
      row.querySelector('input').focus();
      row.querySelector('button').addEventListener('click', () => submitCustomHerb(row));
      row.querySelector('input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitCustomHerb(row); }
      });
    });
  }

  // Результат
  const resultOv = $('#tisaneResultOverlay');
  if (resultOv) {
    wireOverlay(resultOv);
    $('#tisaneResultClose')?.addEventListener('click', () => closeOverlay(resultOv));
    $('#tisaneResultOk')?.addEventListener('click', () => closeOverlay(resultOv));
  }

  // Заваривание
  const brewOv = $('#tisaneBrewOverlay');
  if (brewOv) {
    wireOverlay(brewOv);
    $('#tisaneBrewClose')?.addEventListener('click', () => closeOverlay(brewOv));
    $('#tisaneBrewCancel')?.addEventListener('click', () => closeOverlay(brewOv));
    $('#tisaneBrewForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      submitTisaneBrew();
    });
    $('#tisaneBrewStars')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.star-btn');
      if (!btn) return;
      brewRating = Number(btn.dataset.star);
      $$('#tisaneBrewStars .star-btn').forEach((s, i) => {
        s.classList.toggle('on', i < brewRating);
        s.setAttribute('aria-checked', String(i < brewRating));
      });
    });
  }

  // Журнал
  const journalOv = $('#tisaneJournalOverlay');
  if (journalOv) {
    wireOverlay(journalOv);
    $('#tisaneJournalClose')?.addEventListener('click', () => closeOverlay(journalOv));
  }

  // Клики по карточкам активных тизанов
  $('#tisanesGrid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = btn.closest('.tisane-card');
    if (!card) return;
    const r = activeTisanes.find((t) => String(t.id) === card.dataset.tisaneId);
    if (!r) return;

    if (btn.dataset.action === 'brew') return openTisaneBrew(r);
    if (btn.dataset.action === 'restock') return restockTisane(r);
    if (btn.dataset.action === 'journal') return openTisaneJournal(r);
  });

  await reloadTisanes();
  renderTisanes();
}