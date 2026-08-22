// ============================================================
// amountModal.js — модалка количества и единиц измерения
// mode:
//   'add'     — новое добавление (виден порог «мало», единица выбирается)
//   'restock' — пополнение запаса (добавка к текущему остатку)
//   'set'     — точная установка остатка (порог скрыт, единица фикс.)
//   'edit'    — редактирование позиции (порог + единица видны) — Блок Б
// БЛОК 2.5 (этап 3): модалка стала ГЛОБАЛЬНОЙ — если в HTML страницы
// нет разметки (например, главная), модуль вставляет её сам.
// Теперь «Добавь чай» работает с ЛЮБОЙ страницы — как и будет
// работать из будущего Telegram-бота (тот же insert в user_shelf).
// ============================================================
import { $, $$, openOverlay, closeOverlay, wireOverlay } from './ui.js';

let onSubmitCb = null;
let currentMode = 'add';
let wired = false; // защита от повторной навески слушателей

// ---------- Разметка (копия модалки из shelf.html/catalog.html) ----------
// Вставляется только на страницах, где её нет в HTML (главная).
const AMOUNT_OVERLAY_HTML = `
<div class="overlay" id="amountOverlay" hidden>
  <div class="modal narrow" role="dialog" aria-modal="true" aria-labelledby="amountTitle">
    <div class="modal-head">
      <h2 id="amountTitle">Добавить на полку</h2>
      <button class="icon-btn" id="amountClose" type="button" aria-label="Закрыть">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <p class="modal-sub" id="amountTeaName">—</p>

    <form id="amountForm" novalidate>
      <div class="row2">
        <div class="field">
          <label for="amountValue">Количество <span class="req">*</span></label>
          <input id="amountValue" type="number" min="1" step="1" value="100" inputmode="decimal" required>
          <p class="err">Укажите количество</p>
        </div>
        <div class="field">
          <label for="amountUnitSel">Единица</label>
          <select id="amountUnitSel">
            <option value="g">граммы</option>
            <option value="sachet">пакетики</option>
            <option value="pcs">упаковки</option>
          </select>
        </div>
      </div>

      <div class="presets" id="amountPresets">
        <button type="button" class="preset" data-amount="50">50</button>
        <button type="button" class="preset sel" data-amount="100">100</button>
        <button type="button" class="preset" data-amount="250">250</button>
      </div>

      <div class="field" id="amountThresholdField">
        <label for="amountThreshold">Порог «мало»</label>
        <input id="amountThreshold" type="number" min="0" step="1" value="20">
        <p class="hint">Когда остаток дойдёт до этого значения, чай попадёт в «Что докупить».</p>
      </div>

      <div class="modal-foot">
        <button class="btn btn-ghost" type="button" id="amountCancel">Отмена</button>
        <button class="btn btn-primary" type="submit" id="amountSubmit">Добавить</button>
      </div>
    </form>
  </div>
</div>
`;

function ensureAmountOverlay() {
  if ($('#amountOverlay')) return; // в catalog/shelf разметка уже есть в HTML
  document.body.insertAdjacentHTML('beforeend', AMOUNT_OVERLAY_HTML);
}

export function initAmountModal() {
  ensureAmountOverlay();
  const ov = $('#amountOverlay');
  if (!ov || wired) return; // уже инициализированы — не вешаем слушатели дважды
  wired = true;

  wireOverlay(ov);
  $('#amountClose')?.addEventListener('click', () => closeOverlay(ov));
  $('#amountCancel')?.addEventListener('click', () => closeOverlay(ov));

  $('#amountPresets')?.addEventListener('click', (e) => {
    const b = e.target.closest('.preset');
    if (!b) return;
    $$('#amountPresets .preset').forEach((p) => p.classList.remove('sel'));
    b.classList.add('sel');
    $('#amountValue').value = b.dataset.amount;
  });

  // пресеты в граммах актуальны только для unit = g
  $('#amountUnitSel')?.addEventListener('change', (e) => {
    $('#amountPresets').classList.toggle('hidden', e.target.value !== 'g');
  });

  $('#amountForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const field = $('#amountValue').closest('.field');
    const val = Number($('#amountValue').value);
    if (!val || val <= 0 || !Number.isFinite(val)) {
      field.classList.add('invalid');
      return;
    }
    field.classList.remove('invalid');
    const payload = {
      mode: currentMode,
      amount: val,
      unit: $('#amountUnitSel').value,
      threshold: Number($('#amountThreshold').value) || 0,
    };
    closeOverlay(ov);
    if (onSubmitCb) await onSubmitCb(payload);
    onSubmitCb = null;
  });
}

export function openAmountModal({
  mode = 'add',
  teaName = '',
  unit = 'g',
  amount = null,
  threshold = null,
  onSubmit,
}) {
  ensureAmountOverlay(); // страховка: модалка существует всегда
  const ov = $('#amountOverlay');
  if (!ov) { console.warn('amountOverlay не найден в DOM'); return; }
  currentMode = mode;
  onSubmitCb = onSubmit;

  // Блок Б: добавлен режим 'edit'
  const titles  = { add: 'Добавить на полку', restock: 'Пополнить запас', set: 'Изменить количество', edit: 'Изменить' };
  const submits = { add: 'Добавить', restock: 'Пополнить', set: 'Сохранить', edit: 'Сохранить' };

  $('#amountTitle').textContent = titles[mode] || titles.add;
  $('#amountTeaName').textContent = teaName;
  $('#amountSubmit').textContent = submits[mode] || submits.add;

  // Порог виден в 'add' и 'edit' (Блок Б)
  $('#amountThresholdField').classList.toggle('hidden', mode !== 'add' && mode !== 'edit');

  // Значение по умолчанию: add → 100, restock → 50, set/edit → текущий остаток
  $('#amountValue').value = amount ?? (mode === 'restock' ? 50 : 100);

  const unitSel = $('#amountUnitSel');
  unitSel.value = unit || 'g';
  // Единица редактируема в 'add' и 'edit' (Блок Б)
  unitSel.disabled = mode !== 'add' && mode !== 'edit';

  $('#amountThreshold').value = threshold ?? 20;
  $('#amountPresets').classList.toggle('hidden', (unitSel.value || 'g') !== 'g');
  $$('#amountPresets .preset').forEach((p) =>
    p.classList.toggle('sel', p.dataset.amount === String($('#amountValue').value)));

  openOverlay(ov);
  setTimeout(() => $('#amountValue').focus(), 50);
}