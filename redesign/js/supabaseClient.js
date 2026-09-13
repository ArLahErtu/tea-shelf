// ============================================================
// supabaseClient.js — клиент Supabase
// CDN: jsDelivr (стабильно работает в РФ, в отличие от esm.sh)
// ============================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let client = null;
let configured = false;

export function isConfigured() {
  return configured;
}

export function getSupabaseClient() {
  if (!client && SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
        global: {
          headers: { 'Content-Type': 'application/json' },
        },
      });
      configured = true;
      console.log('[Supabase] клиент инициализирован через jsDelivr');
    } catch (e) {
      console.error('[Supabase] ошибка инициализации:', e.message);
      configured = false;
    }
  }
  return client;
}

export const supabase = getSupabaseClient();

// Индикатор статуса БД (скрыт в CSS .db-chip{display:none})
export function initDbStatus() {
  const chip = document.getElementById('dbStatus');
  if (!chip) return;

  const check = async () => {
    if (!configured) {
      chip.textContent = 'БД: не подключено';
      chip.style.background = '#f44336';
      return;
    }
    try {
      const { error } = await supabase.from('tea_catalog').select('id').limit(1);
      if (error) throw error;
      chip.textContent = 'БД: OK';
      chip.style.background = '#4caf50';
    } catch (e) {
      chip.textContent = 'БД: ошибка';
      chip.style.background = '#f44336';
    }
  };

  check();
  setInterval(check, 30000);
}
