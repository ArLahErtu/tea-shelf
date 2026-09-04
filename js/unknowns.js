// ============================================================
// unknowns.js — неизвестные чаи на полке.
// Восстановлена рабочая версия: пунктирные карточки, опознание,
// напоминания 7/1 день, модалка завершения.
// Фото — сырой fetch с явным Content-Type (фикс отображения).
// Архив журналов вынесен в общую модалку (shelf.js).
// ============================================================
import { supabase } from './supabaseClient.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import {
  $, $$, showToast, openOverlay, closeOverlay, wireOverlay,
  escapeHtml, UNIT_LABELS,
} from './ui.js';
import { getUser } from './auth.js';

let unknowns = [];
let injected = false;
let brewRow = null;
let brewRating = 0;
let identifyRow = null;
let identifyTeaId = null;
let pendingPhotoUrl = null;
let finishedRow = null;

const nameByUnknownId = new Map();

// Имя для общего журнала (использует shelf.js)
export function unknownJournalName(j) {
  if (!j.unknown_id) return null;
  return nameByUnknownId.get(j.unknown_id) || 'Неизвестный чай';
}

// ---------- Загрузка ----------
export async function reloadUnknowns() {
  const user = getUser();
  if (!user) {
    unknowns = [];
  } else {
    // автоочистка просроченных (дублирует pg_cron)
    try { await supabase.rpc('cleanup_finished_unknown_teas'); } catch (e) { /* noop */ }

    const { data } = await supabase.from('unknown_teas')
      .select('*')
      .eq('user_id', user.id)
      .neq('status', 'deleted')
      .order('unknown_number');
    unknowns = data || [];
  }
  nameByUnknownId.clear();
  unknowns.forEach((r) =>
    nameByUnknownId.set(r.id, `${r.name || 'Неизвестный чай'} #${r.unknown_number}`));
}

// ---------- Секция ----------
export function renderUnknowns() {
  const grid = $('#unknownsGrid');
  if (!grid) return;
  $('#unknownsCount').textContent = unknowns.length;
  grid.innerHTML = '';

  if (!getUser()) {
    grid.innerHTML = '<p class="hint">Раздел доступен после входа.</p>';
    return;
  }

  // напоминания «7 дней / 1 день»
  unknowns.forEach((r) => {
    if (r.status !== 'finished' || !r.finished_at) return;
    if (r.remind_at && new Date(r.remind_at) > new Date()) return;
    const daysLeft = Math.max(0,
      30 - Math.floor((Date.now() - new Date(r.finished_at)) / 864e5));
    if (daysLeft > 7) return;

    const note = document.createElement('div');
    note.className = 'warn-note';
    note.append(document.createTextNode(daysLeft <= 1
      ? `Неизвестный чай #${r.unknown_number} будет удалён завтра. Журнал будет экспортирован. `
      : `Неизвестный чай #${r.unknown_number} будет удалён через ${daysLeft} дн. Хотите опознать его? `));
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline btn-sm';
    btn.type = 'button';
    btn.textContent = 'Опознать';
    btn.addEventListener('click', () => openIdentify(r));
    note.appendChild(btn);
    grid.appendChild(note);
  });

  if (!unknowns.length) {
    grid.innerHTML = '<p class="hint">Пока нет неизвестных чаёв. Добавьте чай, который не можете опознать.</p>';
    return;
  }
  unknowns.forEach((r) => grid.appendChild(unknownCard(r)));
}

function unknownCard(r) {
  const node = document.createElement('article');
  node.className = 'card unknown-card' + (r.status === 'finished' ? ' is-finished' : '');
  node.dataset.unknownId = r.id;
  const qty = Number(r.quantity);

  const badge = r.status === 'finished'
    ? '<span class="modbadge">Завершён, 30 дней до удаления</span>'
    : (r.status === 'archived' ? '<span class="modbadge">В архиве</span>' : '');

  node.innerHTML = `
    <div class="card-top">
      <span class="pill pill-unknown">#${r.unknown_number}</span>
      ${badge}
    </div>
    ${r.photo_url ? `<img class="unknown-photo" src="${escapeHtml(r.photo_url)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
    <h3 class="card-name">${escapeHtml(r.name || 'Неизвестный чай')}</h3>
    ${r.description ? `<p class="tisane-comp">${escapeHtml(r.description)}</p>` : ''}
    <div class="qty-row">
      <span class="qty-val">${qty} <em>${UNIT_LABELS[r.quantity_unit] || 'г'}</em></span>
    </div>
    <div class="card-actions">
      ${r.status === 'active' && qty > 0
        ? '<button class="btn btn-primary btn-sm" type="button" data-action="brew">Заварил</button>'
        : ''}
      <button class="btn btn-outline btn-sm" type="button" data-action="identify">Опознать чай</button>
      <button class="btn btn-ghost btn-sm" type="button" data-action="journal">Журнал</button>
    </div>`;
  return node;
}

// ---------- Фото: сырой fetch с явным Content-Type ----------
const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', avif: 'image/avif', gif: 'image/gif',
};

async function convertToJpeg(file, maxSide = 1600) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('canvas.toBlob вернул null');
  return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
}

async function rawStorageUpload(path, body, mime) {
  const { data: { session } } = await supabase.auth.getSession();
  const url = `${SUPABASE_URL}/storage/v1/object/tea-photos/${path}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
      'Content-Type': mime,
      'x-upsert': 'false',
      'cache-control': 'public, max-age=3600',
    },
    body,
  });

  if (!res.ok) {
    let detail = `${res.status}`;
    try { detail += ' ' + (await res.text()); } catch (e) { /* ignore */ }
    throw new Error(detail);
  }

  return `${SUPABASE_URL}/storage/v1/object/public/tea-photos/${path}`;
}

async function verifyServedImage(url) {
  for (let i = 1; i <= 3; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const ct = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (res.ok && ct.startsWith('image/')) return true;
    } catch (e) { /* noop */ }
  }
  return false;
}

async function uploadUnknownPhoto(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const mime = file.type || MIME_BY_EXT[ext] || 'image/jpeg';
  const path = `unknown/unknown-${Date.now()}.${ext}`;

  let publicUrl = null;
  try {
    publicUrl = await rawStorageUpload(path, file, mime);
  } catch (err) {
    console.warn('[unknownPhoto] оригинал отклонён:', err.message);
  }

  if (!publicUrl) {
    try {
      const jpeg = await convertToJpeg(file);
      publicUrl = await rawStorageUpload(path.replace(/\.\w+$/, '.jpg'), jpeg, 'image/jpeg');
      showToast('Хранилище не приняло формат — сохранено как JPG');
    } catch (err) {
      showToast('Ошибка загрузки фото: ' + err.message, 'warn');
      return null;
    }
  }

  const ok = await verifyServedImage(publicUrl);
  if (!ok) {
    try {
      const jpeg = await convertToJpeg(file);
      const url2 = await rawStorageUpload(`unknown/unknown-${Date.now()}.jpg`, jpeg, 'image/jpeg');
      showToast('Сервер не принял формат — сохранено как JPG');
      return url2;
    } catch (e) { /* остаёмся с оригиналом */ }
  }
  return publicUrl;
}

// ---------- Заваривание ----------
function openUnknownBrew(r) {
  brewRow = r;
  brewRating = 0;
  $('#unknownBrewName').textContent = `${r.name || 'Неизвестный чай'} #${r.unknown_number}`;
  $('#unknownBrewAmount').value = Math.min(7, Number(r.quantity)) || 1;
  $('#unknownBrewNote').value = '';
  $$('#unknownBrewStars .star-btn').forEach((s) => {
    s.classList.remove('on');
    s.setAttribute('aria-checked', 'false');
  });
  openOverlay($('#unknownBrewOverlay'));
}

async function submitUnknownBrew() {
  if (!brewRow) return;
  const used = Number($('#unknownBrewAmount').value);
  if (!used || used <= 0) return showToast('Укажите количество', 'warn');
  if (used > Number(brewRow.quantity)) {
    return showToast('На полке меньше этого количества', 'warn');
  }

  const { data, error } = await supabase.rpc('brew_unknown', {
    p_unknown_id: brewRow.id,
    p_amount: used,
    p_rating: brewRating || null,
    p_note: $('#unknownBrewNote').value.trim() || null,
  });
  if (error) return showToast('Ошибка: ' + error.message, 'warn');

  closeOverlay($('#unknownBrewOverlay'));
  const left = Number(data);
  await reloadUnknowns();
  renderUnknowns();
  if (left <= 0) {
    openFinishedModal(unknowns.find((x) => x.id === brewRow.id) || brewRow);
  } else {
    showToast(`Заваривание записано. Осталось ${left} ${UNIT_LABELS[brewRow.quantity_unit] || 'г'}`);
  }
}

// ---------- Опознание ----------
function openIdentify(r) {
  identifyRow = r;
  identifyTeaId = null;
  $('#identifyUnknownName').textContent =
    `${r.name || 'Неизвестный чай'} #${r.unknown_number}`;
  $('#identifySearch').value = '';
  $('#identifyResults').innerHTML = '<p class="hint">Начните вводить название…</p>';
  $('#identifyConfirm').disabled = true;
  openOverlay($('#unknownIdentifyOverlay'));
}

async function searchIdentify(q) {
  const box = $('#identifyResults');
  if (!q || q.length < 2) {
    box.innerHTML = '<p class="hint">Начните вводить название…</p>';
    return;
  }
  const { data } = await supabase.from('tea_catalog')
    .select('id, name, type, region')
    .eq('status', 'published')
    .ilike('name', `%${q}%`)
    .limit(8);
  const list = data || [];
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<p class="hint">Ничего не найдено.</p>';
    return;
  }
  list.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'herb-row identify-row';
    row.dataset.teaId = t.id;
    row.innerHTML = `
      <span class="herb-name"><b>${escapeHtml(t.name)}</b>
        <em class="herb-pending">${escapeHtml(t.type || '')} ${escapeHtml(t.region || '')}</em>
      </span>`;
    row.addEventListener('click', () => {
      identifyTeaId = t.id;
      $$('#identifyResults .identify-row').forEach((x) => x.classList.remove('sel'));
      row.classList.add('sel');
      $('#identifyConfirm').disabled = false;
      $('#identifyConfirm').dataset.teaName = t.name;
    });
    box.appendChild(row);
  });
}

async function confirmIdentify() {
  if (!identifyRow || !identifyTeaId) return;
  const teaName = $('#identifyConfirm').dataset.teaName || 'чай';

  const { error } = await supabase.rpc('identify_unknown_tea', {
    p_unknown_id: identifyRow.id,
    p_tea_id: Number(identifyTeaId),
  });
  if (error) return showToast('Ошибка: ' + error.message, 'warn');

  closeOverlay($('#unknownIdentifyOverlay'));
  showToast(`Неизвестный чай #${identifyRow.unknown_number} опознан! Остатки перенесены на «${teaName}».`);
  await reloadUnknowns();
  renderUnknowns();
  window.dispatchEvent(new Event('tea-shelf-changed'));
}

// ---------- Журнал ----------
async function openUnknownJournal(r) {
  $('#unknownJournalTeaName').textContent =
    `${r.name || 'Неизвестный чай'} #${r.unknown_number}`;
  const list = $('#unknownJournalList');
  list.innerHTML = '<p class="hint">Загружаем…</p>';
  openOverlay($('#unknownJournalOverlay'));

  const { data } = await supabase.from('brew_journal')
    .select('*').eq('unknown_id', r.id)
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

// ---------- Форма ----------
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

// ---------- Модалка завершения ----------
function openFinishedModal(r) {
  finishedRow = r;
  $('#finishedUnknownName').textContent =
    `${r.name || 'Неизвестный чай'} #${r.unknown_number}`;
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

  const { error } = await supabase.rpc('unknown_lifecycle_action', {
    p_unknown_id: r.id,
    p_action: action, // 'archive' | 'delete'
  });
  if (error) return showToast('Ошибка: ' + error.message, 'warn');

  closeOverlay($('#unknownFinishedOverlay'));
  showToast(action === 'archive'
    ? 'Запись перенесена в архив'
    : `Неизвестный чай #${r.unknown_number} удалён. Журнал завариваний сохранён в архиве.`);
  await reloadUnknowns();
  renderUnknowns();
}

async function finishedManualIdentify() {
  const q = $('#finishedManualName').value.trim();
  if (!q || !finishedRow) return;
  const { data } = await supabase.from('tea_catalog')
    .select('id, name').eq('status', 'published')
    .ilike('name', q).limit(1);
  const tea = (data || [])[0];
  if (!tea) return showToast('Такой чай не найден в каталоге', 'warn');

  const { error } = await supabase.rpc('identify_unknown_tea', {
    p_unknown_id: finishedRow.id,
    p_tea_id: Number(tea.id),
  });
  if (error) return showToast('Ошибка: ' + error.message, 'warn');

  closeOverlay($('#unknownFinishedOverlay'));
  showToast(`Неизвестный чай #${finishedRow.unknown_number} опознан! Остатки перенесены на «${tea.name}».`);
  await reloadUnknowns();
  renderUnknowns();
  window.dispatchEvent(new Event('tea-shelf-changed'));
}

// ---------- Инъекция разметки ----------
function injectMarkup() {
  const journal = $('#journalPanel');
  const section = document.createElement('section');
  section.className = 'panel unknowns-panel';
  section.id = 'unknownsPanel';
  section.setAttribute('aria-labelledby', 'unknownsTitle');
  section.innerHTML = `
    <div class="panel-head-row">
      <h3 id="unknownsTitle">Неизвестные <span class="cnt" id="unknownsCount">0</span></h3>
      <button class="btn btn-primary btn-sm" id="addUnknownBtn" type="button">+ Добавить неизвестный чай</button>
    </div>
    <p class="psub">Временные записи для чаёв, которые ещё предстоит опознать.</p>
    <div class="tisanes-grid" id="unknownsGrid"></div>`;
  journal.parentNode.insertBefore(section, journal);

  const overlays = document.createElement('div');
  overlays.innerHTML = `
  <div class="overlay" id="unknownOverlay" hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="unknownFormTitle">
      <div class="modal-head">
        <h2 id="unknownFormTitle">Неизвестный чай</h2>
        <button class="icon-btn" id="unknownClose" type="button" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <form id="unknownForm" novalidate>
        <div class="field">
          <label for="unknownName">Название (опционально)</label>
          <input id="unknownName" type="text" maxlength="255" placeholder="По умолчанию «Неизвестный чай»">
        </div>
        <div class="field">
          <label for="unknownDescription">Описание (что известно)</label>
          <textarea id="unknownDescription" rows="3" maxlength="500" placeholder="Например: подарок, упаковка без этикетки, пахнет дымом…"></textarea>
        </div>
        <div class="field">
          <label>Фото упаковки (опционально)</label>
          <div class="upload-controls">
            <label class="btn btn-outline btn-sm" for="unknownPhotoInput">Выбрать файл</label>
            <input type="file" id="unknownPhotoInput" accept="image/*" hidden>
          </div>
          <img id="unknownPhotoPreview" class="hidden" alt="Предпросмотр фото" style="max-width:120px;border-radius:8px;margin-top:8px;">
        </div>
        <div class="row2">
          <div class="field">
            <label for="unknownQty">Количество на полку <span class="req">*</span></label>
            <input id="unknownQty" type="number" min="1" step="1" value="100" required>
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
        <p class="warn-note">Неизвестные чаи удаляются после завершения, если не будут опознаны. Буферный период: 30 дней.</p>
        <div class="modal-foot">
          <button class="btn btn-ghost" type="button" id="unknownCancel">Отмена</button>
          <button class="btn btn-primary" type="submit">Сохранить и добавить на полку</button>
        </div>
      </form>
    </div>
  </div>

  <div class="overlay" id="unknownFinishedOverlay" hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="finishedTitle">
      <div class="modal-head">
        <h2 id="finishedTitle">Неизвестный чай закончился</h2>
        <button class="icon-btn" id="finishedClose" type="button" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <p class="modal-sub" id="finishedUnknownName">—</p>
      <p class="hint">Хотите опознать его перед удалением?</p>
      <div class="stack-actions">
        <button class="btn btn-outline" type="button" id="finishedIdentifyBtn">Найти в каталоге</button>
        <button class="btn btn-outline" type="button" id="finishedManualToggle">Ввести название вручную</button>
        <div class="row2 hidden" id="finishedManualRow">
          <input id="finishedManualName" type="text" placeholder="Название чая из каталога">
          <button class="btn btn-sm" type="button" id="finishedManualSubmit">Опознать</button>
        </div>
        <button class="btn btn-outline" type="button" id="finishedAiBtn">Фото для ИИ-идентификации</button>
      </div>
      <p class="hint">Если не опознать:</p>
      <div class="stack-actions">
        <button class="btn btn-outline" type="button" id="finishedArchiveBtn">Перенести в архив</button>
        <button class="btn btn-outline" type="button" id="finishedRemindBtn">Напомнить через 7 дней</button>
        <button class="btn btn-ghost danger-text" type="button" id="finishedDeleteBtn">Удалить сейчас</button>
      </div>
    </div>
  </div>

  <div class="overlay" id="unknownIdentifyOverlay" hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="identifyTitle">
      <div class="modal-head">
        <h2 id="identifyTitle">Опознать чай</h2>
        <button class="icon-btn" id="identifyClose" type="button" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <p class="modal-sub" id="identifyUnknownName">—</p>
      <div class="field">
        <label for="identifySearch">Поиск в каталоге</label>
        <input id="identifySearch" type="search" placeholder="Название чая…">
      </div>
      <div class="herb-list" id="identifyResults"></div>
      <div class="modal-foot">
        <button class="btn btn-ghost" type="button" id="identifyCancel">Отмена</button>
        <button class="btn btn-primary" type="button" id="identifyConfirm" disabled>Это этот чай</button>
      </div>
    </div>
  </div>

  <div class="overlay" id="unknownBrewOverlay" hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="unknownBrewTitle">
      <div class="modal-head">
        <h2 id="unknownBrewTitle">Заварить неизвестный чай</h2>
        <button class="icon-btn" id="unknownBrewClose" type="button" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <p class="modal-sub" id="unknownBrewName">—</p>
      <form id="unknownBrewForm" novalidate>
        <div class="field">
          <label for="unknownBrewAmount">Количество</label>
          <input id="unknownBrewAmount" type="number" inputmode="decimal" min="1" step="1" value="7" required>
        </div>
        <div class="field">
          <label for="unknownBrewNote">Заметка</label>
          <textarea id="unknownBrewNote" rows="3" maxlength="500" placeholder="Вкус, аромат, впечатления…"></textarea>
        </div>
        <div class="field">
          <label>Оценка</label>
          <div class="stars-input" id="unknownBrewStars" role="radiogroup" aria-label="Оценка заваривания">
            <button class="star-btn" type="button" role="radio" aria-checked="false" data-value="1">★</button>
            <button class="star-btn" type="button" role="radio" aria-checked="false" data-value="2">★</button>
            <button class="star-btn" type="button" role="radio" aria-checked="false" data-value="3">★</button>
            <button class="star-btn" type="button" role="radio" aria-checked="false" data-value="4">★</button>
            <button class="star-btn" type="button" role="radio" aria-checked="false" data-value="5">★</button>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" id="unknownBrewCancel" type="button">Отмена</button>
          <button class="btn btn-primary" type="submit">Заварил</button>
        </div>
      </form>
    </div>
  </div>

  <div class="overlay" id="unknownJournalOverlay" hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="unknownJournalTitle">
      <div class="modal-head">
        <h2 id="unknownJournalTitle">Журнал завариваний</h2>
        <button class="icon-btn" id="unknownJournalClose" type="button" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <p class="modal-sub" id="unknownJournalTeaName">—</p>
      <div id="unknownJournalList" class="journal-tea-list"></div>
    </div>
  </div>`;
  document.body.appendChild(overlays);
}

// ---------- Старт ----------
export async function initUnknowns() {
  if (!injected) {
    injected = true;
    injectMarkup();

    $('#addUnknownBtn').addEventListener('click', () => {
      if (!getUser()) return showToast('Сначала войдите', 'warn');
      openOverlay($('#unknownOverlay'));
    });
    $('#unknownClose').addEventListener('click', () => closeOverlay($('#unknownOverlay')));
    $('#unknownCancel').addEventListener('click', () => closeOverlay($('#unknownOverlay')));
    $('#unknownForm').addEventListener('submit', submitUnknownForm);

    $('#unknownPhotoInput').addEventListener('change', async (e) => {
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

    // Опознание
    $('#identifyClose').addEventListener('click', () => closeOverlay($('#unknownIdentifyOverlay')));
    $('#identifyCancel').addEventListener('click', () => closeOverlay($('#unknownIdentifyOverlay')));
    $('#identifyConfirm').addEventListener('click', confirmIdentify);
    let identifyTimer = null;
    $('#identifySearch').addEventListener('input', (e) => {
      clearTimeout(identifyTimer);
      identifyTimer = setTimeout(() => searchIdentify(e.target.value.trim()), 350);
    });

    // Заваривание
    wireOverlay($('#unknownBrewOverlay'));
    $('#unknownBrewClose').addEventListener('click', () => closeOverlay($('#unknownBrewOverlay')));
    $('#unknownBrewCancel').addEventListener('click', () => closeOverlay($('#unknownBrewOverlay')));
    $('#unknownBrewStars').addEventListener('click', (e) => {
      const b = e.target.closest('.star-btn');
      if (!b) return;
      brewRating = Number(b.dataset.value);
      $$('#unknownBrewStars .star-btn').forEach((s) => {
        s.classList.toggle('on', Number(s.dataset.value) <= brewRating);
        s.setAttribute('aria-checked', String(s === b));
      });
    });
    $('#unknownBrewForm').addEventListener('submit', (e) => {
      e.preventDefault();
      submitUnknownBrew();
    });

    // Журнал
    wireOverlay($('#unknownJournalOverlay'));
    $('#unknownJournalClose').addEventListener('click', () => closeOverlay($('#unknownJournalOverlay')));

    // Модалка завершения
    $('#finishedClose').addEventListener('click', () => closeOverlay($('#unknownFinishedOverlay')));
    $('#finishedIdentifyBtn').addEventListener('click', () => {
      const r = finishedRow;
      closeOverlay($('#unknownFinishedOverlay'));
      if (r) openIdentify(r);
    });
    $('#finishedManualToggle').addEventListener('click', () =>
      $('#finishedManualRow').classList.toggle('hidden'));
    $('#finishedManualSubmit').addEventListener('click', finishedManualIdentify);
    $('#finishedAiBtn').addEventListener('click', () =>
      showToast('ИИ-идентификация по фото появится в следующем этапе', 'warn'));
    $('#finishedArchiveBtn').addEventListener('click', () => finishedAction('archive'));
    $('#finishedRemindBtn').addEventListener('click', () => finishedAction('remind'));
    $('#finishedDeleteBtn').addEventListener('click', () => {
      const btn = $('#finishedDeleteBtn');
      if (!btn.dataset.armed) {
        btn.dataset.armed = '1';
        btn.textContent = 'Точно удалить? Журнал уйдёт в архив';
        return;
      }
      finishedAction('delete');
    });

    // Клики по карточкам
    $('#unknownsGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.unknown-card');
      if (!card) return;
      const row = unknowns.find((r) => String(r.id) === String(card.dataset.unknownId));
      if (!row) return;
      if (e.target.closest('[data-action="brew"]')) return openUnknownBrew(row);
      if (e.target.closest('[data-action="identify"]')) return openIdentify(row);
      if (e.target.closest('[data-action="journal"]')) return openUnknownJournal(row);
    });
  }

  await reloadUnknowns();
  renderUnknowns();
}