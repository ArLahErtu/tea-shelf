// ============================================================
// amountModal.js — модалка количества и единиц измерения
// mode:
//   'add'     — новое добавление (виден порог «мало», единица выбирается)
//   'restock' — пополнение запаса (добавка к текущему остатку)
//   'set'     — точная установка остатка
// Блок 2: добавлен режим 'set', единица фиксируется для существующих строк.
// ============================================================
import { $, $$, openOverlay, closeOverlay, wireOverlay } from './ui.js';

let onSubmitCb = null;
let currentMode = 'add';

export function initAmountModal() {
  const ov = $('#amountOverlay');
  if (!ov) return;
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
  const ov = $('#amountOverlay');
  if (!ov) { console.warn('amountOverlay не найден в DOM'); return; }
  currentMode = mode;
  onSubmitCb = onSubmit;

  const titles  = { add: 'Добавить на полку', restock: 'Пополнить запас', set: 'Изменить количество' };
  const submits = { add: 'Добавить', restock: 'Пополнить', set: 'Сохранить' };

  $('#amountTitle').textContent = titles[mode] || titles.add;
  $('#amountTeaName').textContent = teaName;
  $('#amountSubmit').textContent = submits[mode] || submits.add;
  $('#amountThresholdField').classList.toggle('hidden', mode !== 'add');

  // Значение по умолчанию: add → 100, restock → 50, set → текущий остаток
  $('#amountValue').value = amount ?? (mode === 'restock' ? 50 : 100);

  const unitSel = $('#amountUnitSel');
  unitSel.value = unit || 'g';
  unitSel.disabled = mode !== 'add'; // единица существующей строки не меняется

  $('#amountThreshold').value = threshold ?? 20;
  $('#amountPresets').classList.toggle('hidden', (unitSel.value || 'g') !== 'g');
  $$('#amountPresets .preset').forEach((p) =>
    p.classList.toggle('sel', p.dataset.amount === String($('#amountValue').value)));

  openOverlay(ov);
  setTimeout(() => $('#amountValue').focus(), 50);
}