// ============================================================
// catalog.js — логика страницы catalog.html
// Блок 2: режим модерации + поиск по тегам + SEO-загрузка фото
// ============================================================
import { initCommon } from './common.js';
import { supabase } from './supabaseClient.js';
import { TABLES } from './config.js';
import {
  $, $$, showToast, openOverlay, closeOverlay, wireOverlay,
  setInvalid, escapeHtml, plural, typeClass, TYPE_TO_DB, toTags, trackEvent,
} from './ui.js';
import { getUser, isModerator } from './auth.js';
import { openTeaModal } from './teaModal.js';
import { initAmountModal, openAmountModal } from './amountModal.js';

const PAGE_SIZE = 20;

let published = [];
let pending = [];
let teas = [];
let myShelf = new Set();
let favorites = new Set();
let currentTea = null;
let moderatingTea = null;

let loadedCount = 0;
let canMore = false;
let loading = false;

const state = { q: '', sort: 'popular', type: 'all' };
const mode = { current: 'catalog' }; // 'catalog' | 'moderation'

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

// ---------- Серверный запрос (с поиском по тегам!) ----------
function pageQuery(offset) {
  let q = supabase.from(TABLES.catalog).select('*').eq('status', 'published');
  if (state.type !== 'all') {
    q = q.eq('type', state.type);
  }
  if (state.q) {
    // ДОБАВЛЕНО: поиск по тегам (tags.ilike)
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

// ---------- Загрузка ----------
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
      safeFetch(() => supabase.from(TABLES.shelf).select('tea_id').eq('user_id', user.id), 'shelf ids'),
      safeFetch(() => supabase.from(TABLES.wishlist).select('tea_id').eq('user_id', user.id), 'favorites ids'),
    ]);
    pending = p || [];
    myShelf = new Set((sh || []).map((r) => r.tea_id));
    favorites = new Set((wl || []).map((r) => r.tea_id));
  }
  teas = pending.concat(published);
  render();
  renderMore();
  updateModeSwitch();
}

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

// ---------- Блок 2: загрузка pending-заявок для модерации ----------
async function loadPendingForModeration() {
  if (!isModerator()) return;
  try {
    const { data, error } = await supabase.rpc('get_pending_teas');
    if (error) {
      console.error('[loadPendingForModeration] ошибка:', error.message);
      return;
    }
    pending = data || [];
    $('#pendingCount').textContent = pending.length;
    render();
  } catch (e) {
    console.error('[loadPendingForModeration] exception:', e);
  }
}

// ---------- Блок 2: обновление тумблера ----------
function updateModeSwitch() {
  const modeSwitch = $('#modeSwitch');
  if (!modeSwitch) return;
  modeSwitch.classList.toggle('hidden', !isModerator());
  $('#pendingCount').textContent = pending.length;

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('moderation') === '1' && isModerator()) {
    switchMode('moderation');
    const url = new URL(window.location);
    url.searchParams.delete('moderation');
    window.history.replaceState({}, '', url);
  }
}

// ---------- Блок 2: переключение режимов ----------
function switchMode(newMode) {
  mode.current = newMode;
  $$('.mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === newMode);
  });
  if (newMode === 'moderation') {
    loadPendingForModeration();
  } else {
    refresh();
  }
}

// ---------- SEO-оптимизация ----------
function transliterate(text) {
  if (!text) return '';
  const ru = { 'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya' };
  return text.toLowerCase().split('').map(char => ru[char] || char).join('');
}

function seoSlugify(text) {
  if (!text) return 'tea';
  return transliterate(text).replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60);
}

function getSeoTypeName(type) {
  if (!type) return 'other';
  const typeMap = { 'зелёный':'green','зеленый':'green','чёрный':'black','черный':'black','улун':'oolong','пуэр':'puerh','белый':'white','жёлтый':'yellow','желтый':'yellow','красный':'red','хэй ча':'hei-cha','хэйча':'hei-cha','цветочный':'floral','матте':'matte','матча':'matcha','травяной':'herbal','смесь':'blend','купаж':'blend' };
  const lowerType = type.toLowerCase();
  return typeMap[lowerType] || lowerType.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// ---------- SEO-загрузка фото ----------
async function uploadPhoto(file, teaType, teaName = null) {
  const bucketName = 'tea-photos';
  const fileExt = file.name.split('.').pop().toLowerCase();
  const seoType = getSeoTypeName(teaType);
  let baseName = teaName ? seoSlugify(teaName) : 'tea';
  const fileName = `${baseName}-${Date.now()}.${fileExt}`;
  const path = seoType ? `${seoType}/${fileName}` : fileName;

  const { data, error } = await supabase.storage.from(bucketName).upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) {
    showToast('Ошибка загрузки фото: ' + error.message, 'warn');
    return null;
  }
  const { data: { publicUrl } } = supabase.storage.from(bucketName).getPublicUrl(path);
  return publicUrl;
}

// ---------- Рендер ----------
function cardNode(tea) {
  const node = $('#teaCardTemplate').content.firstElementChild.cloneNode(true);
  node.dataset.teaId = tea.id;

  if (tea.status === 'pending' && mode.current === 'moderation') {
    node.classList.add('pending');
  }

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
  node.querySelector('.brewline').textContent = [tea.temp, tea.time].filter(Boolean).join(' · ');

  const tagrow = node.querySelector('.tagrow');
  toTags(tea.tags).slice(0, 3).forEach((t) => {
    const s = document.createElement('span');
    s.className = 'tag';
    s.textContent = t;
    tagrow.appendChild(s);
  });

  const pop = tea.popularity || 0;
  node.querySelector('.pop').textContent = pop ? `${pop} ${plural(pop, ['заваривание', 'заваривания', 'завариваний'])} у пользователей` : '';

  node.querySelector('.pendbadge').classList.toggle('hidden', tea.status !== 'pending' || mode.current !== 'moderation');

  const onShelf = myShelf.has(tea.id);
  node.querySelector('.onshelf').classList.toggle('hidden', !onShelf);
  
  const addToShelfBtn = node.querySelector('[data-action="add-to-shelf"]');
  addToShelfBtn.classList.toggle('hidden', onShelf || tea.status === 'pending' || mode.current === 'moderation');

  node.querySelector('.heart').classList.toggle('on', favorites.has(tea.id));
  if (tea.status === 'pending' && mode.current === 'moderation') {
    node.querySelector('.heart').classList.add('hidden');
  }

  return node;
}

function render() {
  const grid = $('#catalogGrid');
  grid.setAttribute('aria-busy', 'false');
  grid.innerHTML = '';

  const list = mode.current === 'moderation' ? pending : teas;

  if (!list.length) {
    const msg = mode.current === 'moderation'
      ? '<h3>Заявок на модерацию нет</h3><p>Все заявки рассмотрены.</p>'
      : '<h3>Ничего не найдено</h3><p>Попробуйте изменить запрос или сортировку.</p>';
    grid.innerHTML = `<div class="empty grid-col-span">${msg}</div>`;
    return;
  }
  list.forEach((t) => grid.appendChild(cardNode(t)));
}

// ---------- Избранное и действия ----------
function syncFavBtn(tea) {
  const label = $('#wishlistBtnText');
  if (!label || !tea) return;
  label.textContent = favorites.has(tea.id) ? 'В избранном ✓' : 'В избранное';
}

async function toggleFavorite(tea) {
  const user = getUser();
  if (!user) { showToast('Сначала войдите', 'warn'); return; }
  if (favorites.has(tea.id)) {
    await supabase.from(TABLES.wishlist).delete().eq('user_id', user.id).eq('tea_id', tea.id);
    favorites.delete(tea.id);
  } else {
    const { error } = await supabase.from(TABLES.wishlist).insert({ user_id: user.id, tea_id: tea.id });
    if (error) return showToast('Не удалось добавить: ' + error.message, 'warn');
    favorites.add(tea.id);
  }
  syncFavBtn(tea);
  render();
}

async function addToShelf(tea, payload) {
  const user = getUser();
  if (!user || myShelf.has(tea.id)) return showToast('Этот чай уже на полке', 'warn');
  const { error } = await supabase.from(TABLES.shelf).insert({
    user_id: user.id, tea_id: tea.id, amount: payload.amount, unit: payload.unit, low_threshold: payload.threshold,
  });
  if (error) {
    if (error.code === '23505') { myShelf.add(tea.id); render(); return showToast('Этот чай уже на полке', 'warn'); }
    return showToast('Не удалось добавить: ' + error.message, 'warn');
  }
  myShelf.add(tea.id);
  showToast(`✅ «${tea.name}» добавлен на полку`);
  render();
}

function requestAdd(tea) {
  if (!getUser()) { showToast('Сначала войдите', 'warn'); return; }
  openAmountModal({ mode: 'add', teaName: tea.name, onSubmit: (p) => addToShelf(tea, p) });
}

// ---------- Блок 2: модалка модерации ----------
function initModerate() {
  const ov = $('#moderateOverlay');
  if (!ov) return;
  wireOverlay(ov);
  $('#moderateClose')?.addEventListener('click', () => closeOverlay(ov));

  // Загрузка фото в модалке модерации
  $('#moderatePhotoInput')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !moderatingTea) return;
    const btn = $('#moderatePhotoUploadBtn');
    btn.disabled = true;
    btn.textContent = 'Загрузка...';
    
    const photoUrl = await uploadPhoto(file, moderatingTea.type, moderatingTea.name);
    if (photoUrl) {
      $('#moderatePhoto').value = photoUrl;
      showToast('✅ Фото загружено в SEO-папку');
    }
    btn.disabled = false;
    btn.textContent = 'Загрузить фото';
  });

  $('#moderateApproveBtn')?.addEventListener('click', async () => {
    if (!moderatingTea) return;
    const name = $('#moderateName').value.trim();
    const type = $('#moderateType').value;
    let ok = true;
    ok = setInvalid($('#moderateName').closest('.field'), !name) && ok;
    ok = setInvalid($('#moderateType').closest('.field'), !type) && ok;
    if (!ok) return;

    const editedData = {
      name, type,
      region: $('#moderateRegion').value.trim() || null,
      description: $('#moderateDescription').value.trim() || null,
      temp: $('#moderateTemp').value.trim() || null,
      time: $('#moderateTime').value.trim() || null,
      grams: $('#moderateGrams').value ? parseFloat($('#moderateGrams').value) : null,
      steeps: $('#moderateSteeps').value.trim() || null,
      photo_url: $('#moderatePhoto').value.trim() || null,
      tags: $('#moderateTags').value.trim() || null,
    };

    const user = getUser();
    const { error } = await supabase.rpc('approve_tea', {
      p_tea_id: moderatingTea.id, p_moderator_id: user.id, p_edited_data: editedData,
    });

    if (error) { showToast('Ошибка одобрения: ' + error.message, 'warn'); return; }
    closeOverlay(ov);
    showToast(`✅ «${name}» одобрен и опубликован`);
    await loadPendingForModeration();
  });

  $('#moderateRejectBtn')?.addEventListener('click', () => {
    if (!moderatingTea) return;
    closeOverlay(ov);
    openRejectModal(moderatingTea);
  });
}

function openRejectModal(tea) {
  const ov = $('#rejectOverlay');
  if (!ov) return;
  $('#rejectReason').value = '';
  $('#rejectDuplicate').checked = false;
  openOverlay(ov);
}

function initReject() {
  const ov = $('#rejectOverlay');
  if (!ov) return;
  wireOverlay(ov);
  $('#rejectClose')?.addEventListener('click', () => closeOverlay(ov));
  $('#rejectCancel')?.addEventListener('click', () => closeOverlay(ov));

  $('#rejectForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!moderatingTea) return;
    const reason = $('#rejectReason').value.trim() || null;
    const isDuplicate = $('#rejectDuplicate').checked;
    const user = getUser();
    const { error } = await supabase.rpc('reject_tea', {
      p_tea_id: moderatingTea.id, p_moderator_id: user.id, p_reason: reason, p_duplicate_exists: isDuplicate,
    });
    if (error) { showToast('Ошибка отклонения: ' + error.message, 'warn'); return; }
    closeOverlay(ov);
    showToast(`❌ Чай ${isDuplicate ? 'удалён (дубликат)' : 'отклонён'}`);
    await loadPendingForModeration();
  });
}

function openModerateModal(tea) {
  moderatingTea = tea;
  $('#moderateName').value = tea.name || '';
  $('#moderateType').value = tea.type || '';
  $('#moderateRegion').value = tea.region || '';
  $('#moderateDescription').value = tea.description || '';
  $('#moderateTemp').value = tea.temp || '';
  $('#moderateTime').value = tea.time || '';
  $('#moderateGrams').value = tea.grams || '';
  $('#moderateSteeps').value = tea.steeps || '';
  $('#moderatePhoto').value = tea.photo_url || '';
  $('#moderateTags').value = tea.tags || '';
  checkDuplicate(tea.name);
  openOverlay($('#moderateOverlay'));
}

async function checkDuplicate(name) {
  const warn = $('#moderateDuplicateWarn');
  if (!warn) return;
  const { data, error } = await supabase.from(TABLES.catalog).select('id, name').eq('status', 'published').ilike('name', `%${name}%`);
  if (error || !data || data.length === 0) { warn.classList.add('hidden'); return; }
  warn.classList.remove('hidden');
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
      name, type: TYPE_TO_DB[type] || type, region: $('#proposeOrigin').value.trim() || null,
      description: $('#proposeDescription').value.trim() || null, status: 'pending', author_id: user.id,
    });
    if (error) return showToast('Ошибка заявки: ' + error.message, 'warn');
    closeOverlay(ov);
    e.target.reset();
    showToast('Заявка отправлена на модерацию');
    trackEvent('tea_proposed', { tea_name: name, type: TYPE_TO_DB[type] || type });
    await load();
  });
}

// ---------- Старт ----------
async function init() {
  await initCommon();
  initAmountModal();

  let searchTimer = null;
  $('#catalogSearch').addEventListener('input', (e) => {
    state.q = e.target.value.trim().toLowerCase();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refresh, 350);
  });

  $('#catalogTypeFilter')?.addEventListener('change', (e) => { state.type = e.target.value; refresh(); });
  $('#catalogSort').addEventListener('change', (e) => { state.sort = e.target.value; refresh(); });
  $('#moreBtn').addEventListener('click', loadMore);

  $('#modeSwitch')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (!btn) return;
    switchMode(btn.dataset.mode);
  });

  $('#openModerationBtn')?.addEventListener('click', () => {
    if (isModerator()) switchMode('moderation');
  });

  const grid = $('#catalogGrid');
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.tcard');
    if (!card) return;
    const tea = teas.find((t) => String(t.id) === card.dataset.teaId) || pending.find((t) => String(t.id) === card.dataset.teaId);
    if (!tea) return;

    if (e.target.closest('[data-action="add-to-shelf"]')) return requestAdd(tea);
    if (e.target.closest('.heart')) return toggleFavorite(tea);

    if (mode.current === 'moderation' && tea.status === 'pending') {
      return openModerateModal(tea);
    }

    currentTea = tea;
    openTeaModal(tea, teas);
    trackEvent('tea_card_opened', { tea_id: tea.id, tea_name: tea.name });
    syncFavBtn(tea);
    $('#addToShelfBtn')?.classList.toggle('hidden', myShelf.has(tea.id) || tea.status === 'pending');
  });

  $('#addToShelfBtn')?.addEventListener('click', () => { if (currentTea) requestAdd(currentTea); });
  $('#wishlistBtn')?.addEventListener('click', () => { if (currentTea) toggleFavorite(currentTea); });

  initPropose();
  initModerate();
  initReject();

  try {
    await load();
  } catch (err) {
    grid.setAttribute('aria-busy', 'false');
    grid.innerHTML = `<div class="empty grid-col-span"><h3>Не удалось загрузить каталог</h3><p>${escapeHtml(err.message || 'Проверьте подключение.')}</p><button class="btn btn-primary" type="button" onclick="location.reload()">Повторить</button></div>`;
  }
}

init();