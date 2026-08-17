// ============================================================
// catalog.js — логика страницы catalog.html
// Словарь БД: status='published', автор — author_id,
// типы по-русски, region/temp/time — text, tags — text
// Блок B: «Избранное» вместо «хотелок»: сердце на карточке и
// кнопка в модалке пишут в таблицу wishlist (единый список
// избранного). Починена мёртвая кнопка «Хочу попробовать».
// Блок C: серверная пагинация — по 20 карточек за запрос,
// поиск и сортировка на сервере, кнопка «Показать ещё».
// ============================================================
import { initCommon } from './common.js';
import { supabase } from './supabaseClient.js';
import { TABLES } from './config.js';
import {
  $, showToast, openOverlay, closeOverlay, wireOverlay,
  setInvalid, escapeHtml, plural, typeClass, TYPE_TO_DB, toTags,
} from './ui.js';
import { getUser } from './auth.js';
import { openTeaModal } from './teaModal.js';
import { initAmountModal, openAmountModal } from './amountModal.js';

const PAGE_SIZE = 20;

let published = [];   // загруженные страницы published
let pending = [];     // мои pending-заявки (все, их мало)
let teas = [];        // pending + published (для поиска по клику)
let myShelf = new Set();
let favorites = new Set();
let currentTea = null;

let loadedCount = 0;  // сколько published загружено в текущем запросе
let canMore = false;  // возможно, в базе есть ещё
let loading = false;

const state = { q: '', sort: 'popular' };

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

// ---------- Серверный запрос: поиск + сортировка + страница ----------
function pageQuery(offset) {
  let q = supabase.from(TABLES.catalog).select('*')
    .eq('status', 'published');
  if (state.q) {
    q = q.or(`name.ilike.%${state.q}%,region.ilike.%${state.q}%`);
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
  render();
  renderMore();
}

// ---------- Поиск / сортировка: перезагрузка первой страницы ----------
async function refresh() {
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
  if (loading || !canMore) return;
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
  $('#moreWrap').classList.toggle('hidden', !canMore);
  const btn = $('#moreBtn');
  btn.disabled = false;
  btn.textContent = 'Показать ещё';
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

  const onShelf = myShelf.has(tea.id);
  node.querySelector('.onshelf').classList.toggle('hidden', !onShelf);
  node.querySelector('[data-action="add-to-shelf"]')
    .classList.toggle('hidden', onShelf || tea.status === 'pending');

  node.querySelector('.heart').classList.toggle('on', favorites.has(tea.id));
  return node;
}

function render() {
  const grid = $('#catalogGrid');
  grid.setAttribute('aria-busy', 'false');
  grid.innerHTML = '';

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

// ---------- Избранное (Блок B) ----------
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
  } else {
    const { error } = await supabase.from(TABLES.wishlist)
      .insert({ user_id: user.id, tea_id: tea.id });
    if (error) return showToast('Не удалось добавить: ' + error.message, 'warn');
    favorites.add(tea.id);
    showToast(`«${tea.name}» — в избранном`);
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
    await load();
  });
}

// ---------- Старт ----------
async function init() {
  await initCommon();
  initAmountModal();

  // Поиск с дебаунсом: запрос к БД через 350 мс после последней буквы
  let searchTimer = null;
  $('#catalogSearch').addEventListener('input', (e) => {
    state.q = e.target.value.trim().toLowerCase();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refresh, 350);
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
    const tea = teas.find((t) => String(t.id) === card.dataset.teaId);
    if (!tea) return;

    if (e.target.closest('[data-action="add-to-shelf"]')) return requestAdd(tea);
    if (e.target.closest('.heart')) return toggleFavorite(tea);

    currentTea = tea;
    openTeaModal(tea, teas);
    syncFavBtn(tea);
    // кнопка «На полку» в модалке: скрыта, если чай уже на полке или pending
    $('#addToShelfBtn')?.classList.toggle('hidden',
      myShelf.has(tea.id) || tea.status === 'pending');
  });

  // Кнопка «На полку» внутри карточки чая
  $('#addToShelfBtn')?.addEventListener('click', () => {
    if (currentTea) requestAdd(currentTea);
  });

  // Кнопка избранного внутри карточки чая (Блок B)
  $('#wishlistBtn')?.addEventListener('click', () => {
    if (currentTea) toggleFavorite(currentTea);
  });

  initPropose();

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