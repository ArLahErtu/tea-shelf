// ============================================================
// common.js — инициализация общих блоков на всех страницах
// Неделя 4, Блок D: уведомление о модерации при входе.
// Неделя 4, Блок E: PostHog — место для сниппета из дашборда.
// Неделя 4, Блок F: ссылка «Обратная связь» в футере.
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
  initAnalytics();         // PostHog (если вставлен сниппет)
  initFeedbackLink();      // ссылка на Google Form в футере
  notifyModeration();      // тост об одобренных заявках

  // Esc закрывает любую открытую модалку
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.overlay.show').forEach(closeOverlay);
    }
  });
}

// ============================================================
// Аналитика PostHog
// ------------------------------------------------------------
// 1) Зарегистрируйся на posthog.com и создай проект.
// 2) Project Settings → Web snippet → скопируй JS МЕЖДУ тегами
//    <script> и </script>.
// 3) Вставь его целиком между маркерами ниже.
// Сниппет сам создаст window.posthog и начнёт грузить SDK;
// все вызовы trackEvent() до загрузки попадут в очередь.
// Пока маркеры пустые — аналитика просто отключена.
// ============================================================
function initAnalytics() {
  // >>> POSTHOG SNIPPET START — вставь сюда код из дашборда <<<

  // >>> POSTHOG SNIPPET END <<<
}

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
// Запоминаем id чаёв пользователя, которые он уже видел
// опубликованными. Чай, перешедший pending → published,
// попадает в тост при следующем входе.
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