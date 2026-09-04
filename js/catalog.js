// ============================================================
// catalog.js — логика страницы catalog.html
// Словарь БД: status='published', автор — author_id,
// типы по-русски, region/temp/time — text, tags — text
// Блок B: «Избранное» вместо «хотелок» (таблица wishlist).
// Блок C: серверная пагинация по 20 + «Показать ещё».
// Неделя 4: серверный фильтр по типу чая; события Метрики.
// БЛОК 1 (этап 3): ПОЛНОЦЕННАЯ МОДЕРАЦИЯ —
//   • роль берётся из auth.js (user_roles), без хардкода email;
//   • режим модератора — ТУМБЛЕР (isModerationActive);
//   • одобрение/отклонение через RPC approve_tea / reject_tea;
//   • редактирование любых карточек через RPC update_tea;
//   • фикс фильтра по типу (ilike, регистронезависимо);
//   • URL синхронизирован с режимом (?moderation=1).
// ФОТО v5: оригинал (webp/avif — вес и SEO) + терпеливая проверка.
//   Если бакет отверг формат/размер — автоконвертация в JPEG
//   и повтор, пользователь ошибку не видит.
//   ЭТАП 0: добавлен обработчик загрузки фото из модалки модерации.
// ЭТАП 5: Тизаны в каталоге — отдельный тип, состав трав.
// ============================================================
import { initCommon } from './common.js';
import { supabase } from './supabaseClient.js';
import { TABLES, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
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
let tisanes = [];     // тизаны из tisane_catalog
let myShelf = new Set();
let favorites = new Set();
let currentTea = null;
let currentUser = null;
let currentModerationTea = null;
let moderationError = false;

let viewMode = 'catalog'; // 'catalog' | 'moderation'

let loadedCount = 0;
let canMore = false;
let loading = false;

const state = { q: '', sort: 'popular', type: 'all' };

// ---------- Справочник трав (для тизанов) ----------
let herbsById = new Map();

async function loadHerbs() {
  const { data } = await supabase.from('herbs').select('*').order('name');
  herbsById.clear();
  (data || []).forEach((h) => herbsById.set(h.id, h));
}

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
    q = q.ilike('type', state.type);
  }
  if (state.q) {
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

// ---------- Загрузка тизанов из tisane_catalog ----------
function tisaneQuery(offset) {
  let q = supabase.from('tisane_catalog').select('*');
  if (state.q) {
    const qq = state.q.toLowerCase();
    // Фильтруем по названию или свойствам
    q = q.or(`name.ilike.%${state.q}%`);
  }
  q = q.order('tisane_number', { ascending: true });
  return q.range(offset, offset + PAGE_SIZE - 1);
}

function loadPublished(offset = 0) {
  return safeFetch(() => pageQuery(offset), `catalog page ${offset}`);
}

function loadTisanes(offset = 0) {
  return safeFetch(() => tisaneQuery(offset), `tisane page ${offset}`);
}

// ---------- Модерация: загрузка ВСЕХ pending через RPC ----------
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
function syncUrlWithMode() {
  const url = new URL(location.href);
  if (viewMode === 'moderation') url.searchParams.set('moderation', '1');
  else url.searchParams.delete('moderation');
  history.replaceState(null, '', url.toString());
}

// ---------- Загрузка (старт / смена входа) ----------
async function load() {
  await loadHerbs(); // загружаем травы для тизанов

  const first = await loadPublished(0);
  if (first === null) {
    throw new Error('Нет соединения с базой. Проверь сеть/блокировщики и нажми «Повторить».');
  }
  published = first;
  loadedCount = first.length;
  canMore = first.length === PAGE_SIZE;

  // Загружаем тизаны
  const firstTisanes = await loadTisanes(0);
  tisanes = firstTisanes || [];

  pending = [];
  const user = getUser();
  currentUser = user;

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
    await loadModeration();
    render();
    return;
  }

  // Если выбран тип «Тизан» — загружаем тизаны
  if (state.type === 'tisane') {
    const first = await loadTisanes(0);
    if (first === null) return showToast('Не удалось обновить список', 'warn');
    tisanes = first;
    loadedCount = first.length;
    canMore = first.length === PAGE_SIZE;
    render();
    renderMore();
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

  // Если тип «Тизан» — загружаем тизаны
  if (state.type === 'tisane') {
    const next = await loadTisanes(loadedCount);
    loading = false;
    if (next === null) {
      btn.disabled = false;
      btn.textContent = 'Показать ещё';
      return showToast('Не удалось загрузить ещё. Нажмите снова', 'warn');
    }
    tisanes = tisanes.concat(next);
    loadedCount += next.length;
    canMore = next.length === PAGE_SIZE;
    render();
    renderMore();
    return;
  }

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
    const dbType = TYPE_TO_DB[state.type] || state.type;
    res = res.filter((t) =>
      String(t.type || '').toLowerCase() === dbType.toLowerCase());
  }
  if (state.sort === 'name') {
    res.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
  } else if (state.sort === 'popular') {
    res.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  } else {
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
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);
}

function getSeoTypeName(type) {
  if (!type) return 'other';
  const typeMap = {
    'зелёный': 'green', 'зеленый': 'green',
    'чёрный': 'black', 'черный': 'black',
    'улун': 'oolong', 'пуэр': 'puerh',
    'белый': 'white', 'жёлтый': 'yellow', 'желтый': 'yellow',
    'красный': 'red', 'хэй ча': 'hei-cha', 'хэйча': 'hei-cha',
    'цветочный': 'floral', 'матте': 'matte', 'матча': 'matcha',
    'травяной': 'herbal', 'смесь': 'blend', 'купаж': 'blend',
    'тизан': 'tisane',
  };
  const lowerType = type.toLowerCase();
  return typeMap[lowerType] || lowerType.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// ============================================================
// РЕНДЕР КАРТОЧКИ ЧАЯ (обычный чай из tea_catalog)
// ============================================================
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

  const canEdit = !inModeration && (
    isModerationActive() || (tea.author_id === currentUser?.id && tea.status === 'pending')
  );

  if (canEdit) {
    const editBtn = document.createElement('button');
    editBtn.className = 'edit-tea-btn';
    editBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16-1 4Z"/></svg>';
    editBtn.title = tea.status === 'pending' ? 'Редактировать заявку' : 'Редактировать чай';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditTeaModal(tea);
    });
    node.querySelector('.media-top').appendChild(editBtn);
  }

  return node;
}

// ============================================================
// РЕНДЕР КАРТОЧКИ ТИЗАНА (из tisane_catalog)
// ============================================================
function tisaneCardNode(tisane) {
  const node = document.createElement('article');
  node.className = 'tcard';
  node.dataset.tisaneId = tisane.id;

  const comp = (tisane.composition || [])
    .map((c) => {
      const herb = herbsById.get(c.herb_id);
      const name = herb ? escapeHtml(herb.name) : '—';
      return c.is_primary ? `<b>${name}</b>` : name;
    })
    .join(', ');

  const props = (tisane.properties || []);
  const displayName = tisane.name || `Тизан #${tisane.tisane_number}`;

  node.innerHTML = `
    <div class="tmedia">
      <div class="ph" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M5 20c0-8 5-13 14-15-1 9-6 14-14 15Z"/></svg>
      </div>
      <div class="media-top">
        <span class="typechip tc-tisane">Тизан</span>
      </div>
    </div>
    <div class="tbody">
      <h3 class="tname">${escapeHtml(displayName)}</h3>
      <p class="tdesc">${comp || 'Состав не указан'}</p>
      ${props.length ? `<div class="tagrow">${props.map((p) => `<span class="tag">${escapeHtml(p)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="tfoot">
      <span class="pop">#${tisane.tisane_number}</span>
      <button class="btn btn-outline btn-sm" type="button" data-action="add-tisane-to-shelf">На полку</button>
    </div>`;

  return node;
}

// ============================================================
// РЕНДЕР СЕТКИ
// ============================================================
function render() {
  const grid = $('#catalogGrid');
  grid.setAttribute('aria-busy', 'false');
  grid.innerHTML = '';

  // ----- Режим модерации -----
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

  // ----- Режим каталога: тизаны -----
  if (state.type === 'tisane') {
    if (!tisanes.length) {
      grid.innerHTML = `<div class="empty grid-col-span">
        <h3>Тизанов пока нет</h3>
        <p>Создайте первый сбор на странице «Полка» — он появится здесь.</p>
      </div>`;
      return;
    }
    tisanes.forEach((t) => grid.appendChild(tisaneCardNode(t)));
    return;
  }

  // ----- Режим каталога: обычный чай -----
  const list = teas;
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

// ---------- Добавление обычного чая на полку ----------
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
  $('#addToShelfBtn')?.classList.add('hidden');
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

// ---------- Добавление тизана на полку ----------
async function addToShelfTisane(tisane) {
  const user = getUser();
  if (!user) { showToast('Сначала войдите', 'warn'); return; }

  const displayName = tisane.name || `Тизан #${tisane.tisane_number}`;

  openAmountModal({
    mode: 'add',
    teaName: displayName,
    onSubmit: async (p) => {
      // Проверяем, есть ли уже такой тизан у пользователя
      const { data: existing } = await supabase.from('user_tisanes')
        .select('id, quantity')
        .eq('user_id', user.id)
        .eq('tisane_catalog_id', tisane.id)
        .maybeSingle();

      if (existing) {
        // Обновляем количество
        const { error } = await supabase.from('user_tisanes')
          .update({ quantity: Number(existing.quantity) + p.amount })
          .eq('id', existing.id);
        if (error) return showToast('Ошибка: ' + error.message, 'warn');
        showToast(`«${displayName}» пополнен на ${p.amount} ${p.unit === 'g' ? 'г' : p.unit}`);
      } else {
        // Создаём новую запись
        const { error } = await supabase.from('user_tisanes').insert({
          user_id: user.id,
          tisane_catalog_id: tisane.id,
          quantity: p.amount,
          quantity_unit: p.unit,
        });
        if (error) return showToast('Ошибка: ' + error.message, 'warn');
        showToast(`«${displayName}» добавлен на полку`);
      }
      trackEvent('tea_added_to_shelf', { tisane_id: tisane.id, unit: p.unit });
    },
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

  const img = $('#moderateCurrentPhoto');
  if (img) {
    if (tea.photo_url) {
      img.src = tea.photo_url;
      img.classList.remove('hidden');
    } else {
      img.classList.add('hidden');
    }
  }

  $('#moderateDuplicateWarn').classList.add('hidden');
  checkDuplicate(tea);

  openOverlay(ov);
}

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
// РЕДАКТИРОВАНИЕ карточки
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
  await load();
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

// ============================================================
// ФОТО v8: сырой fetch с ЯВНЫМ Content-Type + сессионный токен
// ============================================================
const PHOTO_BUCKET = 'tea-photos';

const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', avif: 'image/avif', gif: 'image/gif',
};

function isFormatOrSizeError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return /mime|content-?type|invalid request|exceeded the allowed size|too large/.test(msg)
    || /413|415/.test(String(err?.message));
}

async function convertToJpeg(file, maxSide = 1600) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('canvas.toBlob вернул null');
  return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
    type: 'image/jpeg',
  });
}

async function rawStorageUpload(path, body, mime) {
  const { data: { session } } = await supabase.auth.getSession();
  const url = `${SUPABASE_URL}/storage/v1/object/${PHOTO_BUCKET}/${path}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
      'Content-Type': mime,
      'x-upsert': 'false',
      'cache-control': 'public, max-age=3600',
    },
    body,
  });

  if (!res.ok) {
    let detail = `${res.status}`;
    try { detail += ' ' + (await res.text()); } catch (e) { /* ignore */ }
    throw new Error(detail);
  }

  return `${SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`;
}

async function verifyServedImage(url) {
  for (let i = 1; i <= 3; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const ct = (res.headers.get('content-type') || '').split(';')[0].trim();
      console.info(`[uploadPhoto] проверка ${i} →`, res.status, ct);
      if (res.ok && ct.startsWith('image/')) return true;
    } catch (e) {
      console.warn('[uploadPhoto] проверка сорвалась:', e);
    }
  }
  return false;
}

async function uploadPhoto(file, teaType, teaName = null) {
  const seoType = getSeoTypeName(teaType);
  const baseName = teaName ? seoSlugify(teaName) : 'tea';

  const ext = file.name.split('.').pop().toLowerCase();
  const mime = file.type || MIME_BY_EXT[ext] || 'image/jpeg';

  const doUpload = async (f, m, e) => {
    const path = seoType
      ? `${seoType}/${baseName}-${Date.now()}.${e}`
      : `${baseName}-${Date.now()}.${e}`;
    try {
      return { publicUrl: await rawStorageUpload(path, f, m) };
    } catch (err) {
      return { error: err };
    }
  };

  let res = await doUpload(file, mime, ext);

  if (res.error && isFormatOrSizeError(res.error)) {
    console.warn('[uploadPhoto] оригинал отклонён:', res.error.message);
    try {
      const jpeg = await convertToJpeg(file);
      const retry = await doUpload(jpeg, 'image/jpeg', 'jpg');
      if (!retry.error) {
        showToast('ℹ️ Хранилище не приняло формат — сохранено как JPG');
        res = retry;
      } else {
        showToast('Ошибка загрузки фото: ' + res.error.message, 'warn');
        return null;
      }
    } catch (e) {
      console.warn('[uploadPhoto] конвертация не удалась:', e);
      showToast('Ошибка загрузки фото: ' + res.error.message, 'warn');
      return null;
    }
  } else if (res.error) {
    showToast('Ошибка загрузки фото: ' + res.error.message, 'warn');
    console.error('[uploadPhoto]', res.error);
    return null;
  }

  const servedOk = await verifyServedImage(res.publicUrl);
  if (servedOk) return res.publicUrl;

  try {
    const jpeg = await convertToJpeg(file);
    const res2 = await doUpload(jpeg, 'image/jpeg', 'jpg');
    if (res2.error) {
      showToast('Ошибка загрузки фото: ' + res2.error.message, 'warn');
      return res.publicUrl;
    }
    showToast('ℹ️ Сервер не принял формат — сохранено как JPG');
    return res2.publicUrl;
  } catch (e) {
    console.warn('[uploadPhoto] конвертация не удалась:', e);
    return res.publicUrl;
  }
}

// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================
async function init() {
  await initCommon();
  initAmountModal();

  // ----- Тумблер режимов Каталог / Модерация -----
  $('#modeSwitch')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (!btn || btn.classList.contains('active')) return;
    setMode(btn.dataset.mode);
  });

  // ----- Модалка модерации -----
  const modOv = $('#moderateOverlay');
  if (modOv) {
    wireOverlay(modOv);
    $('#moderateClose')?.addEventListener('click', () => closeOverlay(modOv));
    $('#moderateApproveBtn')?.addEventListener('click', approveCurrentTea);
    $('#moderateRejectBtn')?.addEventListener('click', openRejectOverlay);
  }

  // Загрузка фото из модалки модерации
  $('#moderatePhotoInput')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const teaType = $('#moderateType').value;
    const teaName = $('#moderateName').value.trim();

    const btn = $('#moderatePhotoUploadBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Загрузка...'; }

    const photoUrl = await uploadPhoto(file, teaType, teaName);
    if (photoUrl) {
      $('#moderatePhoto').value = photoUrl;
      const img = $('#moderateCurrentPhoto');
      if (img) { img.src = photoUrl; img.classList.remove('hidden'); }
      showToast('✅ Фото загружено');
    }

    if (btn) { btn.disabled = false; btn.textContent = 'Загрузить фото'; }
  });

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

  // ----- Модалка редактирования -----
  const editOv = $('#editTeaOverlay');
  if (editOv) {
    wireOverlay(editOv);
    $('#editTeaClose')?.addEventListener('click', () => closeOverlay(editOv));
    $('#editTeaCancel')?.addEventListener('click', () => closeOverlay(editOv));

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

  // Поиск с дебаунсом
  let searchTimer = null;
  $('#catalogSearch').addEventListener('input', (e) => {
    state.q = e.target.value.trim().toLowerCase();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refresh, 350);
  });

  // Фильтр по типу
  $('#catalogTypeFilter')?.addEventListener('change', (e) => {
    state.type = e.target.value;
    refresh();
  });

  $('#catalogSort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    refresh();
  });

  $('#moreBtn').addEventListener('click', loadMore);

  // Клик по сетке
  const grid = $('#catalogGrid');
  grid.addEventListener('click', (e) => {
    // Клик по карточке тизана
    const tisaneCard = e.target.closest('[data-tisane-id]');
    if (tisaneCard) {
      const tisane = tisanes.find((t) => String(t.id) === tisaneCard.dataset.tisaneId);
      if (!tisane) return;

      if (e.target.closest('[data-action="add-tisane-to-shelf"]')) {
        return addToShelfTisane(tisane);
      }
      // Клик по карточке тизана — пока просто показываем информацию
      // (можно добавить модалку с деталями позже)
      return;
    }

    // Клик по карточке обычного чая
    const card = e.target.closest('.tcard');
    if (!card) return;
    const tea = (viewMode === 'moderation' ? pendingAll : teas)
      .find((t) => String(t.id) === card.dataset.teaId);
    if (!tea) return;

    if (e.target.closest('[data-action="add-to-shelf"]')) return requestAdd(tea);
    if (e.target.closest('.heart')) return toggleFavorite(tea);
    if (e.target.closest('.edit-tea-btn')) return;

    if (viewMode === 'moderation') {
      openModerateModal(tea);
      return;
    }

    currentTea = tea;
    openTeaModal(tea, teas);
    trackEvent('tea_card_opened', { tea_id: tea.id, tea_name: tea.name });
    syncFavBtn(tea);
    $('#addToShelfBtn')?.classList.toggle('hidden',
      myShelf.has(tea.id) || tea.status === 'pending');
  });

  $('#addToShelfBtn')?.addEventListener('click', () => {
    if (currentTea) requestAdd(currentTea);
  });

  $('#wishlistBtn')?.addEventListener('click', () => {
    if (currentTea) toggleFavorite(currentTea);
  });

  initPropose();

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