// ============================================================
// shelf.js — логика страницы shelf.html
// Словарь БД: status='published', автор — author_id,
// типы по-русски, регион — region, время журнала — created_at
// Блок 3: заваривание через RPC brew_tea (атомарно, +popularity),
// дубли полки обрабатываются по коду 23505.
// ============================================================
import { initCommon } from './common.js';
import { supabase } from './supabaseClient.js';
import { TABLES } from './config.js';
import {
  $, $$, showToast, openOverlay, closeOverlay, wireOverlay,
  escapeHtml, plural, formatDate, typeClass, TYPE_TO_DB, UNIT_LABELS,
  askConfirm,
} from './ui.js';
import { getUser, onAuthChange } from './auth.js';
import { openTeaModal } from './teaModal.js';
import { initAmountModal, openAmountModal } from './amountModal.js';

let shelf = [];        // строки user_shelf + .tea
let journal = [];
let requests = [];
let wishlist = [];     // tea_id из таблицы wishlist
let catalogAll = [];
let brewRow = null;
let brewRating = 0;
let currentRow = null; // строка полки, открытая в каталожной модалке

const filters = { status: 'all', type: 'all', sort: 'ending' };

const statusOf = (r) =>
  r.amount <= 0 ? 'finished'
  : (r.amount <= (r.low_threshold ?? 0) ? 'low' : 'available');

// ---------- Загрузка ----------
async function load() {
  const user = getUser();
  if (!user) { shelf = []; journal = []; requests = []; wishlist = []; return; }

  const [sh, j, rq, cat, wl] = await Promise.all([
    supabase.from(TABLES.shelf).select('*').eq('user_id', user.id),
    supabase.from(TABLES.journal).select('*').eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase.from(TABLES.catalog).select('*')
      .eq('status', 'pending').eq('author_id', user.id),
    supabase.from(TABLES.catalog).select('*'),
    supabase.from(TABLES.wishlist).select('tea_id').eq('user_id', user.id),
  ]);

  // Клиентский фильтр: чужие pending-заявки не должны попадать в полку/модалки
  const uid = user.id;
  catalogAll = (cat.data || [])
    .filter((t) => t.status === 'published' || t.author_id === uid);

  const teaById = new Map(catalogAll.map((t) => [t.id, t]));
  shelf = (sh.data || []).map((r) => ({
    ...r,
    tea: teaById.get(r.tea_id) || { name: 'Чай', type: '—', region: '' },
  }));
  journal = j.data || [];
  requests = rq.data || [];
  wishlist = (wl.data || []).map((r) => r.tea_id);
}

// ---------- Статистика ----------
function renderStats() {
  const rated = journal.filter((j) => j.rating);
  $('#statTeas').textContent = shelf.length || '0';
  $('#statBrews').textContent = journal.length || '0';
  $('#statRating').textContent = rated.length
    ? (rated.reduce((s, j) => s + j.rating, 0) / rated.length).toFixed(1)
    : '–';
  $('#statRestock').textContent =
    shelf.filter((r) => statusOf(r) !== 'available').length || '0';
}

// ---------- Что докупить ----------
function renderShopping() {
  const box = $('#shoppingList');
  const rows = shelf.filter((r) => statusOf(r) !== 'available');
  $('#shoppingCount').textContent = rows.length;
  box.innerHTML = '';
  if (!rows.length) {
    box.innerHTML = '<p class="hint">Список пуст. Когда чай закончится или его станет мало, он появится здесь.</p>';
    $('#restockSelectedBtn').disabled = true;
    return;
  }
  rows.forEach((r) => {
    const node = document.createElement('div');
    node.className = 'buyrow';
    node.dataset.shelfId = r.id;
    node.innerHTML = `<label class="buy-check"> <input type="checkbox" checked aria-label="Выбрать к закупке"> </label> <div class="buy-info"> <b>${escapeHtml(r.tea.name)}</b> <span class="${statusOf(r) === 'low' ? 'st-low' : 'st-fin'}"> ${statusOf(r) === 'low' ? 'Мало' : 'Закончился'} · осталось ${r.amount} ${UNIT_LABELS[r.unit] || 'г'} </span> </div> <div class="buy-amt"> <input type="number" min="1" step="1" value="50" inputmode="numeric" aria-label="Количество к дозакупке"> <em>${UNIT_LABELS[r.unit] || 'г'}</em> </div>`;
    box.appendChild(node);
  });
  $('#restockSelectedBtn').disabled = false;
}

// ---------- Хотелки ----------
function renderWishlist() {
  const box = $('#wishlistList');
  box.innerHTML = '';
  const teas = catalogAll.filter((t) => wishlist.includes(t.id));
  if (!teas.length) {
    box.innerHTML = '<p class="hint">Пока пусто. Отмечайте чаи сердцем в каталоге.</p>';
    return;
  }
  const tpl = $('#wishlistRowTemplate');
  teas.forEach((t) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.teaId = t.id;
    node.querySelector('b').textContent = t.name;
    node.querySelector('span').textContent = t.region || 'Хочу попробовать';
    box.appendChild(node);
  });
}

// ---------- Модерация ----------
function renderModeration() {
  const box = $('#moderationList');
  $('#moderationCount').textContent = requests.length;
  box.innerHTML = '';
  if (!requests.length) {
    box.innerHTML = '<p class="hint">Заявок пока нет.</p>';
    return;
  }
  const tpl = $('#moderationRowTemplate');
  requests.forEach((r) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelector('b').textContent = r.name;
    node.querySelector('span').textContent =
      'Заявка от ' + (r.created_at ? formatDate(r.created_at) : '—');
    box.appendChild(node);
  });
}

// ---------- Сетка полки ----------
function renderGrid() {
  const grid = $('#shelfGrid');
  grid.setAttribute('aria-busy', 'false');
  grid.innerHTML = '';
  const user = getUser();
  if (!user) {
    grid.innerHTML = `<div class="empty grid-col-span"> <h3>Полка доступна после входа</h3> <p>Остатки и журнал привязаны к аккаунту.</p> <button class="btn btn-primary" type="button" data-auth-required="true">Войти</button> </div>`;
    return;
  }
  $('#countAll').textContent = shelf.length;
  $('#countAvailable').textContent = shelf.filter((r) => statusOf(r) === 'available').length;
  $('#countLow').textContent = shelf.filter((r) => statusOf(r) === 'low').length;
  $('#countFinished').textContent = shelf.filter((r) => statusOf(r) === 'finished').length;

  if (!shelf.length) {
    grid.innerHTML = `<div class="empty grid-col-span"> <h3>Полка пока пуста</h3> <p>Добавьте первый чай из каталога — остатки и заваривания будут привязаны к вашему аккаунту.</p> <a class="btn btn-primary" href="catalog.html">Добавить из каталога</a> </div>`;
    return;
  }

  const list = shelf
    .filter((r) =>
      (filters.status === 'all' || statusOf(r) === filters.status) &&
      (filters.type === 'all' || r.tea.type === TYPE_TO_DB[filters.type]))
    .sort((a, b) => {
      if (filters.sort === 'ending') return a.amount - b.amount;
      if (filters.sort === 'name') return a.tea.name.localeCompare(b.tea.name, 'ru');
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });

  if (!list.length) {
    grid.innerHTML = `<div class="empty grid-col-span"> <h3>Ничего не найдено</h3> <p>Попробуйте другой фильтр.</p> </div>`;
    return;
  }
  list.forEach((r) => grid.appendChild(cardNode(r)));
}

function cardNode(r) {
  const node = $('#shelfCardTemplate').content.firstElementChild.cloneNode(true);
  node.dataset.shelfId = r.id;
  node.dataset.teaId = r.tea_id;

  const st = statusOf(r);
  const pill = node.querySelector('.pill');
  pill.className = 'pill ' + { available: 'pill-active', low: 'pill-low', finished: 'pill-finished' }[st];
  pill.lastChild.textContent = { available: 'В наличии', low: 'Мало', finished: 'Закончился' }[st];

  const chip = node.querySelector('.typechip');
  chip.textContent = r.tea.type || '—';
  chip.className = 'typechip ' + typeClass(r.tea.type);

  const brews = journal.filter((j) => j.tea_id === r.tea_id);
  const rated = brews.filter((j) => j.rating);
  const rate = node.querySelector('.rate-badge');
  if (rated.length) {
    rate.textContent = '★ ' + (rated.reduce((s, j) => s + j.rating, 0) / rated.length).toFixed(1);
    rate.classList.remove('hidden');
  }

  node.querySelector('.card-name').textContent = r.tea.name;
  node.querySelector('.qty').innerHTML =
    `${r.amount}<span> ${UNIT_LABELS[r.unit] || 'г'}</span>`;
  node.querySelector('.brews').textContent =
    `${brews.length} ${plural(brews.length, ['заваривание', 'заваривания', 'завариваний'])}`;

  const fill = node.querySelector('.bar-fill');
  fill.className = 'bar-fill ' + { available: 'bar-active', low: 'bar-low', finished: 'bar-finished' }[st];
  fill.style.width = Math.max(4, Math.min(100, (r.amount / 150) * 100)) + '%';

  node.querySelector('.fav-btn').classList.toggle('on', !!r.favorite);
  node.classList.toggle('low-ring', st === 'low');
  return node;
}

// ---------- Журнал ----------
function renderJournal() {
  const box = $('#journalList');
  box.innerHTML = '';
  if (!journal.length) {
    box.innerHTML = '<p class="hint">Записи появятся после первого заваривания.</p>';
    return;
  }
  const teaById = new Map(catalogAll.map((t) => [t.id, t]));
  journal.slice(0, 20).forEach((j) => {
    const node = document.createElement('div');
    node.className = 'jentry';
    node.innerHTML =
      `<div class="jdate">${j.created_at ? formatDate(j.created_at) : '—'}</div> <div class="jbody"> <b>${escapeHtml(teaById.get(j.tea_id)?.name || 'Чай')}</b> <div class="jm">${j.amount} ${UNIT_LABELS[j.unit] || 'г'}</div> ${j.note ? `<div class="jnote">${escapeHtml(j.note)}</div>` : ''} ${j.rating ? `<div class="jstars">${'★'.repeat(j.rating)}${'☆'.repeat(5 - j.rating)}</div>` : ''} </div>`;
    box.appendChild(node);
  });
}

function renderAll() {
  renderStats();
  renderShopping();
  renderWishlist();
  renderModeration();
  renderGrid();
  renderJournal();
  const low = shelf.filter((r) => statusOf(r) !== 'available').length;
  $('#shelfBanner').classList.toggle('hidden', !low);
  if (low) {
    $('#shelfBannerText').textContent =
      `${low} ${plural(low, ['чай заканчивается', 'чая заканчиваются', 'чаёв заканчиваются'])}.`;
  }
}

// ---------- Заваривание (RPC brew_tea) ----------
function initBrew() {
  const ov = $('#brewOverlay');
  wireOverlay(ov);
  $('#brewClose').addEventListener('click', () => closeOverlay(ov));
  $('#brewCancel').addEventListener('click', () => closeOverlay(ov));

  const amount = $('#brewAmount');
  const preview = () => {
    if (!brewRow) return;
    const left = Math.max(0, brewRow.amount - Number(amount.value || 0));
    $('#brewRemaining').textContent = `${left} ${UNIT_LABELS[brewRow.unit] || 'г'}`;
  };
  amount.addEventListener('input', preview);

  $('#brewPresets').addEventListener('click', (e) => {
    const b = e.target.closest('.preset');
    if (!b) return;
    $$('#brewPresets .preset').forEach((p) => p.classList.remove('sel'));
    b.classList.add('sel');
    amount.value = b.dataset.amount;
    preview();
  });

  $('#brewStars').addEventListener('click', (e) => {
    const b = e.target.closest('.star-btn');
    if (!b) return;
    brewRating = Number(b.dataset.value);
    $$('#brewStars .star-btn').forEach((s) => {
      s.classList.toggle('on', Number(s.dataset.value) <= brewRating);
      s.setAttribute('aria-checked', String(s === b));
    });
  });

  $('#brewForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!brewRow) return;
    const used = Number(amount.value);
    if (!used || used <= 0) return showToast('Укажите количество', 'warn');
    if (used > brewRow.amount) return showToast('На полке меньше этого количества', 'warn');

    // Одна транзакция на сервере: списание + журнал + popularity
    const { data, error } = await supabase.rpc('brew_tea', {
      p_shelf_id: brewRow.id,
      p_amount: used,
      p_rating: brewRating || null,
      p_note: $('#brewNote').value.trim() || null,
    });
    if (error) return showToast('Ошибка: ' + error.message, 'warn');

    closeOverlay(ov);
    showToast(`Заваривание записано ☕ Осталось ${data} ${UNIT_LABELS[brewRow.unit] || 'г'}`);
    await load();
    renderAll();
  });
}

function openBrew(row) {
  brewRow = row;
  brewRating = 0;
  $('#brewTeaName').textContent = row.tea.name;
  $('#brewTeaId').value = row.tea_id;
  $('#brewAmount').value = Math.min(7, row.amount) || 1;
  $('#brewNote').value = '';
  $$('#brewStars .star-btn').forEach((s) => {
    s.classList.remove('on');
    s.setAttribute('aria-checked', 'false');
  });
  $$('#brewPresets .preset').forEach((p) => p.classList.remove('sel'));
  openOverlay($('#brewOverlay'));
  $('#brewAmount').dispatchEvent(new Event('input'));
}

// ---------- Операции с количеством (amountModal) ----------
// Пополнение: добавка к текущему остатку
function restockRow(row) {
  openAmountModal({
    mode: 'restock',
    teaName: row.tea.name,
    unit: row.unit,
    onSubmit: async (p) => {
      await supabase.from(TABLES.shelf)
        .update({ amount: row.amount + p.amount }).eq('id', row.id);
      showToast(`Пополнено на ${p.amount} ${UNIT_LABELS[row.unit] || 'г'}`);
      await load(); renderAll();
    },
  });
}

// Точная установка остатка
function editAmount(row) {
  openAmountModal({
    mode: 'set',
    teaName: row.tea.name,
    unit: row.unit,
    amount: row.amount,
    onSubmit: async (p) => {
      await supabase.from(TABLES.shelf)
        .update({ amount: p.amount }).eq('id', row.id);
      showToast('Остаток обновлён');
      await load(); renderAll();
    },
  });
}

// Удаление с полки — через фирменную модалку подтверждения
async function removeRow(row) {
  const ok = await askConfirm({
    title: 'Убрать с полки',
    text: `Убрать «${row.tea.name}» с полки? История завариваний останется в журнале.`,
    okLabel: 'Убрать',
  });
  if (!ok) return;
  await supabase.from(TABLES.shelf).delete().eq('id', row.id);
  showToast('Чай убран с полки');
  await load(); renderAll();
}

async function toggleFav(row) {
  await supabase.from(TABLES.shelf).update({ favorite: !row.favorite }).eq('id', row.id);
  await load(); renderAll();
}

// Хотелка → полка: количество и порог выбирает пользователь
function addFromWishlist(teaId) {
  const tea = catalogAll.find((t) => String(t.id) === String(teaId));
  if (!tea) return;
  if (shelf.some((r) => r.tea_id === tea.id)) {
    return showToast('Этот чай уже на полке', 'warn');
  }
  openAmountModal({
    mode: 'add',
    teaName: tea.name,
    onSubmit: async (p) => {
      const user = getUser();
      const { error } = await supabase.from(TABLES.shelf).insert({
        user_id: user.id,
        tea_id: tea.id,
        amount: p.amount,
        unit: p.unit,
        low_threshold: p.threshold,
      });
      if (error) {
        // 23505 = unique_violation: чай уже на полке
        if (error.code === '23505') return showToast('Этот чай уже на полке', 'warn');
        return showToast('Не удалось добавить: ' + error.message, 'warn');
      }
      await supabase.from(TABLES.wishlist).delete()
        .eq('user_id', user.id).eq('tea_id', tea.id);
      showToast(`«${tea.name}» добавлен на полку`);
      await load(); renderAll();
    },
  });
}

// ---------- Пополнить выбранные ----------
function initRestock() {
  $('#restockSelectedBtn').addEventListener('click', async () => {
    const jobs = [];
    $$('#shoppingList .buyrow').forEach((node) => {
      if (!node.querySelector('input[type="checkbox"]').checked) return;
      const row = shelf.find((r) => String(r.id) === node.dataset.shelfId);
      const qty = Number(node.querySelector('input[type="number"]').value) || 0;
      if (row && qty > 0) {
        jobs.push(supabase.from(TABLES.shelf)
          .update({ amount: row.amount + qty }).eq('id', row.id));
      }
    });
    if (!jobs.length) return showToast('Отметьте хотя бы одну позицию', 'warn');
    await Promise.all(jobs);
    $('#shoppingSuccess').classList.remove('hidden');
    setTimeout(() => $('#shoppingSuccess').classList.add('hidden'), 3000);
    showToast('Полка пополнена');
    await load(); renderAll();
  });
}

// ---------- Хотелки: клики ----------
function initWishlist() {
  $('#wishlistList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="add-from-wishlist"]');
    if (!btn) return;
    const row = btn.closest('.wrow');
    addFromWishlist(row.dataset.teaId);
  });
}

// ---------- Фильтры ----------
function initFilters() {
  $$('.tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tabs .tab').forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-pressed', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-pressed', 'true');
      filters.status = tab.dataset.status;
      renderGrid();
    });
  });
  $('#shelfTypeFilter').addEventListener('change', (e) => { filters.type = e.target.value; renderGrid(); });
  $('#shelfSort').addEventListener('change', (e) => { filters.sort = e.target.value; renderGrid(); });
}

// ---------- Старт ----------
async function init() {
  await initCommon();
  initAmountModal();
  initFilters();
  initBrew();
  initRestock();
  initWishlist();

  // Кнопки каталожной модалки на странице полки
  $('#addToShelfBtn')?.addEventListener('click', () => {
    if (currentRow) restockRow(currentRow); // «Пополнить» из модалки
  });
  $('#wishlistBtn')?.addEventListener('click', async () => {
    if (currentRow) await toggleFav(currentRow);
  });

  $('#shelfGrid').addEventListener('click', async (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const row = shelf.find((r) => String(r.id) === card.dataset.shelfId);
    if (!row) return;
    if (e.target.closest('[data-action="brew"]'))            return openBrew(row);
    if (e.target.closest('[data-action="restock"]'))         return restockRow(row);
    if (e.target.closest('[data-action="edit"]'))            return editAmount(row);
    if (e.target.closest('[data-action="remove"]'))          return removeRow(row);
    if (e.target.closest('[data-action="toggle-favorite"]')) return toggleFav(row);
    if (e.target.closest('[data-action="open-menu"]')) {
      const menu = e.target.closest('.menu-wrap').querySelector('.menu');
      $$('#shelfGrid .menu').forEach((m) => m !== menu && m.classList.add('hidden'));
      menu.classList.toggle('hidden');
      return;
    }
    currentRow = row;
    openTeaModal(row.tea, catalogAll);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-wrap')) {
      $$('#shelfGrid .menu').forEach((m) => m.classList.add('hidden'));
    }
  });

  onAuthChange(async () => { await load(); renderAll(); });

  try {
    await load();
    renderAll();
  } catch (err) {
    $('#shelfGrid').setAttribute('aria-busy', 'false');
    $('#shelfGrid').innerHTML = `<div class="empty grid-col-span"> <h3>Не удалось загрузить полку</h3> <p>${escapeHtml(err.message || 'Проверьте подключение и ключи Supabase.')}</p> </div>`;
  }
}

init();