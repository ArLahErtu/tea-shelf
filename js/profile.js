// ============================================================
// profile.js — страница профиля: аватар, смена пароля и почты,
// удаление аккаунта (RPC delete_account).
// ============================================================
import { initCommon } from './common.js';
import { supabase } from './supabaseClient.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { $, showToast, setInvalid, isValidEmail, askConfirm } from './ui.js';
import { getUser, onAuthChange, refreshUserAvatar } from './auth.js';

let profile = null;

const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', avif: 'image/avif', gif: 'image/gif',
};

// ---------- Рендер ----------
async function render() {
  const user = getUser();

  if (!user) {
    $('#profileGuest')?.classList.remove('hidden');
    $('#profileContent')?.classList.add('hidden');
    return;
  }

  $('#profileGuest')?.classList.add('hidden');
  $('#profileContent')?.classList.remove('hidden');

  $('#profileEmail').textContent = user.email || '—';
  $('#profileSince').textContent = user.created_at
    ? 'С нами с ' + new Date(user.created_at).toLocaleDateString('ru-RU')
    : '';

  const { data } = await supabase.from('profiles')
    .select('*').eq('user_id', user.id).maybeSingle();

  if (data) {
    profile = data;
  } else {
    // upsert защищает от ошибки 409, если строка уже существует
    await supabase.from('profiles')
      .upsert({ user_id: user.id }, { onConflict: 'user_id' });
    const { data: created } = await supabase.from('profiles')
      .select('*').eq('user_id', user.id).maybeSingle();
    profile = created || null;
  }

  renderAvatar();
}

function renderAvatar() {
  const box = $('#profileAvatar');
  if (!box) return;
  const user = getUser();

  if (profile?.avatar_url) {
    box.innerHTML = `<img src="${profile.avatar_url}" alt="Фото профиля">`;
    return;
  }

  const email = user?.email || '';
  const initials = (email.split('@')[0] || '').slice(0, 2).toUpperCase();
  box.textContent = initials || '?';
}

// ---------- Аватар ----------
async function onAvatarFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const user = getUser();
  if (!user) return;

  const ext = file.name.split('.').pop().toLowerCase();
  const mime = file.type || MIME_BY_EXT[ext] || 'image/jpeg';
  const path = `${user.id}/avatar-${Date.now()}.${ext}`;
  const url = `${SUPABASE_URL}/storage/v1/object/user-avatars/${path}`;

  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
      'Content-Type': mime,
      'x-upsert': 'true',
      'cache-control': 'public, max-age=3600',
    },
    body: file,
  });

  if (!res.ok) {
    let detail = `${res.status}`;
    try { detail += ' ' + (await res.text()); } catch (err) { /* ignore */ }
    return showToast('Ошибка загрузки фото: ' + detail, 'warn');
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/user-avatars/${path}`;
  const { error } = await supabase.from('profiles')
    .upsert({
      user_id: user.id,
      avatar_url: publicUrl,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  if (error) return showToast('Ошибка сохранения: ' + error.message, 'warn');

  profile = { ...(profile || { user_id: user.id }), avatar_url: publicUrl };
  renderAvatar();
  refreshUserAvatar();
  showToast('Фото профиля обновлено');
}

// ---------- Смена пароля ----------
async function onPasswordSubmit(e) {
  e.preventDefault();
  const user = getUser();
  if (!user) return;

  const cur = $('#curPass').value;
  const next = $('#newPass').value;
  const rep = $('#repeatPass').value;

  let ok = true;
  ok = setInvalid($('#curPass').closest('.field'), !cur) && ok;
  ok = setInvalid($('#newPass').closest('.field'), next.length < 6) && ok;
  ok = setInvalid($('#repeatPass').closest('.field'), !rep || rep !== next) && ok;
  if (!ok) return;

  const { error: loginErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: cur,
  });
  if (loginErr) return showToast('Неверный текущий пароль', 'warn');

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return showToast('Ошибка: ' + error.message, 'warn');

  e.target.reset();
  showToast('Пароль обновлён');
}

// ---------- Смена почты ----------
async function onEmailSubmit(e) {
  e.preventDefault();
  const user = getUser();
  if (!user) return;

  const email = $('#newEmail').value.trim();
  const ok = setInvalid($('#newEmail').closest('.field'), !isValidEmail(email));
  if (!ok) return;
  if (email === user.email) return showToast('Это уже ваш текущий email', 'warn');

  const { error } = await supabase.auth.updateUser({ email });
  if (error) return showToast('Ошибка: ' + error.message, 'warn');

  e.target.reset();
  showToast('Письмо с подтверждением отправлено на новый адрес');
}

// ---------- Удаление аккаунта ----------
async function onDeleteAccount() {
  const first = await askConfirm({
    title: 'Удалить аккаунт',
    text: 'Вы уверены, что хотите удалить аккаунт? Все данные (полка, журналы, тизаны, заявки) будут стёрты.',
    okLabel: 'Продолжить',
  });
  if (!first) return;

  const second = await askConfirm({
    title: 'Последнее предупреждение',
    text: 'Действие необратимо. Восстановить аккаунт и данные будет невозможно. Удалить?',
    okLabel: 'Удалить навсегда',
  });
  if (!second) return;

  const { error } = await supabase.rpc('delete_account');
  if (error) return showToast('Ошибка удаления: ' + error.message, 'warn');

  try { await supabase.auth.signOut(); } catch (err) { /* сессия уже недействительна */ }
  showToast('Аккаунт и все данные удалены');
  setTimeout(() => { window.location.href = 'index.html'; }, 1200);
}

// ---------- Старт ----------
async function init() {
  await initCommon();

  $('#avatarInput')?.addEventListener('change', onAvatarFile);
  $('#passwordForm')?.addEventListener('submit', onPasswordSubmit);
  $('#emailForm')?.addEventListener('submit', onEmailSubmit);
  $('#deleteAccountBtn')?.addEventListener('click', onDeleteAccount);

  onAuthChange(() => render());
  await render();
}

init();