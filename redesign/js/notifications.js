// ============================================================
// notifications.js — тумблеры уведомлений в профиле (редизайн v2).
// Хранилище: таблица user_notifications (user_id, email,
// telegram_chat_id). Почта — вкл/выкл; Telegram — запрос chat id.
// ============================================================
import { supabase, isConfigured } from './supabaseClient.js';
import { $, showToast } from './ui.js';
import { getUser } from './auth.js';

async function loadRow(userId) {
  const { data } = await supabase
    .from('user_notifications')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return data || null;
}

async function save(patch) {
  const user = getUser();
  const { error } = await supabase
    .from('user_notifications')
    .upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function initNotifications() {
  const em = $('#notifyEmailSwitch');
  const tg = $('#notifyTelegramSwitch');
  if (!em || !tg) return;

  const user = getUser();
  if (!user || !isConfigured()) {
    em.disabled = true; tg.disabled = true;
    return;
  }

  let row = null;
  try {
    row = await loadRow(user.id);
  } catch (e) {
    console.warn('[notifications]', e?.message || e);
    em.disabled = true; tg.disabled = true;
    return;
  }

  const paint = () => {
    em.classList.toggle('on', !!row?.email);
    em.setAttribute('aria-checked', String(!!row?.email));
    tg.classList.toggle('on', !!row?.telegram_chat_id);
    tg.setAttribute('aria-checked', String(!!row?.telegram_chat_id));
  };
  paint();

  em.addEventListener('click', async () => {
    const on = !row?.email;
    try {
      await save({ email: on ? user.email : null });
      row = { ...(row || { user_id: user.id }), email: on ? user.email : null };
      paint();
      showToast(on ? 'Уведомления на почту включены' : 'Уведомления на почту выключены');
    } catch (e) {
      showToast('Не удалось сохранить: ' + (e.message || 'ошибка'), 'warn');
    }
  });

  tg.addEventListener('click', async () => {
    if (row?.telegram_chat_id) {
      try {
        await save({ telegram_chat_id: null });
        row = { ...row, telegram_chat_id: null };
        paint();
        showToast('Уведомления в Telegram выключены');
      } catch (e) {
        showToast('Не удалось сохранить: ' + (e.message || 'ошибка'), 'warn');
      }
      return;
    }
    const chatId = window.prompt('Укажите chat id Telegram (число, например 123456789).\nУзнать его можно у бота @userinfobot.');
    if (!chatId || !chatId.trim()) return;
    try {
      await save({ telegram_chat_id: chatId.trim() });
      row = { ...(row || { user_id: user.id }), telegram_chat_id: chatId.trim() };
      paint();
      showToast('Уведомления в Telegram включены');
    } catch (e) {
      showToast('Не удалось сохранить: ' + (e.message || 'ошибка'), 'warn');
    }
  });
}
