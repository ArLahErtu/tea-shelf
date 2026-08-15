// ============================================================
// supabaseClient.js — клиент Supabase + статус подключения
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TABLES } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function isConfigured() {
  return (
    !SUPABASE_URL.includes('YOUR_PROJECT') &&
    !SUPABASE_ANON_KEY.includes('YOUR_ANON')
  );
}

function setChip(cls, text) {
  const chip = document.getElementById('dbStatus');
  if (!chip) return;
  chip.className = 'db-chip ' + cls;
  chip.innerHTML = '<i aria-hidden="true"></i>' + text;
}

// Вешается на все страницы: зелёный «ок» или янтарный «демо»
export async function initDbStatus() {
  if (!isConfigured()) {
    setChip('demo', 'ключи не заданы');
    return;
  }
  try {
    const { error } = await supabase
      .from(TABLES.catalog)
      .select('id', { count: 'exact', head: true });
    if (error) throw error;
    setChip('ok', 'база подключена');
  } catch {
    setChip('demo', 'нет соединения');
  }
}