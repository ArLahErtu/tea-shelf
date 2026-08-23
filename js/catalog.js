// ============================================================
// catalog.js — логика страницы catalog.html
// Словарь БД: status='published', автор — author_id,
// типы по-русски, region/temp/time — text, tags — text
// Блок B: «Избранное» вместо «хотелок» (таблица wishlist).
// Блок C: серверная пагинация по 20 + «Показать ещё».
// Неделя 4: серверный фильтр по типу чая; события Метрики.
// БЛОК 1 (этап 3): ПОЛНОЦЕННАЯ МОДЕРАЦИЯ —
//   • роль берётся из auth.js (user_roles), без хардкода email;
//   • режим модератора — ТУМБЛЕР (isModerationActive):
//     ВЫКЛ — чистый пользовательский интерфейс без карандашей;
//     ВКЛ  — карандаши, тумблер «Каталог/Модерация», очередь;
//   • одобрение/отклонение через RPC approve_tea / reject_tea;
//   • редактирование любых карточек через RPC update_tea;
//   • фикс фильтра по типу (ilike, регистронезависимо);
//   • URL синхронизирован с режимом (?moderation=1);
//   • ошибки модерации — тихо в консоль + блок в сетке.
// ФИКС: явный contentType при загрузке фото —
//   webp/avif теперь сохраняются с правильным MIME и отображаются.
// ============================================================
import { initCommon } from './common.js';
import { supabase } from './supabaseClient.js';
import { TABLES } from './config.js';
import {
  $, $$, showToast, openOverlay, closeOverlay, wireOverlay,
  setInvalid, escapeHtml, plural, typeClass, TYPE_TO_DB, toTags, trackEvent,
} from './ui.js';
import { getUser, isModerationActive, onAuthChange } from './auth.js';
import { openTeaModal } from './teaModal.js';
import { initAmountModal, openAmountModal } from './amountModal.js';

const PAGE_SIZE = 20;

let published = [];   // загруженные страницы published
let pending = [];     // мои pending-заявки (автор видит свои)
let pendingAll = [];  // ВСЕ pending-заявки (только модератор, RPC)
let teas = [];        // pending + published (для поиска по клику)
let myShelf = new Set();
let favorites = new Set();
let currentTea = null;
let currentUser = null;
let currentModerationTea = null; // заявка, открытая в модалке модерации
let moderationError = false;     // RPC упал — показываем тихий блок в сетке

let viewMode = 'catalog'; // 'catalog' | 'moderation'

let loadedCount = 0;  // сколько published загружено в текущем запросе
let canMore = false;  // возможно, в базе есть ещё
let loading = false;

const state = { q: '', sort: 'popular', type: 'all' };

// ---------- Устойчивость к сети ----------
async function safeFetch(build, label = '') {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await build();
      if (error) {
        console.warn('[supabase]', label, error.message);
        return null;
      }
      return data || [];
    } catch (e) {
      console.warn('[fetch]', label, e?.message || e);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return null;
}

// ---------- Серверный запрос: поиск + тип + сортировка + страница ----------
function pageQuery(offset) {
  let q = supabase.from(TABLES.catalog).select('*')
    .eq('status', 'published');
  if (state.type !== 'all') {
    // ilike — регистронезависимо: 'Улун' из селекта найдёт 'улун' в БД
    q = q.ilike('type', state.type);
  }
  if (state.q) {
    // Поиск по name, region И tags
    q = q.or(`name.ilike.%${state.q}%,region.ilike.%${state.q}%,tags.ilike.%${state.q}%`);
  }
  if (state.sort === 'popular') {
    q = q.order('popularity', { ascending: false }).order('id', { ascending: true });
  } else if (state.sort === 'name') {
    q = q.order('name', { ascending: true });
  } else {
    q = q.order('id', { ascending: true });
  }
  return q.range(offset, offset + PAGE_SIZE - 1);
}

function loadPublished(offset = 0) {
  return safeFetch(() => pageQuery(offset), `catalog page ${offset}`);
}

// ---------- Модерация: загрузка ВСЕХ pending через RPC ----------
// Без всплывающих тостов: ошибка уходит в консоль и в тихий блок сетки.
async function loadModeration() {
  if (!isModerationActive()) { pendingAll = []; moderationError = false; return; }
  const { data, error } = await supabase.rpc('get_pending_teas');
  if (error) {
    console.warn('[moderation]', error.message);
    moderationError = true;
    pendingAll = [];
  } else {
    moderationError = false;
    pendingAll = data || [];
  }
  const badge = $('#pendingCount');
  if (badge) badge.textContent = pendingAll.length;
}

// ---------- Синхронизация URL с режимом ----------
// Убирает ?moderation=1 при выходе в каталог, чтобы перезагрузка
// или обновление токена не возвращали насильно в модерацию.
function syncUrlWithMode() {
  const url = new URL(location.href);
  if (viewMode === 'moderation') url.searchParams.set('moderation', '1');
  else url.searchParams.delete('moderation');
  history.replaceState(null, '', url.toString());
}

// ---------- Загрузка (старт / смена входа) ----------
async function load() {
  const first = await loadPublished(0);
  if (first === null) {
    throw new Error('Нет соединения с базой. Проверь сеть/блокировщики и нажми «Повторить».');
  }
  published = first;
  loadedCount = first.length;
  canMore = first.length === PAGE_SIZE;

  pending = [];
  const user = getUser();
  currentUser = user;

  // Тумблер режимов виден только при ВКЛЮЧЁННОМ режиме модератора
  $('#modeSwitch').classList.toggle('hidden', !isModerationActive());

  if (user) {
    const [p, sh, wl] = await Promise.all([
      safeFetch(() => supabase.from(TABLES.catalog).select('*')
        .eq('status', 'pending').eq('author_id', user.id), 'my pending'),
      safeFetch(() => supabase.from(TABLES.shelf).select('tea_id')
        .eq('user_id', user.id), 'shelf ids'),
      safeFetch(() => supabase.from(TABLES.wishlist).select('tea_id')
        .eq('user_id', user.id), 'favorites ids'),
    ]);
    pending = p || [];
    myShelf = new Set((sh || []).map((r) => r.tea_id));
    favorites = new Set((wl || []).map((r) => r.tea_id));
  }
  teas = pending.concat(published);

  // Определяем вкладку: уже включена / пришли по ссылке с тумблера
  const params = new URLSearchParams(location.search);
  const wantModeration = isModerationActive() && (
    viewMode === 'moderation' || params.get('moderation') === '1'
  );
  viewMode = wantModeration ? 'moderation' : 'catalog';
  $$('#modeSwitch .mode-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === viewMode));
  if (viewMode === 'moderation') await loadModeration();
  syncUrlWithMode();

  render();
  renderMore();
}

// ---------- Переключение вкладок Каталог / Модерация ----------
async function setMode(mode) {
  if (mode === viewMode) { render(); renderMore(); return; }
  viewMode = mode;
  $$('#modeSwitch .mode-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === mode));

  if (mode === 'moderation') {
    await loadModeration();
  }
  syncUrlWithMode();
  render();
  renderMore();
}

// ---------- Поиск / тип / сортировка: перезагрузка ----------
async function refresh() {
  if (viewMode === 'moderation') {
    // в модерации данные локальные, просто перерисовываем
    await loadModeration();
    render();
    return;
  }
  const first = await loadPublished(0);
  if (first === null) return showToast('Не удалось обновить список', 'warn');
  published = first;
  loadedCount = first.length;
  canMore = first.length === PAGE_SIZE;
  teas = pending.concat(published);
  render();
  renderMore();
}

// ---------- «Показать ещё» ----------
async function loadMore() {
  if (loading || !canMore || viewMode === 'moderation') return;
  loading = true;
  const btn = $('#moreBtn');
  btn.disabled = true;
  btn.textContent = 'Загружаем…';

  const next = await loadPublished(loadedCount);
  loading = false;

  if (next === null) {
    btn.disabled = false;
    btn.textContent = 'Показать ещё';
    return showToast('Не удалось загрузить ещё. Нажмите снова', 'warn');
  }

  published = published.concat(next);
  loadedCount += next.length;
  canMore = next.length === PAGE_SIZE;
  teas = pending.concat(published);
  render();
  renderMore();
}

function renderMore() {
  if (viewMode === 'moderation') {
    $('#moreWrap').classList.add('hidden');
    return;
  }
  $('#moreWrap').classList.toggle('hidden', !canMore);
  const btn = $('#moreBtn');
  btn.disabled = false;
  btn.textContent = 'Показать ещё';
}

// ---------- Клиентский фильтр pending (режим модерации) ----------
function filterPending(list) {
  let res = [...list];
  if (state.q) {
    const q = state.q.toLowerCase();
    res = res.filter((t) =>
      (t.name || '').toLowerCase().includes(q) ||
      (t.region || '').toLowerCase().includes(q) ||
      (t.tags || '').toLowerCase().includes(q));
  }
  if (state.type !== 'all') {
    res = res.filter((t) =>
      String(t.type || '').toLowerCase() === state.type.toLowerCase());
  }
  if (state.sort === 'name') {
    res.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
  } else if (state.sort === 'popular') {
    res.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  } else {
    // в tea_catalog нет created_at — новые заявки имеют больший id
    res.sort((a, b) => (b.id || 0) - (a.id || 0));
  }
  return res;
}

// ---------- Транслитерация и SEO-оптимизация ----------
function transliterate(text) {
  if (!text) return '';

  const ru = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd',
    'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z', 'и': 'i',
    'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n',
    'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't',
    'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch',
    'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '',
    'э': 'e', 'ю': 'yu', 'я': 'ya'
  };

  return text.toLowerCase()
    .split('')
    .map(char => ru[char] || char)
    .join('');
}

function seoSlugify(text) {
  if (!text) return 'tea';

  return transliterate(text)
    .replace(/[^\w\s-]/g, '')           // удаляем спецсимволы
    .replace(/\s+/g, '-')               // пробелы → дефисы
    .replace(/-+/g, '-')                // множественные дефисы → один
    .replace(/^-+|-+$/g, '')            // убираем дефисы с краёв
    .toLowerCase()
    .slice(0, 60);                      // ограничиваем длину
}

// ---------- SEO-оптимизация типа чая для URL ----------
function getSeoTypeName(type) {
  if (!type) return 'other';

  // Словарь транслитерации для типов
  const typeMap = {
    'зелёный': 'green',
    'зеленый': 'green',
    'чёрный': 'black',
    'черный': 'black',
    'улун': 'oolong',
    'пуэр': 'puerh',
    'белый': 'white',
    'жёлтый': 'yellow',
    'желтый': 'yellow',
    'красный': 'red',
    'хэй ча': 'hei-cha',
    'хэйча': 'hei-cha',
    'цветочный': 'floral',
    'матте': 'matte',
    'матча': 'matcha',
    'травяной': 'herbal',
    'смесь': 'blend',
    'купаж': 'blend',
  };

  const lowerType = type.toLowerCase();
  return typeMap[lowerType] || lowerType.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// ---------- Рендер ----------
function cardNode(tea) {
  const node = $('#teaCardTemplate').content.firstElementChild.cloneNode(true);
  node.dataset.teaId = tea.id;

  const img = node.querySelector('img');
  if (tea.photo_url) {
    img.src = tea.photo_url;
    img.alt = tea.name;
    img.classList.remove('hidden');
    node.querySelector('.ph').classList.add('hidden');
  }

  const chip = node.querySelector('.typechip');
  chip.textContent = tea.type || '—';
  chip.className = 'typechip ' + typeClass(tea.type);

  node.querySelector('.tname').textContent = tea.name;
  node.querySelector('.torigin').textContent = tea.region || '';
  node.querySelector('.tdesc').textContent = tea.description || '';
  node.querySelector('.brewline').textContent =
    [tea.temp, tea.time].filter(Boolean).join(' · ');

  const tagrow = node.querySelector('.tagrow');
  toTags(tea.tags).slice(0, 3).forEach((t) => {
    const s = document.createElement('span');
    s.className = 'tag';
    s.textContent = t;
    tagrow.appendChild(s);
  });

  const pop = tea.popularity || 0;
  node.querySelector('.pop').textContent = pop
    ? `${pop} ${plural(pop, ['заваривание', 'заваривания', 'завариваний'])} у пользователей`
    : '';

  node.querySelector('.pendbadge').classList.toggle('hidden', tea.status !== 'pending');

  const inModeration = viewMode === 'moderation';
  const onShelf = myShelf.has(tea.id);
  node.querySelector('.onshelf').classList.toggle('hidden', !onShelf || inModeration);
  node.querySelector('[data-action="add-to-shelf"]')
    .classList.toggle('hidden', inModeration || onShelf || tea.status === 'pending');
  node.querySelector('.heart').classList.toggle('hidden', inModeration);
  node.querySelector('.heart').classList.toggle('on', favorites.has(tea.id));

  // Кнопка редактирования (только в режиме каталога и при ВКЛ-тумблере):
  // - Модератор может редактировать ВСЕ чаи
  // - Автор может редактировать ТОЛЬКО pending чаи (даже без тумблера)
  const canEdit = !inModeration && (
    isModerationActive() || (tea.author_id === currentUser?.id && tea.status === 'pending')
  );

  if (canEdit) {
    const editBtn = document.createElement('button');
    editBtn.className = 'edit-tea-btn';
    editBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4Z"/></svg>';
    editBtn.title = tea.status === 'pending' ? 'Редактировать заявку' : 'Редактировать чай';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditTeaModal(tea);
    });
    node.querySelector('.media-top').appendChild(editBtn);
  }

  return node;
}

function render() {
  const grid = $('#catalogGrid');
  grid.setAttribute('aria-busy', 'false');
  grid.innerHTML = '';

  // ----- Режим модерации: показываем ВСЕ pending -----
  if (viewMode === 'moderation') {
    if (moderationError) {
      grid.innerHTML = `<div class="empty grid-col-span">
        <h3>Не удалось загрузить заявки</h3>
        <p>Попробуйте переключиться в «Каталог» и обратно или обновить страницу.</p>
      </div>`;
      return;
    }
    const list = filterPending(pendingAll);
    if (!list.length) {
      grid.innerHTML = `<div class="empty grid-col-span">
        <h3>Заявок нет</h3>
        <p>Все заявки обработаны. Отличная работа! 🎉</p>
      </div>`;
      return;
    }
    list.forEach((t) => grid.appendChild(cardNode(t)));
    return;
  }

  // ----- Обычный режим каталога -----
  const list = teas; // фильтрация/сортировка уже выполнены сервером
  if (!list.length) {
    grid.innerHTML = `<div class="empty grid-col-span">
      <h3>Ничего не найдено</h3>
      <p>Попробуйте изменить запрос или сортировку.</p>
    </div>`;
    return;
  }
  list.forEach((t) => grid.appendChild(cardNode(t)));
}

// ---------- Избранное ----------
function syncFavBtn(tea) {
  const label = $('#wishlistBtnText');
  if (!label || !tea) return;
  label.textContent = favorites.has(tea.id) ? 'В избранном ✓' : 'В избранное';
}

async function toggleFavorite(tea) {
  const user = getUser();
  if (!user) { showToast('Сначала войдите', 'warn'); return; }

  if (favorites.has(tea.id)) {
    await supabase.from(TABLES.wishlist).delete()
      .eq('user_id', user.id).eq('tea_id', tea.id);
    favorites.delete(tea.id);
    showToast(`«${tea.name}» убран из избранного`);
    trackEvent('favorite_toggled', { tea_id: tea.id, added: false });
  } else {
    const { error } = await supabase.from(TABLES.wishlist)
      .insert({ user_id: user.id, tea_id: tea.id });
    if (error) return showToast('Не удалось добавить: ' + error.message, 'warn');
    favorites.add(tea.id);
    showToast(`«${tea.name}» — в избранном`);
    trackEvent('favorite_toggled', { tea_id: tea.id, added: true });
  }
  syncFavBtn(tea);
  render();
}

// ---------- Действия ----------
async function addToShelf(tea, payload) {
  const user = getUser();
  if (!user) return;
  if (myShelf.has(tea.id)) return showToast('Этот чай уже на полке', 'warn');

  const { error } = await supabase.from(TABLES.shelf).insert({
    user_id: user.id,
    tea_id: tea.id,
    amount: payload.amount,
    unit: payload.unit,
    low_threshold: payload.threshold,
  });
  if (error) {
    // 23505 = unique_violation: чай уже на полке (страховка БД)
    if (error.code === '23505') {
      myShelf.add(tea.id);
      render();
      return showToast('Этот чай уже на полке', 'warn');
    }
    return showToast('Не удалось добавить: ' + error.message, 'warn');
  }
  myShelf.add(tea.id);
  showToast(`«${tea.name}» добавлен на полку`);
  trackEvent('tea_added_to_shelf', { tea_id: tea.id, tea_name: tea.name, unit: payload.unit });
  $('#addToShelfBtn')?.classList.add('hidden'); // чай уже на полке — кнопка модалки гаснет
  render();
}

function requestAdd(tea) {
  if (!getUser()) { showToast('Сначала войдите', 'warn'); return; }
  openAmountModal({
    mode: 'add',
    teaName: tea.name,
    onSubmit: (p) => addToShelf(tea, p),
  });
}

// ============================================================
// МОДЕРАЦИЯ: проверка заявки (одобрить / отклонить)
// ============================================================
function openModerateModal(tea) {
  currentModerationTea = tea;
  const ov = $('#moderateOverlay');
  if (!ov) return showToast('Модалка модерации не найдена', 'warn');

  $('#moderateName').value = tea.name || '';

  // Подбираем option селекта по значению в нижнем регистре
  const typeSel = $('#moderateType');
  const want = String(tea.type || '').toLowerCase();
  const opt = [...typeSel.options].find((o) => o.value.toLowerCase() === want);
  typeSel.value = opt ? opt.value : '';

  $('#moderateRegion').value = tea.region || '';
  $('#moderateDescription').value = tea.description || '';
  $('#moderateTemp').value = tea.temp || '';
  $('#moderateTime').value = tea.time || '';
  $('#moderateGrams').value = tea.grams ?? '';
  $('#moderateSteeps').value = tea.steeps || '';
  $('#moderateTags').value = tea.tags || '';
  $('#moderatePhoto').value = tea.photo_url || '';

  $('#moderateDuplicateWarn').classList.add('hidden');
  checkDuplicate(tea);

  openOverlay(ov);
}

// Предупреждение, если чай с таким названием уже опубликован
async function checkDuplicate(tea) {
  const name = (tea.name || '').trim();
  if (!name) return;
  const { data } = await supabase
    .from(TABLES.catalog)
    .select('id')
    .eq('status', 'published')
    .ilike('name', name)
    .neq('id', tea.id)
    .limit(1);
  $('#moderateDuplicateWarn').classList.toggle('hidden', !(data && data.length));
}

// Собираем отредактированные поля из модалки модерации
function collectModerateData() {
  const data = {
    name: $('#moderateName').value.trim(),
    type: $('#moderateType').value.toLowerCase(),
    region: $('#moderateRegion').value.trim(),
    description: $('#moderateDescription').value.trim(),
    temp: $('#moderateTemp').value.trim(),
    time: $('#moderateTime').value.trim(),
    steeps: $('#moderateSteeps').value.trim(),
    tags: $('#moderateTags').value.trim(),
    photo_url: $('#moderatePhoto').value.trim(),
  };
  const grams = $('#moderateGrams').value;
  if (grams !== '' && Number.isFinite(Number(grams))) {
    data.grams = String(Math.round(Number(grams)));
  }
  return data;
}

async function approveCurrentTea() {
  const tea = currentModerationTea;
  if (!tea) return;
  const user = getUser();
  if (!user) return showToast('Сначала войдите', 'warn');

  const edited = collectModerateData();
  let ok = true;
  ok = setInvalid($('#moderateName').closest('.field'), !edited.name) && ok;
  ok = setInvalid($('#moderateType').closest('.field'), !edited.type) && ok;
  if (!ok) return;

  const btn = $('#moderateApproveBtn');
  btn.disabled = true;
  btn.textContent = 'Публикуем…';

  const { error } = await supabase.rpc('approve_tea', {
    p_tea_id: tea.id,
    p_moderator_id: user.id,
    p_edited_data: edited,
  });

  btn.disabled = false;
  btn.textContent = '✅ Одобрить';

  if (error) return showToast('Ошибка одобрения: ' + error.message, 'warn');

  closeOverlay($('#moderateOverlay'));
  showToast(`✅ «${edited.name}» опубликован в каталоге`);
  trackEvent('tea_approved', { tea_id: tea.id, tea_name: edited.name });

  await Promise.all([loadModeration(), refresh()]);
  render();
}

function openRejectOverlay() {
  if (!currentModerationTea) return;
  $('#rejectReason').value = '';
  $('#rejectDuplicate').checked = false;
  openOverlay($('#rejectOverlay'));
}

async function rejectCurrentTea() {
  const tea = currentModerationTea;
  if (!tea) return;
  const user = getUser();
  if (!user) return showToast('Сначала войдите', 'warn');

  const reason = $('#rejectReason').value.trim();
  const duplicate = $('#rejectDuplicate').checked;

  const btn = $('#rejectForm [type="submit"]');
  btn.disabled = true;

  const { error } = await supabase.rpc('reject_tea', {
    p_tea_id: tea.id,
    p_moderator_id: user.id,
    p_reason: reason || null,
    p_duplicate_exists: duplicate,
  });

  btn.disabled = false;
  if (error) return showToast('Ошибка отклонения: ' + error.message, 'warn');

  closeOverlay($('#rejectOverlay'));
  closeOverlay($('#moderateOverlay'));
  showToast(duplicate
    ? `❌ Заявка «${tea.name}» отклонена и удалена как дубликат`
    : `❌ Заявка «${tea.name}» отклонена`);
  trackEvent('tea_rejected', { tea_id: tea.id, tea_name: tea.name, duplicate });

  await Promise.all([loadModeration(), refresh()]);
  render();
}

// ============================================================
// РЕДАКТИРОВАНИЕ карточки (модератор с вкл. тумблером — любые,
// автор — свои pending)
// ============================================================
function openEditTeaModal(tea) {
  const ov = $('#editTeaOverlay');
  if (!ov) {
    showToast('Модалка редактирования не найдена', 'warn');
    return;
  }

  $('#editTeaId').value = tea.id;
  $('#editTeaName').value = tea.name || '';
  $('#editTeaType').value =
    Object.keys(TYPE_TO_DB).find(
      (key) => TYPE_TO_DB[key] === String(tea.type || '').toLowerCase()
    ) || '';
  $('#editTeaOrigin').value = tea.region || '';
  $('#editTeaDescription').value = tea.description || '';
  $('#editTeaTemp').value = tea.temp || '';
  $('#editTeaTime').value = tea.time || '';
  $('#editTeaGrams').value = tea.grams ?? '';
  $('#editTeaSteeps').value = tea.steeps || '';
  $('#editTeaTags').value = tea.tags || '';
  $('#editTeaPhotoUrl').value = tea.photo_url || '';

  // Показываем текущее фото
  const img = $('#editTeaCurrentPhoto');
  if (tea.photo_url) {
    img.src = tea.photo_url;
    img.classList.remove('hidden');
  } else {
    img.classList.add('hidden');
  }

  openOverlay(ov);
}

async function saveEditedTea(formData) {
  const user = getUser();
  if (!user) { showToast('Сначала войдите', 'warn'); return false; }

  const updates = {
    name: formData.name,
    type: String(TYPE_TO_DB[formData.type] || formData.type).toLowerCase(),
    region: formData.region,
    description: formData.description,
    temp: formData.temp,
    time: formData.time,
    steeps: formData.steeps,
    tags: formData.tags,
    photo_url: formData.photo_url,
  };
  if (formData.grams !== '' && formData.grams != null &&
      Number.isFinite(Number(formData.grams))) {
    updates.grams = String(Number(formData.grams));
  }

  const { error } = await supabase.rpc('update_tea', {
    p_tea_id: Number(formData.id),
    p_user_id: user.id,
    p_edited_data: updates,
  });

  if (error) {
    showToast('Не удалось сохранить: ' + error.message, 'warn');
    return false;
  }

  showToast('✅ Чай обновлён');
  await load(); // перезагружаем каталог
  return true;
}

// ---------- Предложить чай ----------
function initPropose() {
  const ov = $('#proposeOverlay');
  wireOverlay(ov);
  $('#proposeClose').addEventListener('click', () => closeOverlay(ov));
  $('#proposeCancel').addEventListener('click', () => closeOverlay(ov));

  const open = () => { if (getUser()) openOverlay(ov); };
  $('#proposeTeaBtn').addEventListener('click', open);
  $('#emptyProposeBtn')?.addEventListener('click', open);

  $('#proposeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = getUser();
    if (!user) return;

    const name = $('#proposeName').value.trim();
    const type = $('#proposeType').value;

    let ok = true;
    ok = setInvalid($('#proposeName').closest('.field'), !name) && ok;
    ok = setInvalid($('#proposeType').closest('.field'), !type) && ok;
    if (!ok) return;

    const { error } = await supabase.from(TABLES.catalog).insert({
      name,
      type: TYPE_TO_DB[type] || type,
      region: $('#proposeOrigin').value.trim() || null,
      description: $('#proposeDescription').value.trim() || null,
      status: 'pending',
      author_id: user.id,
    });
    if (error) return showToast('Ошибка заявки: ' + error.message, 'warn');

    closeOverlay(ov);
    e.target.reset();
    showToast('Заявка отправлена на модерацию');
    trackEvent('tea_proposed', { tea_name: name, type: TYPE_TO_DB[type] || type });
    await load();
  });
}

// ---------- Загрузка фото (с SEO-папками и SEO-именами) ----------
async function uploadPhoto(file, teaType, teaName = null) {
  const bucketName = 'tea-photos';
  const fileExt = file.name.split('.').pop().toLowerCase();

  // ФИКС (webp/avif): явно сообщаем Storage MIME-тип файла.
  // Без этого webp/avif сохранялись как application/octet-stream,
  // и браузер отказывался рисовать их как изображения (без ошибки
  // в консоли — просто битая картинка).
  const MIME_FALLBACK = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    avif: 'image/avif',
    gif: 'image/gif',
  };
  const contentType = file.type || MIME_FALLBACK[fileExt] || 'image/jpeg';

  // Создаём SEO-оптимизированную папку по типу чая
  const seoType = getSeoTypeName(teaType);

  // Создаём SEO-оптимизированное имя файла из названия чая
  let baseName = teaName ? seoSlugify(teaName) : 'tea';

  // Добавляем timestamp для уникальности
  const fileName = `${baseName}-${Date.now()}.${fileExt}`;

  // Полный путь: {тип}/{название}-{timestamp}.{ext}
  const path = seoType ? `${seoType}/${fileName}` : fileName;

  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType,   // ← вот она, лечебная строка
    });

  if (error) {
    showToast('Ошибка загрузки фото: ' + error.message, 'warn');
    return null;
  }

  // Получаем публичный URL
  const { data: { publicUrl } } = supabase.storage
    .from(bucketName)
    .getPublicUrl(path);

  return publicUrl;
}

// ---------- Старт ----------
async function init() {
  await initCommon();
  initAmountModal();

  // ----- Тумблер режимов Каталог / Модерация -----
  $('#modeSwitch')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (!btn || btn.classList.contains('active')) return;
    setMode(btn.dataset.mode);
  });

  // ----- Модалка модерации (одобрить / отклонить) -----
  const modOv = $('#moderateOverlay');
  if (modOv) {
    wireOverlay(modOv);
    $('#moderateClose')?.addEventListener('click', () => closeOverlay(modOv));
    $('#moderateApproveBtn')?.addEventListener('click', approveCurrentTea);
    $('#moderateRejectBtn')?.addEventListener('click', openRejectOverlay);
  }

  const rejOv = $('#rejectOverlay');
  if (rejOv) {
    wireOverlay(rejOv);
    $('#rejectClose')?.addEventListener('click', () => closeOverlay(rejOv));
    $('#rejectCancel')?.addEventListener('click', () => closeOverlay(rejOv));
    $('#rejectForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      rejectCurrentTea();
    });
  }

  // ----- Инициализация модалки редактирования -----
  const editOv = $('#editTeaOverlay');
  if (editOv) {
    wireOverlay(editOv);
    $('#editTeaClose')?.addEventListener('click', () => closeOverlay(editOv));
    $('#editTeaCancel')?.addEventListener('click', () => closeOverlay(editOv));

    // Обработка загрузки фото
    $('#editTeaPhotoInput')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const teaType = $('#editTeaType').value;
      const teaName = $('#editTeaName').value.trim();

      const btn = $('#editTeaUploadBtn');
      btn.disabled = true;
      btn.textContent = 'Загрузка...';

      const photoUrl = await uploadPhoto(file, teaType, teaName);
      if (photoUrl) {
        $('#editTeaPhotoUrl').value = photoUrl;
        const img = $('#editTeaCurrentPhoto');
        img.src = photoUrl;
        img.classList.remove('hidden');
        showToast('✅ Фото загружено');
      }

      btn.disabled = false;
      btn.textContent = 'Загрузить фото';
    });

    // Сохранение изменений
    $('#editTeaForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const formData = {
        id: $('#editTeaId').value,
        name: $('#editTeaName').value.trim(),
        type: $('#editTeaType').value,
        region: $('#editTeaOrigin').value.trim(),
        description: $('#editTeaDescription').value.trim(),
        temp: $('#editTeaTemp').value.trim(),
        time: $('#editTeaTime').value.trim(),
        grams: $('#editTeaGrams').value,
        steeps: $('#editTeaSteeps').value.trim(),
        tags: $('#editTeaTags').value.trim(),
        photo_url: $('#editTeaPhotoUrl').value.trim(),
      };

      const success = await saveEditedTea(formData);
      if (success) {
        closeOverlay(editOv);
      }
    });
  }

  // Поиск с дебаунсом: запрос к БД через 350 мс после последней буквы
  let searchTimer = null;
  $('#catalogSearch').addEventListener('input', (e) => {
    state.q = e.target.value.trim().toLowerCase();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refresh, 350);
  });

  // Неделя 4: фильтр по типу
  $('#catalogTypeFilter')?.addEventListener('change', (e) => {
    state.type = e.target.value;
    refresh();
  });

  $('#catalogSort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    refresh();
  });

  $('#moreBtn').addEventListener('click', loadMore);

  const grid = $('#catalogGrid');
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.tcard');
    if (!card) return;
    const tea = (viewMode === 'moderation' ? pendingAll : teas)
      .find((t) => String(t.id) === card.dataset.teaId);
    if (!tea) return;

    if (e.target.closest('[data-action="add-to-shelf"]')) return requestAdd(tea);
    if (e.target.closest('.heart')) return toggleFavorite(tea);
    // Игнорируем клик по кнопке редактирования
    if (e.target.closest('.edit-tea-btn')) return;

    // В режиме модерации клик по карточке = проверка заявки
    if (viewMode === 'moderation') {
      openModerateModal(tea);
      return;
    }

    currentTea = tea;
    openTeaModal(tea, teas);
    trackEvent('tea_card_opened', { tea_id: tea.id, tea_name: tea.name });
    syncFavBtn(tea);
    // кнопка «На полку» в модалке: скрыта, если чай уже на полке или pending
    $('#addToShelfBtn')?.classList.toggle('hidden',
      myShelf.has(tea.id) || tea.status === 'pending');
  });

  // Кнопка «На полку» внутри карточки чая
  $('#addToShelfBtn')?.addEventListener('click', () => {
    if (currentTea) requestAdd(currentTea);
  });

  // Кнопка избранного внутри карточки чая
  $('#wishlistBtn')?.addEventListener('click', () => {
    if (currentTea) toggleFavorite(currentTea);
  });

  initPropose();

  // Перезагрузка при входе/выходе и при переключении тумблера.
  // Если режим выключили или прав больше нет — уходим из модерации.
  onAuthChange(() => {
    if (viewMode === 'moderation' && !isModerationActive()) {
      viewMode = 'catalog';
    }
    load().catch((err) => console.warn('[catalog reload]', err));
  });

  try {
    await load();
  } catch (err) {
    grid.setAttribute('aria-busy', 'false');
    grid.innerHTML = `<div class="empty grid-col-span">
      <h3>Не удалось загрузить каталог</h3>
      <p>${escapeHtml(err.message || 'Проверьте подключение и ключи Supabase.')}</p>
      <button class="btn btn-primary" type="button" onclick="location.reload()">
        Повторить
      </button>
    </div>`;
  }
}

init();