// ============================================================
// auth.js — управление авторизацией + роли пользователей
// Блок 1: загрузка роли (admin/moderator/user)
// Фикс: возвращена полноценная модалка политики персональных
// данных (openPrivacy) вместо тоста.
// ============================================================
import {
  $, showToast, openOverlay, closeOverlay, wireOverlay,
  setInvalid, isValidEmail, trackEvent,
} from './ui.js';
import { supabase, isConfigured } from './supabaseClient.js';
import { SHOW_DEMO_ACCOUNTS } from './config.js';

let currentUser = null;
let currentUserRole = 'user'; // Блок 1: роль пользователя
const listeners = [];

export const getUser = () => currentUser;
export const getUserRole = () => currentUserRole;                       // Блок 1
export const isModerator = () => ['admin', 'moderator'].includes(currentUserRole); // Блок 1
export const isAdmin = () => currentUserRole === 'admin';              // Блок 1

export function onAuthChange(fn) { listeners.push(fn); }
function emit() { listeners.forEach((fn) => fn(currentUser, currentUserRole)); }

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

    // Блок 1: роль в dropdown меню
    const roleBadge = $('#userRoleBadge');
    if (roleBadge) {
      const roleLabels = {
        admin: '👮 Администратор',
        moderator: '🛡️ Модератор',
        user: '👤 Пользователь',
      };
      roleBadge.textContent = roleLabels[currentUserRole] || roleLabels.user;
      roleBadge.classList.toggle('role-admin', currentUserRole === 'admin');
      roleBadge.classList.toggle('role-moderator', currentUserRole === 'moderator');
    }

    // Блок 1: кнопка режима модератора — только для admin/moderator
    const modBtn = $('#openModerationBtn');
    if (modBtn) modBtn.classList.toggle('hidden', !isModerator());
  } else {
    authBtn?.classList.remove('hidden');
    userArea?.classList.add('hidden');
  }
}

// ============================================================
// Политика персональных данных — модалка (возвращена)
// ============================================================
let privacyOv = null;

function injectPrivacyStyles() {
  if ($('#privacyStyles')) return;
  const st = document.createElement('style');
  st.id = 'privacyStyles';
  st.textContent = `
    .privacy-body { max-height: 55vh; overflow-y: auto; padding: 2px 2px 6px; }
    .privacy-body h3 { margin: 14px 0 6px; font-size: 14px; }
    .privacy-body h3:first-child { margin-top: 0; }
    .privacy-body p,
    .privacy-body li { margin: 0 0 8px; font-size: 13px; line-height: 1.6; color: #5C543F; }
    .privacy-body ul { padding-left: 18px; }
  `;
  document.head.appendChild(st);
}

function buildPrivacyOverlay() {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.hidden = true;
  ov.innerHTML = `
    <div class="modal narrow" role="dialog" aria-modal="true" aria-labelledby="privacyTitle">
      <div class="modal-head">
        <h2 id="privacyTitle">Политика персональных данных</h2>
        <button class="icon-btn" type="button" data-privacy="close" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="privacy-body">
        <h3>1. Какие данные мы собираем</h3>
        <p>При регистрации мы запрашиваем только email и имя. Никаких других данных сервис не запрашивает.</p>

        <h3>2. Зачем они нужны</h3>
        <ul>
          <li>создание аккаунта и вход в сервис;</li>
          <li>хранение вашей личной полки чая, журнала завариваний и заявок в каталог.</li>
        </ul>

        <h3>3. Где хранятся данные</h3>
        <p>Данные хранятся в базе Supabase (PostgreSQL) и защищены политиками доступа (RLS): вашу полку и журнал видите только вы.</p>

        <h3>4. Третьим лицам</h3>
        <p>Мы не передаём данные третьим лицам, не используем их для рекламы и не отправляем рассылки.</p>

        <h3>5. Аналитика</h3>
        <p>Для обезличенной статистики посещений используется Яндекс Метрика (просмотры страниц и нажатия кнопок). Персональные данные в Метрику не передаются.</p>

        <h3>6. Удаление данных</h3>
        <p>Вы можете прекратить использование аккаунта в любой момент. Для полного удаления данных напишите нам через форму обратной связи в подвале сайта.</p>
      </div>
      <div class="modal-foot">
        <button class="btn btn-primary" type="button" data-privacy="close">Понятно</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  wireOverlay(ov); // клик по фону закрывает
  ov.addEventListener('click', (e) => {
    if (e.target.closest('[data-privacy="close"]')) closeOverlay(ov);
  });
  return ov;
}

function openPrivacy() {
  injectPrivacyStyles();
  if (!privacyOv) privacyOv = buildPrivacyOverlay();
  openOverlay(privacyOv);
}

// ============================================================
// Согласие под формой регистрации
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

  // Ссылка «обработка персональных данных» (элемент создан в JS)
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

  // Блок 1: вход в режим модератора
  $('#openModerationBtn')?.addEventListener('click', () => {
    if (!isModerator()) {
      showToast('Нет прав для модерации', 'warn');
      return;
    }
    userMenu?.classList.add('hidden');
    localStorage.setItem('tea_shelf_mode', 'moderator');
    showToast('🛡️ Режим модератора активирован');
    window.location.reload();
  });

  // Блок 1: выход из режима модератора
  $('#exitModerationBtn')?.addEventListener('click', () => {
    localStorage.removeItem('tea_shelf_mode');
    showToast('👤 Возврат в обычный режим');
    window.location.reload();
  });

  // Сабмит формы входа/регистрации
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

        // Supabase НЕ возвращает ошибку для уже занятого email
        // (защита от перебора адресов). Признак дубля — пустой
        // массив identities в ответе.
        if (Array.isArray(data.identities) && data.identities.length === 0) {
          const box = $('#authError');
          box.textContent = 'Этот email уже зарегистрирован. Попробуйте войти.';
          box.classList.add('show');
          return; // модалку не закрываем, форму не сбрасываем
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
      // Не вызываем setMode() — она скрывает плашку ошибки.
      btn.textContent = mode === 'login' ? 'Войти' : 'Создать аккаунт';
    }
  });

  supabase.auth.onAuthStateChange(() => { refreshUser(); });
  await refreshUser();
}