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

// ---------- Форма обратной связи в футере ----------
function initFooterFeedback() {
  const form = document.getElementById('footerFeedbackForm');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const name = (formData.get('name') || '').toString().trim();
    const email = (formData.get('email') || '').toString().trim();
    const message = (formData.get('message') || '').toString().trim();

    if (!name || !email || !message) {
      alert('Заполните все поля');
      return;
    }

    const subject = encodeURIComponent(`Обратная связь от ${name}`);
    const body = encodeURIComponent(`Имя: ${name}\nEmail: ${email}\n\nСообщение:\n${message}`);
    const mailto = `mailto:busyatv3@gmail.com?subject=${subject}&body=${body}`;

    window.location.href = mailto;
    form.reset();
  });
}

initFooterFeedback();

// ---------- Ссылка «Обратная связь» в футере ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-footer-feedback]');
  if (!el) return;
  e.preventDefault();
  if (typeof FEEDBACK_URL === 'string' && FEEDBACK_URL) {
    window.open(FEEDBACK_URL, '_blank', 'noopener');
  }
});