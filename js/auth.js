// ============================================================
// auth.js — управление авторизацией + роли пользователей
// Блок 1: загрузка роли (admin/moderator/user)
// Блок 2: кнопка режима модератора + переход в каталог
// ФИКС (этап 3): «Режим модератора» — ТУМБЛЕР:
//   • ВЫКЛ — админ/модератор пользуется сервисом как обычный
//     пользователь (чистый интерфейс, «На полку» и т.д.);
//   • ВКЛ — карандаши редактирования, тумблер «Каталог/Модерация»;
//   • строка роли из меню пользователя убрана (юзверю не нужно
//     знать, кто он).
// ============================================================
import { supabase, isConfigured } from './supabaseClient.js';
import {
  $, openOverlay, closeOverlay, wireOverlay, showToast,
  setInvalid, isValidEmail, trackEvent,
} from './ui.js';
import { SHOW_DEMO_ACCOUNTS } from './config.js';

let currentUser = null;
let currentUserRole = 'user';
// Режим модератора: активен только при роли И включённом тумблере
let moderationActive = localStorage.getItem('tea_shelf_mode') === 'moderator';
const listeners = [];

export const getUser = () => currentUser;
export const getUserRole = () => currentUserRole;
export const hasModeratorRole = () => ['admin', 'moderator'].includes(currentUserRole);
export const isModerationActive = () => moderationActive && hasModeratorRole();
export const isAdmin = () => currentUserRole === 'admin';

export function onAuthChange(fn) { listeners.push(fn); }
function emit() { listeners.forEach((fn) => fn(currentUser, currentUserRole)); }

// ---------- Тумблер режима модератора ----------
export function toggleModerationMode() {
  if (!hasModeratorRole()) {
    showToast('Нет прав для модерации', 'warn');
    return false;
  }
  moderationActive = !moderationActive;
  if (moderationActive) localStorage.setItem('tea_shelf_mode', 'moderator');
  else localStorage.removeItem('tea_shelf_mode');
  renderState();
  emit(); // страницы (каталог) подхватят изменение без ручного reload
  return moderationActive;
}

export function openAuth() {
  const ov = $('#authOverlay');
  if (ov) openOverlay(ov);
}

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

    // Тумблер «Режим модератора»: виден только обладателям роли,
    // текст и состояние зависят от того, включён ли режим сейчас.
    const modBtn = $('#openModerationBtn');
    if (modBtn) {
      modBtn.classList.toggle('hidden', !hasModeratorRole());
      modBtn.textContent = isModerationActive()
        ? '👤 Выйти из режима модератора'
        : '🛡️ Режим модератора';
    }
  } else {
    openBtn.classList.remove('hidden');
    userArea.classList.add('hidden');
    $('#userMenu')?.classList.add('hidden');
  }
}

// ============================================================
// Политика обработки персональных данных
// ============================================================
const PRIVACY_HTML = `
  <h3 style="margin:0 0 6px;">1. Общие положения</h3>
  <p style="margin:0 0 12px;">Сервис «Чайная полка» (далее — сервис) собирает только данные, необходимые для его работы, и не передаёт их третьим лицам. Регистрируясь, вы даёте согласие на обработку перечисленных ниже данных.</p>

  <h3 style="margin:0 0 6px;">2. Какие данные мы собираем</h3>
  <p style="margin:0 0 12px;">— Аккаунт: email и имя.<br>— Записи полки: добавленные чаи, остатки, журнал завариваний с оценками и заметками.<br>— Заявки на добавление чая в общий каталог.</p>

  <h3 style="margin:0 0 6px;">3. Зачем они нужны</h3>
  <p style="margin:0 0 12px;">Чтобы вести вашу личную полку и журнал, рассматривать заявки в каталог и улучшать сервис. Данные не используются для рекламы и не продаются.</p>

  <h3 style="margin:0 0 6px;">4. Где хранятся и кто их видит</h3>
  <p style="margin:0 0 12px;">Данные хранятся в защищённой облачной базе Supabase. Ваши записи видите только вы. Администрация сервиса видит заявки для модерации. Одобренный чай публикуется в каталоге без указания ваших контактов.</p>

  <h3 style="margin:0 0 6px;">5. Аналитика</h3>
  <p style="margin:0 0 12px;">Сервис использует аналитику без cookie (Vercel Analytics, PostHog): она фиксирует обезличенные действия — визиты и нажатия кнопок — и не позволяет идентифицировать личность.</p>

  <h3 style="margin:0 0 6px;">6. Ваши права</h3>
  <p style="margin:0 0 0;">Вы можете удалить чаи с полки, отозвать заявки, а также запросить удаление аккаунта и всех данных — напишите нам через ссылку «Обратная связь» внизу страницы.</p>
`;

let privacyOv = null;

function buildPrivacyOverlay() {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.hidden = true;
  ov.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="privacyTitle">
      <div class="modal-head">
        <h2 id="privacyTitle">Политика обработки персональных данных</h2>
        <button class="icon-btn" id="privacyClose" type="button" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div style="font-size:13.5px; line-height:1.6; color:#4A4331; max-height:55vh; overflow-y:auto; padding:2px;">${PRIVACY_HTML}</div>
      <div class="modal-foot">
        <button class="btn btn-primary" id="privacyOk" type="button">Понятно</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  wireOverlay(ov);
  return ov;
}

function openPrivacy() {
  if (!privacyOv) {
    privacyOv = buildPrivacyOverlay();
    $('#privacyClose').addEventListener('click', () => closeOverlay(privacyOv));
    $('#privacyOk').addEventListener('click', () => closeOverlay(privacyOv));
  }
  openOverlay(privacyOv);
}

function injectConsent() {
  const anchor = $('#fieldPassword');
  if (!anchor || $('#consentLine')) return;
  const p = document.createElement('p');
  p.id = 'consentLine';
  p.className = 'hint hidden';
  p.style.margin = '0 0 var(--space-3)';
  p.innerHTML =
    'Регистрируясь на сайте, вы подтверждаете своё согласие на ' +
    '<a href="#" id="privacyOpen" style="text-decoration:underline;">сбор персональных данных</a>.';
  anchor.insertAdjacentElement('afterend', p);
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

  // Юзеру не нужно знать свою роль — убираем строку из меню полностью
  $('#userRoleBadge')?.remove();

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

  // ТУМБЛЕР режима модератора:
  // ВКЛ  → переходим в каталог с открытой модерацией;
  // ВЫКЛ → возвращаем обычный пользовательский интерфейс.
  $('#openModerationBtn')?.addEventListener('click', () => {
    const active = toggleModerationMode();
    userMenu?.classList.add('hidden');
    if (active) {
      showToast('🛡️ Режим модератора активирован');
      window.location.href = 'catalog.html?moderation=1';
    } else {
      showToast('👤 Вы в обычном режиме');
      window.location.reload();
    }
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