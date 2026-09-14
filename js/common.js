// ============================================================
// common.js — инициализация общих блоков на всех страницах.
// Каждый блок обёрнут в safe(): падение одного блока
// (например, чатбота на холодной БД) не убивает остальные,
// а имя упавшего печатается в Console для диагностики.
// ============================================================
import { initDbStatus } from './supabaseClient.js';
import { initAuth } from './auth.js';
import { initChatbot } from './chatbot.js';
import { initAmountModal } from './amountModal.js';
import { $, closeOverlay, $$ } from './ui.js';
import { FEEDBACK_URL } from './config.js';
import { initGate } from './gate.js';

// защита от двойного вызова initCommon() на страницах,
// где её вызывают и page-скрипт, и inline-модуль
let commonStarted = false;

export async function initCommon() {
  if (commonStarted) return;
  commonStarted = true;

  const safe = (name, fn) => {
    try {
      fn();
    } catch (e) {
      console.warn('[common] блок "' + name + '" не инициализировался:', e);
    }
  };

  // бургер и FAB не зависят от авторизации — вешаем ПЕРВЫМИ
  safe('burger', initBurger);
  safe('brewFab', initBrewFab);
  safe('chatTriggers', initChatTriggers);
  safe('dbStatus', initDbStatus);

  try {
    await initAuth();
  } catch (e) {
    console.warn('[common] блок "auth" не инициализировался:', e);
  }

  safe('gate', initGate);
  safe('amount', initAmountModal);
  safe('chatbot', initChatbot);
  safe('feedback', initFeedbackLink);
  registerSW();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.overlay.show').forEach(closeOverlay);
    }
  });
}

// ---------- Обратная связь: страховка, если ссылки нет в разметке ----------
function initFeedbackLink() {
  if (!FEEDBACK_URL) return;
  if (document.querySelector('[data-footer-feedback]')) return;
  const wrap = document.querySelector('footer .wrap');
  if (!wrap) return;
  const a = document.createElement('a');
  a.href = FEEDBACK_URL;
  a.target = '_blank';
  a.rel = 'noopener';
  a.setAttribute('data-footer-feedback', '');
  a.textContent = 'Обратная связь';
  a.style.textDecoration = 'underline';
  wrap.appendChild(a);
}

// ---------- Триггеры чат-помощника (шапка + таб-бар) ----------
function initChatTriggers() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open-chat]');
    if (!t) return;
    e.preventDefault();
    document.getElementById('chatbotToggle')?.click();
  });
}

// ---------- FAB «Заварил» в нижнем таб-баре ----------
function initBrewFab() {
  const fab = document.getElementById('brewFab');
  if (!fab) return;
  fab.addEventListener('click', () => {
    if (typeof window.teaShelfBrewChoose === 'function') {
      window.teaShelfBrewChoose();
    } else {
      window.location.href = 'shelf.html#brew';
    }
  });
}

// ---------- бургер-меню (мобильные страницы без таб-бара) ----------
function initBurger() {
  const btn = document.getElementById('burgerBtn');
  const nav = document.getElementById('mainNav');
  if (!btn || !nav) {
    console.warn('[common] бургер: не найдены #burgerBtn или #mainNav');
    return;
  }

  const close = () => {
    nav.classList.remove('open');
    btn.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  };

  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
  });

  nav.addEventListener('click', (e) => {
    if (e.target.closest('a, button')) close();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.topbar')) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

// ---------- Service Worker ----------
function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[sw] register failed', err);
      });
    });
  }
}