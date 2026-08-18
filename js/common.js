// ============================================================
// common.js — инициализация общих блоков на всех страницах
// Неделя 4: уведомление о модерации, ссылка обратной связи,
// аналитика — Яндекс Метрика (вместо PostHog: не работает в РФ).
// ============================================================
import { initDbStatus, supabase } from './supabaseClient.js';
import { initAuth, getUser } from './auth.js';
import { initChatbot } from './chatbot.js';
import { closeOverlay, $$, showToast } from './ui.js';
import { TABLES, FEEDBACK_URL } from './config.js';

export async function initCommon() {
  initDbStatus();          // чип статуса БД (скрыт в CSS)
  await initAuth();        // шапка + модалка входа
  initChatbot();           // FAB + окно бота
  initFeedbackLink();      // ссылка на Google Form в футере
  notifyModeration();      // тост об одобренных заявках

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

// ---------- Уведомление о модерации ----------
async function notifyModeration() {
  const user = getUser();
  if (!user) return;

  try {
    const { data, error } = await supabase
      .from(TABLES.catalog)
      .select('id, name, status')
      .eq('author_id', user.id);
    if (error || !data?.length) return;

    const published = data.filter((t) => t.status === 'published');
    if (!published.length) return;

    const seen = JSON.parse(localStorage.getItem('seenPublishedIds') || '[]');
    const fresh = published.filter((t) => !seen.includes(t.id));

    if (fresh.length === 1) {
      showToast(`🎉 Ваш чай «${fresh[0].name}» одобрен и опубликован в каталоге!`);
    } else if (fresh.length > 1) {
      showToast(`🎉 Одобрено ${fresh.length} ваших чая — они уже в каталоге!`);
    }

    localStorage.setItem(
      'seenPublishedIds',
      JSON.stringify([...new Set([...seen, ...published.map((t) => t.id)])]),
    );
  } catch (e) {
    console.warn('[moderation notify]', e?.message || e);
  }
}