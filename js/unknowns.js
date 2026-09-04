// ============================================================
// unknowns.js — неизвестные чаи на полке.
// Сам инъектит разметку: секция «Неизвестные», форма добавления,
// модалка завершения, напоминания.
// Архив неизвестных вынесен в общую модалку архива (shelf.js).
// ============================================================
import { supabase } from './supabaseClient.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import {
  $, $$, showToast, openOverlay, closeOverlay, wireOverlay,
  escapeHtml, UNIT_LABELS, askConfirm, trackEvent,
} from './ui.js';
import { getUser } from './auth.js';
import { openAmountModal } from './amountModal.js';

// ---------- Модульное состояние ----------
let myUnknowns = [];
let nameByUnknownId = new Map();
let finishedRow = null;
let pendingPhotoUrl = null;

// ---------- Имя неизвестного ----------
function unknownName(r) {
  return r.name || `Неизвестный чай #${r.unknown_number}`;
}

// ---------- Экспорт для журнала полки ----------
export function unknownJournalName(unknownId) {
  return nameByUnknownId.get(unknownId) || 'Неизвестный чай';
}

// ---------- Загрузка ----------
export async function reloadUnknowns() {
  const user = getUser();
  if (!user) {
    myUnknowns = [];
  } else {
    const { data } = await supabase.from('unknown_teas')
      .select('*')
      .eq('user_id', user.id)
      .in('status', ['active', 'finished'])
      .order('unknown_number', { ascending: true });
    myUnknowns = data || [];
  }
  nameByUnknownId.clear();
  myUnknowns.forEach((r) => nameByUnknownId.set(r.id, unknownName(r)));
}

// ---------- Секция на полке ----------
export function renderUnknowns() {
  const grid = $('#unknownsGrid');
  if (!grid) return;
  $('#unknownsCount').textContent = myUnknowns.length;
  grid.innerHTML = '';

  if (!getUser()) {
    grid.innerHTML = '<p class="hint">Раздел доступен после входа.</p>';
    return;
  }
  if (!myUnknowns.length) {
    grid.innerHTML = '<p class="hint">Нет неизвестных чаёв. Если у вас есть чай без названия — добавьте его сюда.</p>';
    return;
  }

  myUnknowns
    .filter((r) => r.status === 'active')
    .forEach((r) => grid.appendChild(unknownCard(r)));
}

// ---------- Карточка неизвестного ----------
function unknownCard(r) {
  const node = document.createElement('article');
  node.className = 'card unknown-card';
  node.dataset.unknownId = r.id;

  const qty = Number(r.quantity || 0);
  const isFinished = qty <= 0 || r.status === 'finished';

  node.innerHTML = `
    <div class="card-top">
      <span class="pill pill-unknown"><i aria-hidden="true"></i>#${r.unknown_number}</span>
    </div>
    <h3 class="card-name">${escapeHtml(unknownName(r))}</h3>
    ${r.description ? `<p class="unknown-desc">${escapeHtml(r.description)}</p>` : ''}
    ${r.photo_url ? `<img class="unknown-photo" src="${escapeHtml(r.photo_url)}" alt="Фото чая" loading="lazy">` : ''}
    <div class="qty-row">
      <span class="qty-val">${qty} <em>${UNIT_LABELS[r.quantity_unit] || 'г'}</em></span>
    </div>
    <div class="card-actions">
      ${isFinished
        ? `<button class="btn btn-outline btn-sm" type="button" data-action="finish">Завершить</button>`
        : `<button class="btn btn-primary btn-sm" type="button" data-action="brew">Заварил</button>
           <button class="btn btn-outline btn-sm" type="button" data-action="finish">Завершить</button>`}
    </div>`;
  return node;
}

// ---------- Заваривание ----------
function openUnknownBrew(r) {
  openAmountModal({
    mode: 'brew',
    teaName: unknownName(r),
    unit: r.quantity_unit,
    maxAmount: Number(r.quantity),
    onSubmit: async (p) => {
      const { data, error } = await supabase.rpc('brew_unknown', {
        p_unknown_id: r.id,
        p_amount: p.amount,
        p_rating: p.rating || null,
        p_note: p.note || null,
      });
      if (error) return showToast('Ошибка: ' + error.message, 'warn');

      const left = Number(data?.remaining ?? (Number(r.quantity) - p.amount));
      if (left <= 0) {
        showToast(`Неизвестный чай #${r.unknown_number} закончился.`);
        openFinishedModal(r);
      } else {
        showToast(`Заваривание записано. Осталось ${left} ${UNIT_LABELS[r.quantity_unit] || 'г'}`);
      }
      await reloadUnknowns();
      renderUnknowns();
    },
  });
}

// ---------- Модалка завершения ----------
function openFinishedModal(r) {
  finishedRow = r;
  $('#finishedUnknownName').textContent = unknownName(r);
  $('#finishedManualRow').classList.add('hidden');
  $('#finishedManualName').value = '';
  const del = $('#finishedDeleteBtn');
  delete del.dataset.armed;
  del.textContent = 'Удалить сейчас';
  openOverlay($('#unknownFinishedOverlay'));
}

async function finishedAction(action) {
  if (!finishedRow) return;
  const r = finishedRow;

  if (action === 'remind') {
    const { error } = await supabase.from('unknown_teas')
      .update({ remind_at: new Date(Date.now() + 7 * 864e5).toISOString() })
      .eq('id', r.id);
    if (error) return showToast('Ошибка: ' + error.message, 'warn');
    closeOverlay($('#unknownFinishedOverlay'));
    showToast('Напомним через 7 дней');
    await reloadUnknowns();
    renderUnknowns();
    return;
  }

  if (action === 'manual-identify') {
    const name = $('#finishedManualName').value.trim();
    if (!name) return showToast('Введите название', 'warn');

    // Ищем в каталоге
    const { data: found } = await supabase.from('tea_catalog')
      .select('id')
      .eq('status', 'published')
      .ilike('name', name)
      .limit(1);

    if (found && found.length) {
      const { error } = await supabase.rpc('identify_unknown_tea', {
        p_unknown_id: r.id,
        p_tea_id: found[0].id,
      });
      if (error) return showToast('Ошибка: ' + error.message, 'warn');
      closeOverlay($('#unknownFinishedOverlay'));
      showToast('Чай опознан и перенесён на полку');
      window.dispatchEvent(new Event('tea-shelf-changed'));
      await reloadUnknowns();
      renderUnknowns();
    } else {
      showToast('Чай с таким названием не найден в каталоге', 'warn');
    }
    return;
  }

  const { error } = await supabase.rpc('unknown_lifecycle_action', {
    p_unknown_id: r.id,
    p_action: action,
  });
  if (error) return showToast('Ошибка: ' + error.message, 'warn');

  closeOverlay($('#unknownFinishedOverlay'));
  showToast(action === 'archive'
    ? 'Запись перенесена в архив'
    : `Неизвестный чай #${r.unknown_number} удалён. Журнал сохранён в архиве.`);
  await reloadUnknowns();
  renderUnknowns();
}

// ---------- Форма добавления ----------
async function submitUnknownForm(e) {
  e.preventDefault();
  const user = getUser();
  if (!user) return showToast('Сначала войдите', 'warn');

  const qty = Number($('#unknownQty').value);
  if (!qty || qty <= 0) return showToast('Укажите количество', 'warn');

  const { data, error } = await supabase.from('unknown_teas')
    .insert({
      user_id: user.id,
      name: $('#unknownName').value.trim() || 'Неизвестный чай',
      description: $('#unknownDescription').value.trim() || null,
      photo_url: pendingPhotoUrl,
      quantity: qty,
      quantity_unit: $('#unknownUnitSel').value || 'g',
    })
    .select()
    .single();
  if (error) return showToast('Ошибка: ' + error.message, 'warn');

  closeOverlay($('#unknownOverlay'));
  showToast(`Неизвестный чай #${data.unknown_number} добавлен на полку`);
  e.target.reset();
  pendingPhotoUrl = null;
  $('#unknownPhotoPreview').classList.add('hidden');
  await reloadUnknowns();
  renderUnknowns();
}

// ---------- Загрузка фото ----------
async function uploadUnknownPhoto(file) {
  const { data: { session } } = await supabase.auth.getSession();
  const path = `unknown/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`;
  const url = `${SUPABASE_URL}/storage/v1/object/tea-photos/${path}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
      'Content-Type': file.type || 'image/jpeg',
      'x-upsert': 'false',
    },
    body: file,
  });

  if (!res.ok) {
    showToast('Ошибка загрузки фото', 'warn');
    return null;
  }

  return `${SUPABASE_URL}/storage/v1/object/public/tea-photos/${path}`;
}

// ---------- Инъекция разметки ----------
function injectMarkup() {
  const tisanesPanel = $('#tisanesPanel') || $('#journalPanel');

  const section = document.createElement('section');
  section.className = 'panel unknowns-panel';
  section.id = 'unknownsPanel';
  section.setAttribute('aria-labelledby', 'unknownsTitle');
  section.innerHTML = `
    <div class="panel-head-row">
      <h3 id="unknownsTitle">Неизвестные <span class="cnt" id="unknownsCount">0</span></h3>
      <button class="btn btn-primary btn-sm" id="addUnknownBtn" type="button">+ Добавить неизвестный</button>
    </div>
    <p class="psub">Чаи без названия. Буферный период: 30 дней после завершения.</p>
    <div class="unknowns-grid" id="unknownsGrid"></div>`;
  tisanesPanel.parentNode.insertBefore(section, tisanesPanel.nextSibling);

  // Форма добавления
  const formOv = document.createElement('div');
  formOv.className = 'overlay';
  formOv.id = 'unknownOverlay';
  formOv.hidden = true;
  formOv.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="unknownFormTitle">
      <div class="modal-head">
        <h2 id="unknownFormTitle">Добавить неизвестный чай</h2>
        <button class="icon-btn" id="unknownFormClose" type="button" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <form id="unknownForm" novalidate>
        <div class="field">
          <label for="unknownName">Название (необязательно)</label>
          <input id="unknownName" type="text" placeholder="Неизвестный чай">
        </div>
        <div class="field">
          <label for="unknownDescription">Описание</label>
          <textarea id="unknownDescription" rows="3" placeholder="Откуда этот чай, что помните о нём..."></textarea>
        </div>
        <div class="field">
          <label>Фото</label>
          <input type="file" id="unknownPhotoInput" accept="image/*" hidden>
          <button type="button" class="btn btn-outline btn-sm" id="unknownPhotoBtn">Выбрать фото</button>
          <img id="unknownPhotoPreview" class="hidden" alt="Превью фото" style="max-width:150px; margin-top:8px; border-radius:8px;">
        </div>
        <div class="row2">
          <div class="field">
            <label for="unknownQty">Количество <span class="req">*</span></label>
            <input id="unknownQty" type="number" min="1" step="1" value="50" required>
          </div>
          <div class="field">
            <label for="unknownUnitSel">Единица</label>
            <select id="unknownUnitSel">
              <option value="g">граммы</option>
              <option value="sachet">пакетики</option>
              <option value="pcs">упаковки</option>
            </select>
          </div>
        </div>
        <p class="hint">Неизвестные чаи удаляются после завершения, если не будут опознаны. Буферный период: 30 дней.</p>
        <div class="modal-foot">
          <button class="btn btn-ghost" type="button" id="unknownFormCancel">Отмена</button>
          <button class="btn btn-primary" type="submit">Добавить</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(formOv);

  // Модалка завершения
  const finOv = document.createElement('div');
  finOv.className = 'overlay';
  finOv.id = 'unknownFinishedOverlay';
  finOv.hidden = true;
  finOv.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="finishedTitle">
      <div class="modal-head">
        <h2 id="finishedTitle">Чай закончился</h2>
        <button class="icon-btn" id="finishedClose" type="button" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <p class="modal-sub" id="finishedUnknownName">—</p>
      <p class="hint">Что делать с этим чаем?</p>
      <div class="stack-actions">
        <button class="btn btn-outline" type="button" id="finishedIdentifyBtn">Найти в каталоге</button>
        <button class="btn btn-outline" type="button" id="finishedManualToggle">Ввести название вручную</button>
        <div class="row2 hidden" id="finishedManualRow">
          <input id="finishedManualName" type="text" placeholder="Название чая из каталога">
          <button class="btn btn-sm" type="button" id="finishedManualSubmit">Опознать</button>
        </div>
      </div>
      <p class="hint">Если не опознать:</p>
      <div class="stack-actions">
        <button class="btn btn-outline" type="button" id="finishedArchiveBtn">Перенести в архив</button>
        <button class="btn btn-outline" type="button" id="finishedRemindBtn">Напомнить через 7 дней</button>
        <button class="btn btn-ghost danger-text" type="button" id="finishedDeleteBtn">Удалить сейчас</button>
      </div>
    </div>`;
  document.body.appendChild(finOv);
}

// ---------- Старт ----------
export async function initUnknowns() {
  injectMarkup();

  $('#addUnknownBtn')?.addEventListener('click', () => {
    if (!getUser()) return showToast('Сначала войдите', 'warn');
    openOverlay($('#unknownOverlay'));
  });

  const formOv = $('#unknownOverlay');
  if (formOv) {
    wireOverlay(formOv);
    $('#unknownFormClose')?.addEventListener('click', () => closeOverlay(formOv));
    $('#unknownFormCancel')?.addEventListener('click', () => closeOverlay(formOv));
    $('#unknownForm')?.addEventListener('submit', submitUnknownForm);

    // Загрузка фото
    $('#unknownPhotoBtn')?.addEventListener('click', () => $('#unknownPhotoInput')?.click());
    $('#unknownPhotoInput')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const url = await uploadUnknownPhoto(file);
      if (url) {
        pendingPhotoUrl = url;
        const img = $('#unknownPhotoPreview');
        img.src = url;
        img.classList.remove('hidden');
        showToast('Фото загружено');
      }
    });
  }

  // Модалка завершения
  const finOv = $('#unknownFinishedOverlay');
  if (finOv) {
    wireOverlay(finOv);
    $('#finishedClose')?.addEventListener('click', () => closeOverlay(finOv));
    $('#finishedIdentifyBtn')?.addEventListener('click', () => {
      closeOverlay(finOv);
      window.location.href = 'catalog.html';
    });
    $('#finishedManualToggle')?.addEventListener('click', () => {
      $('#finishedManualRow').classList.toggle('hidden');
    });
    $('#finishedManualSubmit')?.addEventListener('click', () => finishedAction('manual-identify'));
    $('#finishedArchiveBtn')?.addEventListener('click', () => finishedAction('archive'));
    $('#finishedRemindBtn')?.addEventListener('click', () => finishedAction('remind'));
    $('#finishedDeleteBtn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!btn.dataset.armed) {
        btn.dataset.armed = '1';
        btn.textContent = 'Точно удалить?';
        return;
      }
      finishedAction('delete');
    });
  }

  // Клики по карточкам неизвестных
  $('#unknownsGrid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = btn.closest('.unknown-card');
    if (!card) return;
    const r = myUnknowns.find((t) => String(t.id) === card.dataset.unknownId);
    if (!r) return;

    if (btn.dataset.action === 'brew') return openUnknownBrew(r);
    if (btn.dataset.action === 'finish') return openFinishedModal(r);
  });

  await reloadUnknowns();
  renderUnknowns();
}