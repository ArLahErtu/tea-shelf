// ============================================================
// common.js — инициализация общих блоков на всех страницах
// Неделя 4: ссылка обратной связи,
// аналитика — Яндекс Метрика (вместо PostHog: не работает в РФ).
// БЛОК 2 (этап 3): убрано дублирование уведомлений о модерации
// (теперь только в chatbot.js — красивое сообщение в чате).
// БЛОК 2.5: модалка количества инициализируется на ВСЕХ страницах —
// «Добавить чай» работает откуда угодно (чат, главная, каталог).
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
  initFeedbackLink();      // ссылка на Google Form в футере
  // УВЕДОМЛЕНИЯ О МОДЕРАЦИИ убраны отсюда: теперь их шлёт chatbot.js
  // при первом открытии чата (красивое сообщение с кнопкой
  // «Добавить на полку», без спама тостами на всех страницах).

  // Esc закрывает любую открытую модалку
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.overlay.show').forEach(closeOverlay);
    }
  });
}

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
initAnalytics();

// ---------- Обратная связь: ссылка в футере ----------
function initFeedbackLink() {
  if (!FEEDBACK_URL) return;
  const wrap = document.querySelector('footer .wrap');
  if (!wrap) return;
  const a = document.createElement('a');
  a.href = FEEDBACK_URL;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'Обратная связь';
  a.style.textDecoration = 'underline';
  wrap.appendChild(a);
}