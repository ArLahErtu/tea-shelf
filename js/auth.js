// ============================================================
// auth.js — вход, регистрация, выход, состояние шапки
// ============================================================
import { supabase, isConfigured } from './supabaseClient.js';
import { $, openOverlay, closeOverlay, wireOverlay, showToast, setInvalid, isValidEmail, escapeHtml } from './ui.js';
import { SHOW_DEMO_ACCOUNTS } from './config.js';

let currentUser = null;
const listeners = [];

export const getUser = () => currentUser;
export function onAuthChange(fn) { listeners.push(fn); }
function emit() { listeners.forEach((fn) => fn(currentUser)); }

export function openAuth() {
  const ov = $('#authOverlay');
  if (ov) openOverlay(ov);
}

async function refreshUser() {
  if (!isConfigured()) { currentUser = null; renderState(); emit(); return; }
  const { data } = await supabase.auth.getSession();
  currentUser = data.session?.user ?? null;
  renderState();
  emit();
}

function renderState() {
  const openBtn = $('#authOpen');
  const userArea = $('#userArea');
  if (!openBtn || !userArea) return;

  if (currentUser) {
    openBtn.classList.add('hidden');
    userArea.classList.remove('hidden');

    const email = currentUser.email || '';
    const name = currentUser.user_metadata?.name || email;
    const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

    $('#userEmail').textContent = email;
    $('#avatarBtn').textContent = initials || '?';
  } else {
    openBtn.classList.remove('hidden');
    userArea.classList.add('hidden');
    $('#userMenu')?.classList.add('hidden');
  }
}

export async function initAuth() {
  const overlay   = $('#authOverlay');
  const form      = $('#authForm');
  const tabLogin  = $('#tabLogin');
  const tabReg    = $('#tabRegister');
  const demo      = $('#demoAccounts');

  if (demo) demo.classList.toggle('hidden', !SHOW_DEMO_ACCOUNTS);
  if (overlay) wireOverlay(overlay);

  let mode = 'login';

  function setMode(m) {
    mode = m;
    tabLogin.classList.toggle('active', m === 'login');
    tabReg.classList.toggle('active', m === 'register');
    $('#fieldName').classList.toggle('hidden', m === 'login');
    $('#authTitle').textContent = m === 'login' ? 'Вход' : 'Регистрация';
    $('#authSubmit').textContent = m === 'login' ? 'Войти' : 'Создать аккаунт';
    $('#authPassword').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    // Ошибку скрываем только при ПЕРЕКЛЮЧЕНИИ табов, не в finally
    $('#authError').classList.remove('show');
  }

  tabLogin?.addEventListener('click', () => setMode('login'));
  tabReg?.addEventListener('click', () => setMode('register'));

  $('#authClose')?.addEventListener('click', () => closeOverlay(overlay));
  $('#authOpen')?.addEventListener('click', () => openOverlay(overlay));

  // Любая кнопка с data-auth-required требует входа
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-auth-required]');
    if (el && !currentUser) {
      e.preventDefault();
      e.stopImmediatePropagation();
      showToast('Сначала войдите', 'warn');
      openOverlay(overlay);
    }
  });

  // Меню пользователя
  const avatarBtn = $('#avatarBtn');
  const userMenu  = $('#userMenu');
  avatarBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    userMenu.classList.toggle('hidden');
    avatarBtn.setAttribute('aria-expanded', String(!userMenu.classList.contains('hidden')));
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#userArea')) userMenu?.classList.add('hidden');
  });

  $('#logoutBtn')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    showToast('Вы вышли из аккаунта');
  });

  // Сабмит формы
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#authEmail').value;
    const pass  = $('#authPassword').value;
    const name  = $('#authName').value.trim();

    let ok = true;
    ok = setInvalid($('#fieldEmail'), !isValidEmail(email)) && ok;
    ok = setInvalid($('#fieldPassword'), pass.length < 6) && ok;
    if (mode === 'register') ok = setInvalid($('#fieldName'), !name) && ok;
    if (!ok) return;

    $('#authError').classList.remove('show');
    const btn = $('#authSubmit');
    btn.disabled = true;
    btn.textContent = 'Секунду…';

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
        closeOverlay(overlay);
        showToast('С возвращением!');
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password: pass,
          options: { data: { name } },
        });
        if (error) throw error;
        closeOverlay(overlay);
        showToast(data.session
          ? 'Аккаунт создан. Добро пожаловать!'
          : 'Аккаунт создан. Подтвердите email по ссылке.');
      }
      form.reset();
    } catch (err) {
      const box = $('#authError');
      box.textContent = err.message || 'Не удалось выполнить операцию. Попробуйте ещё раз.';
      box.classList.add('show');
    } finally {
      btn.disabled = false;
      // ФИКС: не вызываем setMode() — она скрывает ошибку.
      // Просто возвращаем текст кнопки.
      btn.textContent = mode === 'login' ? 'Войти' : 'Создать аккаунт';
    }
  });

  supabase.auth.onAuthStateChange(() => { refreshUser(); });
  await refreshUser();
}