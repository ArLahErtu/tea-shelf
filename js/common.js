// ============================================================
// common.js — инициализация общих блоков на всех страницах
// ============================================================
import { initDbStatus } from './supabaseClient.js';
import { initAuth } from './auth.js';
import { initChatbot } from './chatbot.js';
import { closeOverlay, $$ } from './ui.js';

export async function initCommon() {
  initDbStatus();          // чип «подключение… / база подключена»
  await initAuth();        // шапка + модалка входа
  initChatbot();           // FAB + окно бота

  // Esc закрывает любую открытую модалку
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.overlay.show').forEach(closeOverlay);
    }
  });
}