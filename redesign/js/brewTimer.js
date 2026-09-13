// ============================================================
// brewTimer.js — таймер заваривания (редизайн v2).
// Поток: кнопка «Заварил» → окно-вопрос «Включить таймер?»
//   НЕТ  → сразу окно заполнения журнала (brewOverlay);
//   ДА   → таймер двух режимов (переключение слайдером):
//          1) «Проливы» (гунфу): время первого пролива берётся
//             из карточки чая, каждый следующий пролив длиннее
//             (+15 сек для секунд, +30 сек для минут);
//          2) «Настоем»: обычный таймер на 2–4 минуты.
//   Кнопка «В журнал» закрывает таймер и открывает окно журнала.
// ============================================================
import { $, openOverlay, closeOverlay, wireOverlay, showToast, escapeHtml } from './ui.js';

let offerOv = null;
let timerOv = null;
let tick = null;
let state = null;   // { tea, mode, steep, total, left, running, onJournal }

// ---------- разбор строки времени из карточки («20–30 сек», «3–5 мин») ----------
export function parseTime(str) {
  const m = String(str || '').match(/(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*(\d+(?:[.,]\d+)?))?\s*(сек|мин|минут)/i);
  if (!m) return null;
  const lo = parseFloat(m[1].replace(',', '.'));
  const hi = m[2] ? parseFloat(m[2].replace(',', '.')) : lo;
  const unit = m[3].toLowerCase().startsWith('сек') ? 'sec' : 'min';
  return { lo, hi, unit };
}

// первый пролив по гунфу — верхняя граница из карточки
function gongfuFirstSec(tea) {
  const t = parseTime(tea?.time);
  if (!t) return 30;
  return t.unit === 'min' ? Math.round(t.hi * 60) : Math.round(t.hi);
}
// прирост каждого следующего пролива
function gongfuStepSec(tea) {
  const t = parseTime(tea?.time);
  return t && t.unit === 'min' ? 30 : 15;
}
// настой: минуты из карточки, иначе дефолт 3 минуты
function infusionSec(tea) {
  const t = parseTime(tea?.time);
  if (t && t.unit === 'min') return Math.round(t.hi * 60);
  return 180;
}
function maxSteeps(tea) {
  const m = String(tea?.steeps || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

const fmt = (s) => {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ---------- разметка ----------
function ensureOverlays() {
  if (offerOv && timerOv) return;

  offerOv = document.createElement('div');
  offerOv.className = 'overlay';
  offerOv.id = 'brewTimerOffer';
  offerOv.hidden = true;
  offerOv.innerHTML = `
    <div class="modal narrow timer-offer" role="dialog" aria-modal="true" aria-labelledby="btOfferTitle">
      <div class="modal-head">
        <h2 id="btOfferTitle">Заварить чай</h2>
        <button class="icon-btn" type="button" data-bt="offer-close" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <p class="modal-sub" id="btOfferTea">—</p>
      <p>Включить таймер заваривания?</p>
      <p class="hint">Проливы по гунфу ча подсказывают момент слива, а режим «настоем»
         просто отсчитает пару минут. Без таймера сразу откроется окно журнала.</p>
      <div class="modal-foot">
        <button class="btn btn-ghost" type="button" data-bt="offer-no">Нет, сразу в журнал</button>
        <button class="btn btn-primary" type="button" data-bt="offer-yes">Да, с таймером</button>
      </div>
    </div>`;
  document.body.appendChild(offerOv);
  wireOverlay(offerOv);

  timerOv = document.createElement('div');
  timerOv.className = 'overlay';
  timerOv.id = 'brewTimerOverlay';
  timerOv.hidden = true;
  timerOv.innerHTML = `
    <div class="modal narrow" role="dialog" aria-modal="true" aria-labelledby="btTitle">
      <div class="modal-head">
        <h2 id="btTitle">Таймер заваривания</h2>
        <button class="icon-btn" type="button" data-bt="close" aria-label="Закрыть таймер">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <p class="modal-sub" id="btTea">—</p>

      <div class="tswitch" id="btSwitch" data-mode="gongfu" role="group" aria-label="Режим таймера">
        <i aria-hidden="true"></i>
        <button type="button" data-mode="gongfu" aria-pressed="true">Проливы · гунфу</button>
        <button type="button" data-mode="infusion" aria-pressed="false">Настоем</button>
      </div>

      <div class="timer-face" id="btFace">
        <div class="steep" id="btSteep">Пролив 1</div>
        <div class="clock" id="btClock" role="timer" aria-live="off">0:30</div>
        <div class="temp" id="btTemp"></div>
        <div class="timer-prog" aria-hidden="true"><i id="btProg"></i></div>
      </div>

      <div class="timer-presets hidden" id="btPresets" aria-label="Быстрая длительность настоя">
        <button class="preset" type="button" data-sec="120">2 мин</button>
        <button class="preset sel" type="button" data-sec="180">3 мин</button>
        <button class="preset" type="button" data-sec="240">4 мин</button>
      </div>

      <div class="timer-ctrl">
        <button class="btn btn-outline btn-sm" type="button" data-bt="plus" aria-label="Добавить 15 секунд">+15 сек</button>
        <button class="btn btn-primary" type="button" data-bt="start">Старт</button>
        <button class="btn btn-ghost btn-sm" type="button" data-bt="reset">Сброс</button>
      </div>
      <div class="timer-ctrl">
        <button class="btn btn-outline hidden" type="button" data-bt="next-steep">Следующий пролив</button>
      </div>
      <div class="modal-foot">
        <button class="btn btn-green" type="button" data-bt="journal">Готово — в журнал</button>
      </div>
      <p class="timer-note" id="btNote"></p>
    </div>`;
  document.body.appendChild(timerOv);
  wireOverlay(timerOv);

  // Esc/клик по фону закрывают оверлей из общего обработчика — гасим тик
  new MutationObserver(() => {
    if (!timerOv.classList.contains('show')) stopTick();
  }).observe(timerOv, { attributes: true, attributeFilter: ['class'] });

  timerOv.addEventListener('click', onTimerClick);
  offerOv.addEventListener('click', onOfferClick);
}

// ---------- звук и вибрация окончания ----------
function ding() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(.2, ctx.currentTime + .02);
    g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .9);
    o.start(); o.stop(ctx.currentTime + 1);
  } catch (e) { /* без звука не страшно */ }
  try { navigator.vibrate?.([180, 90, 180]); } catch (e) { /* noop */ }
}

// ---------- отрисовка ----------
function render() {
  if (!state) return;
  $('#btTea').textContent = state.tea?.name || 'Чай';
  $('#btSwitch').dataset.mode = state.mode;
  $('#btSwitch [data-mode="gongfu"]').setAttribute('aria-pressed', String(state.mode === 'gongfu'));
  $('#btSwitch [data-mode="infusion"]').setAttribute('aria-pressed', String(state.mode === 'infusion'));
  $('#btPresets').classList.toggle('hidden', state.mode !== 'infusion');

  const max = maxSteeps(state.tea);
  $('#btSteep').textContent = state.mode === 'gongfu'
    ? `Пролив ${state.steep}${max ? ' из ' + max : ''}`
    : 'Настаиваем';
  $('#btClock').textContent = fmt(state.left);
  $('#btFace').classList.toggle('running', state.running);

  const temp = state.tea?.temp ? `вода ${state.tea.temp}` : '';
  const dose = state.tea?.grams ? ` · ${state.tea.grams} на чахай` : '';
  $('#btTemp').innerHTML = temp ? `<b>${escapeHtml(temp)}</b>${escapeHtml(dose)}` : '';

  $('#btProg').style.width = state.total
    ? `${Math.round((1 - state.left / state.total) * 100)}%`
    : '0%';

  const startBtn = timerOv.querySelector('[data-bt="start"]');
  startBtn.textContent = state.running ? 'Пауза' : (state.left < state.total ? 'Продолжить' : 'Старт');

  const nextBtn = timerOv.querySelector('[data-bt="next-steep"]');
  nextBtn.classList.toggle('hidden', !(state.mode === 'gongfu' && state.finished));

  $('#btNote').textContent = state.mode === 'gongfu'
    ? 'Правило проливов: каждый следующий на 15 сек длиннее предыдущего.'
    : 'Настаивайте под крышкой; когда надоест — просто нажмите «В журнал».';

  timerOv.querySelectorAll('#btPresets .preset').forEach((p) => {
    p.classList.toggle('sel', parseInt(p.dataset.sec, 10) === state.total && state.mode === 'infusion');
  });
}

function stopTick() { if (tick) { clearInterval(tick); tick = null; } }

function startTick() {
  stopTick();
  state.running = true;
  state.finished = false;
  tick = setInterval(() => {
    state.left -= 1;
    if (state.left <= 0) {
      state.left = 0;
      state.running = false;
      state.finished = true;
      stopTick();
      ding();
      $('#btFace').classList.add('timer-flash');
      setTimeout(() => $('#btFace')?.classList.remove('timer-flash'), 3200);
      showToast(state.mode === 'gongfu' ? 'Пролив готов — сливайте настой' : 'Настой готов');
    }
    render();
  }, 1000);
}

function setMode(mode) {
  stopTick();
  state.mode = mode;
  state.steep = 1;
  state.running = false;
  state.finished = false;
  state.total = mode === 'gongfu' ? gongfuFirstSec(state.tea) : infusionSec(state.tea);
  state.left = state.total;
  render();
}

// ---------- клики ----------
function onTimerClick(e) {
  const sw = e.target.closest('#btSwitch button[data-mode]');
  if (sw) { setMode(sw.dataset.mode); return; }

  const btn = e.target.closest('[data-bt]');
  if (!btn) return;
  const act = btn.dataset.bt;

  if (act === 'close') { stopTick(); closeOverlay(timerOv); return; }
  if (act === 'start') {
    if (state.running) { stopTick(); state.running = false; render(); }
    else startTick();
    return;
  }
  if (act === 'plus') { state.total += 15; state.left += 15; render(); return; }
  if (act === 'reset') { stopTick(); state.left = state.total; state.running = false; state.finished = false; render(); return; }
  if (act === 'next-steep') {
    state.steep += 1;
    state.total += gongfuStepSec(state.tea);
    state.left = state.total;
    state.finished = false;
    render();
    startTick();
    return;
  }
  if (act === 'journal') {
    stopTick();
    closeOverlay(timerOv);
    state.onJournal?.();
  }
}

function onOfferClick(e) {
  const btn = e.target.closest('[data-bt]');
  if (!btn) return;
  if (btn.dataset.bt === 'offer-close') { closeOverlay(offerOv); return; }
  if (btn.dataset.bt === 'offer-no') {
    closeOverlay(offerOv);
    state.onJournal?.();
    return;
  }
  if (btn.dataset.bt === 'offer-yes') {
    closeOverlay(offerOv);
    setMode('gongfu');
    openOverlay(timerOv);
  }
}

// ---------- входная точка ----------
export function offerBrewTimer(tea, onJournal) {
  ensureOverlays();
  state = { tea, mode: 'gongfu', steep: 1, total: 0, left: 0, running: false, finished: false, onJournal };
  $('#btOfferTea').textContent = tea?.name || 'Чай';
  openOverlay(offerOv);
}

// закрыть всё снаружи (например, при Esc из общего обработчика)
export function closeBrewTimer() {
  stopTick();
  if (timerOv?.classList.contains('show')) closeOverlay(timerOv);
  if (offerOv?.classList.contains('show')) closeOverlay(offerOv);
}
