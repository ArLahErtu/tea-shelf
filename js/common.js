// ============================================================
// common.js — инициализация общих блоков на всех страницах
// Неделя 4, Блок D: уведомление о модерации — при входе
// проверяем, не одобрены ли заявки пользователя, и показываем
// тост за свежеопубликованные чаи (обещание из UI полки).
// ============================================================
import { initDbStatus, supabase } from './supabaseClient.js';
import { initAuth, getUser } from './auth.js';
import { initChatbot } from './chatbot.js';
import { closeOverlay, $$, showToast } from './ui.js';
import { TABLES } from './config.js';

export async function initCommon() {
  initDbStatus();          // чип «подключение… / база подключена» (скрыт в CSS)
  await initAuth();        // шапка + модалка входа
  initChatbot();           // FAB + окно бота
  notifyModeration();      // тост об одобренных заявках

  // Esc закрывает любую открытую модалку
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.overlay.show').forEach(closeOverlay);
    }
  });
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