// ============================================================
// auth.js — управление авторизацией + роли пользователей
// Блок 1: загрузка роли (admin/moderator/user)
// Блок 2: кнопка режима модератора + переход в каталог
// ЭТАП 7: аватар профиля в шапке, экспорт refreshUserAvatar.
// ============================================================
import { supabase, isConfigured } from './supabaseClient.js';
import {
  $, openOverlay, closeOverlay, wireOverlay, showToast,
  setInvalid, isValidEmail, trackEvent,
} from './ui.js';
import { SHOW_DEMO_ACCOUNTS } from './config.js';

let currentUser = null;
let currentUserRole = 'user';
let moderationActive = localStorage.getItem('tea_shelf_mode') === 'moderator';
const listeners = [];

export const getUser = () => currentUser;
export const getUserRole = () => currentUserRole;
export const hasModeratorRole = () => ['admin', 'moderator'].includes(currentUserRole);
export const isModerationActive = () => moderationActive && hasModeratorRole();
export const isAdmin = () => currentUserRole === 'admin';

export function onAuthChange(fn) { listeners.push(fn); }
function emit() { listeners.forEach((fn) => fn(currentUser, currentUserRole)); }

// ---------- Аватар профиля в шапке ----------
async function loadAvatarInto(btn, userId) {
  try {
    const { data } = await supabase.from('profiles')
      .select('avatar_url').eq('user_id', userId).maybeSingle();
    if (data?.avatar_url && document.body.contains(btn)) {
      btn.innerHTML = `<img class="avatar-img" src="${data.avatar_url}" alt="">`;
    }
  } catch (e) { /* остаются инициалы */ }
}

export function refreshUserAvatar() {
  const btn = $('#avatarBtn');
  if (!btn || !currentUser) return;
  loadAvatarInto(btn, currentUser.id);
}

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
  emit();
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

    const avatarBtn = $('#avatarBtn');
    if (avatarBtn) {
      avatarBtn.textContent = initials || '?';
      loadAvatarInto(avatarBtn, currentUser.id);
    }

    const modBtn = $('#openModerationBtn');
    if (modBtn) {
      modBtn.classList.toggle('hidden', !hasModeratorRole());
      modBtn.textContent = isModerationActive()
        ? 'Выйти из режима модератора'
        : 'Режим модератора';
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
  <p style="margin:0 0 12px;">1.1 Настоящая политика разработана в соответствии с Федеральным законом от 27.07.2006 № 152-ФЗ «О персональных данных» и определяет порядок обработки персональных данных пользователей сервиса «Чайная полка».<br>1.2 Оператор данных — администрация сервиса «Чайная полка». Вопросы и запросы по персональным данным — через ссылку «Обратная связь» в подвале сайта.</p>

  <h3 style="margin:0 0 6px;">2. Состав обрабатываемых данных</h3>
  <p style="margin:0 0 12px;">— Аккаунт: email, имя, фото профиля (по желанию).<br>— Записи полки: добавленные чаи, остатки, журнал завариваний с оценками и заметками.<br>— Заявки на добавление чая в общий каталог.</p>

  <h3 style="margin:0 0 6px;">3. Цели обработки</h3>
  <p style="margin:0 0 12px;">Предоставление функционала сервиса (личная полка, журнал, каталог), модерация заявок, улучшение сервиса. Данные не используются для рекламы и не передаются третьим лицам.</p>

  <h3 style="margin:0 0 6px;">4. Хранение и защита</h3>
  <p style="margin:0 0 12px;">Данные хранятся в защищённой базе данных с разграничением доступа: ваши личные записи видите только вы, администрация видит заявки для модерации. Одобренный чай публикуется в каталоге без указания ваших контактов. Инфраструктура сервиса размещается с учётом требований 152-ФЗ.</p>

  <h3 style="margin:0 0 6px;">5. Файлы cookie и аналитика</h3>
  <p style="margin:0 0 12px;">Сервис использует аналитику (Vercel Analytics и Яндекс Метрика): фиксируются обезличенные действия — визиты и нажатия кнопок — без идентификации личности.</p>

  <h3 style="margin:0 0 6px;">6. Сроки хранения и удаление</h3>
  <p style="margin:0 0 12px;">Данные хранятся до удаления аккаунта. Вы можете удалить аккаунт и все данные самостоятельно в профиле (кнопка «Удалить аккаунт») либо запросить удаление через «Обратную связь». Неопознанные чаи удаляются автоматически через 30 дней после завершения.</p>

  <h3 style="margin:0 0 6px;">7. Права пользователя</h3>
  <p style="margin:0 0 0;">Вы вправе получать сведения об обработке своих данных, изменять их (профиль), отозвать согласие на обработку — удалением аккаунта или запросом через «Обратную связь».</p>
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

// ---------- Ссылка на политику в подвале (постоянный доступ, 152-ФЗ) ----------
function injectFooterPrivacy() {
  const wrap = document.querySelector('footer .wrap');
  if (!wrap || $('#privacyFooterLink')) return;
  const a = document.createElement('a');
  a.href = '#';
  a.id = 'privacyFooterLink';
  a.textContent = 'Политика конфиденциальности';
  a.style.marginLeft = '12px';
  a.style.textDecoration = 'underline';
  a.addEventListener('click', (e) => {
    e.preventDefault();
    openPrivacy();
  });
  wrap.appendChild(a);
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

  $('#userRoleBadge')?.remove();

  injectConsent();
  injectFooterPrivacy();

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

  $('#openModerationBtn')?.addEventListener('click', () => {
    const active = toggleModerationMode();
    userMenu?.classList.add('hidden');
    if (active) {
      showToast('Режим модератора активирован');
      window.location.href = 'catalog.html?moderation=1';
    } else {
      showToast('Вы в обычном режиме');
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