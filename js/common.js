// ============================================================
// common.js — инициализация общих блоков на всех страницах
// Аналитика: Яндекс Метрика загружается ТОЛЬКО после согласия
// в куки-плашке (честный гейт: «Отклонить» — метрики нет совсем).
// Обратная связь: ссылка в футере уже есть в разметке
// (data-footer-feedback), дубли не создаём.
// ============================================================
import { initDbStatus } from './supabaseClient.js';
import { initAuth } from './auth.js';
import { initChatbot } from './chatbot.js';
import { initAmountModal } from './amountModal.js';
import { $, closeOverlay, $$ } from './ui.js';
import { FEEDBACK_URL } from './config.js';
import { initGate } from './gate.js';

export async function initCommon() {
  initDbStatus();
  await initAuth();
  initGate();
  initAmountModal();
  initChatbot();
  initChatTriggers();
  initBrewFab();
  initBurger();
  initFeedbackLink();
  registerSW();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.overlay.show').forEach(closeOverlay);
    }
  });
}

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

function initChatTriggers() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open-chat]');
    if (!t) return;
    e.preventDefault();
    document.getElementById('chatbotToggle')?.click();
  });
}

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
  if (!btn || !nav) return;

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

function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[sw] register failed', err);
      });
    });
  }
}