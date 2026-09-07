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
import { closeOverlay, $$ } from './ui.js';
import { FEEDBACK_URL } from './config.js';

export async function initCommon() {
  initDbStatus();          // чип статуса БД (скрыт в CSS)
  await initAuth();        // шапка + модалка входа
  initAmountModal();       // модалка количества — теперь на каждой странице
  initChatbot();           // FAB + окно бота
  initFeedbackLink();      // страховка: ссылка обратной связи, если её нет в разметке
  registerSW();            // Регистрация Service Worker для PWA

  // Esc закрывает любую открытую модалку
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.overlay.show').forEach(closeOverlay);
    }
  });
}

// ============================================================
// Cookie-согласие и аналитика
// ============================================================
const COOKIE_CONSENT_KEY = 'tea_shelf_cookie_consent';

function initAnalytics() {
  // >>> METRIKA SNIPPET START <<<
  (function(m,e,t,r,i,k,a){
    m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
    m[i].l=1*new Date();
    for (var j = 0; j < document.scripts.length; j++) {
      if (document.scripts[j].src === r) { return; }
    }
    k=e.createElement(t),a=e.getElementsByTagName(t)[0],
    k.async=1,k.src=r,a.parentNode.insertBefore(k,a);
  })(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=111729275', 'ym');

  ym(111729275, 'init', {
    ssr:true, webvisor:true, clickmap:true, ecommerce:"dataLayer",
    referrer: document.referrer, url: location.href,
    accurateTrackBounce:true, trackLinks:true
  });
  // >>> METRIKA SNIPPET END <<<
}

function initCookieConsent() {
  const stored = localStorage.getItem(COOKIE_CONSENT_KEY);

  // Согласие дано ранее — метрика стартует сразу
  if (stored === 'yes') { initAnalytics(); return; }
  // Отказ — метрика НЕ загружается вообще, плашку не показываем
  if (stored === 'no') return;

  // Согласия ещё не было — показываем плашку
  const bar = document.createElement('div');
  bar.className = 'cookie-bar';
  bar.setAttribute('role', 'dialog');
  bar.setAttribute('aria-label', 'Согласие на использование cookie и аналитики');
  bar.innerHTML = `
    <div class="wrap cookie-bar-in">
      <p>Мы используем cookie и Яндекс.Метрику только после вашего согласия.
        Пока вы не нажали «Принять», метрика не загружается.
        <a href="privacy.html#cookies">Подробнее в политике</a>.</p>
      <div class="cookie-bar-btns">
        <button class="btn btn-primary btn-sm" type="button" data-cookie="accept">Принять</button>
        <button class="btn btn-outline btn-sm" type="button" data-cookie="decline">Отклонить</button>
      </div>
    </div>`;
  document.body.appendChild(bar);

  bar.querySelector('[data-cookie="accept"]').addEventListener('click', () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, 'yes');
    bar.remove();
    initAnalytics();
  });

  bar.querySelector('[data-cookie="decline"]').addEventListener('click', () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, 'no');
    bar.remove();
  });
}
initCookieConsent();

// ---------- Обратная связь: страховка, если ссылки нет в разметке ----------
function initFeedbackLink() {
  if (!FEEDBACK_URL) return;
  if (document.querySelector('[data-footer-feedback]')) return; // ссылка уже в футере
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

// ---------- Регистрация Service Worker (PWA) ----------
function registerSW() {
  if ('serviceWorker' in navigator) {
    // Регистрируем после загрузки страницы, чтобы не блокировать отрисовку интерфейса
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then((registration) => {
          console.log('[SW] Успешная регистрация, scope:', registration.scope);
        })
        .catch((error) => {
          console.warn('[SW] Ошибка регистрации:', error);
        });
    });
  }
}