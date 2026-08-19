// ============================================================
// auth.js — управление авторизацией + роли пользователей
// Блок 1: добавлена загрузка роли (admin/moderator/user)
// ============================================================
import { $, $$, showToast, openOverlay, closeOverlay, wireOverlay, setInvalid, isValidEmail, trackEvent } from './ui.js';
import { supabase, isConfigured } from './supabaseClient.js';
import { SHOW_DEMO_ACCOUNTS } from './config.js';

let currentUser = null;
let currentUserRole = 'user'; // Блок 1: роль пользователя
const listeners = [];

export const getUser = () => currentUser;
export const getUserRole = () => currentUserRole; // Блок 1
export const isModerator = () => ['admin', 'moderator'].includes(currentUserRole); // Блок 1
export const isAdmin = () => currentUserRole === 'admin'; // Блок 1

export function onAuthChange(fn) { listeners.push(fn); }
function emit() { listeners.forEach((fn) => fn(currentUser, currentUserRole)); } // Блок 1: передаём роль

async function refreshUser() {
  if (!isConfigured()) { 
    currentUser = null; 
    currentUserRole = 'user';
    renderState(); 
    emit(); 
    return; 
  }
  
  const { data } = await supabase.auth.getSession();
  currentUser = data.session?.user ?? null;
  
  // Блок 1: загружаем роль пользователя
  if (currentUser) {
    try {
      const { data: roleData, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', currentUser.id)
        .single();
      
      if (error) {
        console.warn('[auth] не удалось загрузить роль:', error.message);
        currentUserRole = 'user';
      } else {
        currentUserRole = roleData?.role || 'user';
      }
    } catch (e) {
      console.error('[auth] ошибка загрузки роли:', e);
      currentUserRole = 'user';
    }
  } else {
    currentUserRole = 'user';
  }
  
  renderState();
  emit();
}

function renderState() {
  const authBtn  = $('#authOpen');
  const userArea = $('#userArea');
  const email    = $('#userEmail');

  if (currentUser) {
    authBtn?.classList.add('hidden');
    userArea?.classList.remove('hidden');
    if (email) email.textContent = currentUser.email;
    
    // Блок 1: показываем роль в dropdown меню
    const roleBadge = $('#userRoleBadge');
    if (roleBadge) {
      const roleLabels = {
        admin: '👮 Администратор',
        moderator: '🛡️ Модератор',
        user: '👤 Пользователь'
      };
      roleBadge.textContent = roleLabels[currentUserRole] || roleLabels.user;
      roleBadge.classList.toggle('role-admin', currentUserRole === 'admin');
      roleBadge.classList.toggle('role-moderator', currentUserRole === 'moderator');
    }
    
    // Блок 1: показываем/скрываем кнопку модерации
    const modBtn = $('#openModerationBtn');
    if (modBtn) {
      modBtn.classList.toggle('hidden', !isModerator());
    }
  } else {
    authBtn?.classList.remove('hidden');
    userArea?.classList.add('hidden');
  }
}

// ============================================================
// Инициализация
// ============================================================
export async function initAuth() {
  const overlay   = $('#authOverlay');
  const form      = $('#authForm');
  const tabLogin  = $('#tabLogin');
  const tabReg    = $('#tabRegister');
  const demo      = $('#demoAccounts');

  if (demo) demo.classList.toggle('hidden', !SHOW_DEMO_ACCOUNTS);
  if (overlay) wireOverlay(overlay);

  injectConsent();

  document.addEventListener('click', (e) => {
    if (e.target.closest('#privacyOpen')) {
      e.preventDefault();
      openPrivacy();
    }
  });

  let mode = 'login';

  function setMode(m) {
    mode = m;
    tabLogin.classList.toggle('active', m === 'login');
    tabReg.classList.toggle('active', m === 'register');
    $('#fieldName').classList.toggle('hidden', m === 'login');
    $('#consentLine')?.classList.toggle('hidden', m === 'login');
    $('#authTitle').textContent = m === 'login' ? 'Вход' : 'Регистрация';
    $('#authSubmit').textContent = m === 'login' ? 'Войти' : 'Создать аккаунт';
    $('#authPassword').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    $('#authError').classList.remove('show');
  }

  tabLogin?.addEventListener('click', () => setMode('login'));
  tabReg?.addEventListener('click', () => setMode('register'));

  $('#authClose')?.addEventListener('click', () => closeOverlay(overlay));
  $('#authOpen')?.addEventListener('click', () => openOverlay(overlay));

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-auth-required]');
    if (el && !currentUser) {
      e.preventDefault();
      e.stopImmediatePropagation();
      showToast('Сначала войдите', 'warn');
      openOverlay(overlay);
    }
  });

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

  // Блок 1: кнопка перехода в режим модератора
  $('#openModerationBtn')?.addEventListener('click', () => {
    if (!isModerator()) {
      showToast('Нет прав для модерации', 'warn');
      return;
    }
    userMenu?.classList.add('hidden');
    // Переключаем в режим модератора (сохраняем в localStorage)
    localStorage.setItem('tea_shelf_mode', 'moderator');
    showToast('🛡️ Режим модератора активирован');
    // Перезагружаем страницу чтобы обновить интерфейс
    window.location.reload();
  });

  // Блок 1: кнопка возврата в обычный режим
  $('#exitModerationBtn')?.addEventListener('click', () => {
    localStorage.removeItem('tea_shelf_mode');
    showToast('👤 Возврат в обычный режим');
    window.location.reload();
  });

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
        trackEvent('login');
        closeOverlay(overlay);
        showToast('С возвращением!');
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password: pass,
          options: { data: { name } },
        });
        if (error) throw error;

        if (Array.isArray(data.identities) && data.identities.length === 0) {
          const box = $('#authError');
          box.textContent = 'Этот email уже зарегистрирован. Попробуйте войти.';
          box.classList.add('show');
          return;
        }

        trackEvent('signup');
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
      btn.textContent = mode === 'login' ? 'Войти' : 'Создать аккаунт';
    }
  });

  supabase.auth.onAuthStateChange(() => { refreshUser(); });
  await refreshUser();
}

// ============================================================
// Consent & Privacy (без изменений)
// ============================================================
function injectConsent() {
  const form = $('#authForm');
  if (!form || $('#consentLine')) return;

  const line = document.createElement('p');
  line.id = 'consentLine';
  line.className = 'consent';
  line.innerHTML = `
    Нажимая «Создать аккаунт», вы соглашаетесь с
    <a href="#" id="privacyOpen">обработкой персональных данных</a>.
  `;
  form.appendChild(line);
}

function openPrivacy() {
  showToast('Политика конфиденциальности: мы храним только email и имя. Данные не передаются третьим лицам.');
}