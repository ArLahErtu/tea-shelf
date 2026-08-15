// ============================================================
// config.js — конфигурация проекта
// Ключи: Supabase Dashboard → Settings → API
// ============================================================

export const SUPABASE_URL = 'https://zpcajyjrrzksrymygeck.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpwY2FqeWpycnprc3J5bXlnZWNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1MzYzNjcsImV4cCI6MjEwMjExMjM2N30.QcB6RbcGBT6DX0DPpkVMVwSgclCX-Ioebt1XQVfTFek';

// Показывать тестовые аккаунты в модалке входа.
// ПЕРЕД ПУБЛИЧНЫМ ЗАПУСКОМ ПОСТАВИТЬ false!
export const SHOW_DEMO_ACCOUNTS = true;

// Имена таблиц — поправь, если у тебя другие
export const TABLES = {
  catalog:  'tea_catalog',   // id, name, type, origin, description,
                             // temp_c, time_min, dose, tags, popularity,
                             // photo_url, status, created_by, sort_order
  shelf:    'user_shelf',    // id, user_id, tea_id, amount, unit, low_threshold, favorite
  journal:  'brew_journal',  // id, user_id, tea_id, amount, unit, rating, note, created_at
  wishlist: 'wishlist',      // user_id, tea_id
};