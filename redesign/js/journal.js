// ============================================================
// journal.js — страница «Личный журнал» (редизайн v2).
// Лента завариваний: группы по дням, оценки, заметки, расход.
// Фильтры: поиск, чай, оценка/заметка. Переключение в архив.
// ============================================================
import { initCommon } from './common.js';
import { supabase, isConfigured } from './supabaseClient.js';
import { TABLES } from './config.js';
import { $, $$, escapeHtml, plural, UNIT_LABELS } from './ui.js';
import { getUser, onAuthChange } from './auth.js';

let journal = [];
let archive = [];
let names = new Map();      // tea_id -> name
let useArchive = false;

const filters = { q: '', tea: 'all', rate: 'all' };

const dayKey = (iso) => (iso ? iso.slice(0, 10) : '—');
const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' });
const shortFmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' });

function nameOf(j) {
  if (j.tisane_id) return names.get('t' + j.tisane_id) || 'Тизан';
  if (j.unknown_id) return names.get('u' + j.unknown_id) || 'Неизвестный чай';
  return names.get('c' + j.tea_id) || 'Чай';
}

// ---------- загрузка ----------
async function load() {
  const user = getUser();
  const feed = $('#journalFeed');
  if (!user || !isConfigured()) { journal = []; archive = []; render(); return; }

  const [j, a, c] = await Promise.all([
    supabase.from(TABLES.journal).select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
    supabase.from('brew_journal_archive').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(300),
    supabase.from(TABLES.catalog).select('id, name'),
  ]);
  journal = j.data || [];

  // ИСПРАВЛЕНИЕ: архивные слепки хранят записи внутри поля payload (jsonb) —
  // распаковываем их в плоский массив, чтобы filtered()/renderStats()/rowNode()
  // работали одинаково и с основным журналом, и с архивом.
  // Страховка: если внутри payload нет даты, берём дату создания самого слепка.
  archive = (a.data || []).flatMap((row) =>
    (row.payload || []).map((entry) => ({
      ...entry,
      created_at: entry.created_at || row.created_at
    }))
  );

  names = new Map((c.data || []).map((t) => ['c' + t.id, t.name]));

  // имена тизанов и неизвестных — из справочников пользователя
  const [tis, unk] = await Promise.all([
    supabase.from('user_tisanes').select('id, tisane_catalog(name)').eq('user_id', user.id),
    supabase.from('unknown_teas').select('id, name').eq('user_id', user.id),
  ]);
  (tis.data || []).forEach((r) => names.set('t' + r.id, r.tisane_catalog?.name || 'Тизан'));
  (unk.data || []).forEach((r) => names.set('u' + r.id, r.name || 'Неизвестный чай'));

  fillTeaFilter();
  render();
}

function fillTeaFilter() {
  const sel = $('#journalTeaFilter');
  const src = useArchive ? archive : journal;
  const used = [...new Set(src.map((j) => j.tea_id || j.tisane_id || j.unknown_id))];
  const options = used
    .map((id) => {
      const sample = src.find((j) => (j.tea_id || j.tisane_id || j.unknown_id) === id);
      return { id, name: nameOf(sample) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  sel.innerHTML = '<option value="all">Все чаи</option>' +
    options.map((o) => `<option value="${escapeHtml(String(o.id))}">${escapeHtml(o.name)}</option>`).join('');
  if (!options.some((o) => String(o.id) === filters.tea)) filters.tea = 'all';
  sel.value = filters.tea;
}

// ---------- фильтрация и рендер ----------
function filtered() {
  const src = useArchive ? archive : journal;
  const q = filters.q.trim().toLowerCase();
  return src.filter((j) => {
    if (filters.tea !== 'all' && String(j.tea_id || j.tisane_id || j.unknown_id) !== filters.tea) return false;
    if (filters.rate === '5' && j.rating !== 5) return false;
    if (filters.rate === '4' && !(j.rating >= 4)) return false;
    if (filters.rate === 'note' && !j.note) return false;
    if (q && !(nameOf(j).toLowerCase().includes(q) || String(j.note || '').toLowerCase().includes(q))) return false;
    return true;
  });
}

// ИСПРАВЛЕНИЕ: статистика теперь зависит от текущего источника (основной журнал
// или архив), поэтому все четыре виджета обновляются при переключении вкладки.
function renderStats() {
  const src = useArchive ? archive : journal;
  const rated = src.filter((j) => j.rating);
  const avg = rated.length ? (rated.reduce((s, j) => s + j.rating, 0) / rated.length) : 0;
  const monthAgo = Date.now() - 30 * 864e5;
  $('#jStatBrews').textContent = src.length || '0';
  $('#jStatRating').textContent = avg ? avg.toFixed(1).replace('.', ',') : '–';
  $('#jStatTeas').textContent = new Set(src.map((j) => j.tea_id || j.tisane_id || j.unknown_id)).size || '0';
  $('#jStatMonth').textContent = src.filter((j) => new Date(j.created_at).getTime() > monthAgo).length || '0';
}

function rowNode(j) {
  const el = document.createElement('div');
  el.className = 'jrow';
  const unit = UNIT_LABELS[j.unit] || 'г';
  el.innerHTML = `
    <span class="d">${escapeHtml(shortFmt.format(new Date(j.created_at)))}</span>
    <span class="n">${escapeHtml(nameOf(j))}
      ${j.note ? `<span class="note">${escapeHtml(j.note)}</span>` : ''}
      <span class="meta">${j.amount ?? '–'} ${escapeHtml(unit)}${useArchive ? ' · архив' : ''}</span>
    </span>
    <span class="st" ${j.rating ? `aria-label="Оценка ${j.rating} из 5"` : 'aria-hidden="true"'}>${j.rating ? '★'.repeat(j.rating) + '☆'.repeat(5 - j.rating) : '·'}</span>`;
  return el;
}

function render() {
  renderStats();
  const feed = $('#journalFeed');
  feed.setAttribute('aria-busy', 'false');
  const list = filtered();

  $('#journalCount').textContent = list.length
    ? `${list.length} ${plural(list.length, ['запись', 'записи', 'записей'])}`
    : '';

  if (!list.length) {
    feed.innerHTML = `<div class="empty" style="margin-top:26px">
      <h3>${useArchive ? 'Архив пуст' : 'Пока нет записей'}</h3>
      <p>${useArchive
        ? 'Сюда попадают записи после очистки основного журнала.'
        : 'Нажмите «Заварил» на полке — запись с оценкой и заметкой появится здесь.'}</p>
      <a class="btn btn-primary" href="shelf.html">Открыть полку</a>
    </div>`;
    return;
  }

  feed.innerHTML = '';
  let lastDay = null;
  let group = null;
  list.forEach((j) => {
    const k = dayKey(j.created_at);
    if (k !== lastDay) {
      lastDay = k;
      group = document.createElement('section');
      group.className = 'jgroup';
      group.innerHTML = `<h2>${escapeHtml(dayFmt.format(new Date(j.created_at)))}<span class="rule"></span></h2>`;
      feed.appendChild(group);
    }
    group.appendChild(rowNode(j));
  });
}

// ---------- таймер-заглушка для кнопки «Заварил» ----------
function initBrewEntry() {
  $$('[data-brew-choose]').forEach((b) => b.addEventListener('click', () => {
    location.href = 'shelf.html#brew';
  }));
}

async function init() {
  await initCommon();
  initBrewEntry();

  $('#journalSearch').addEventListener('input', (e) => { filters.q = e.target.value; render(); });
  $('#journalTeaFilter').addEventListener('change', (e) => { filters.tea = e.target.value; render(); });
  $('#journalRatingChips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    $$('#journalRatingChips .chip').forEach((x) => x.classList.remove('on'));
    c.classList.add('on');
    filters.rate = c.dataset.rate;
    render();
  });
  $('#openJournalArchiveBtn').addEventListener('click', () => {
    useArchive = !useArchive;
    $('#openJournalArchiveBtn').textContent = useArchive ? 'Основной журнал' : 'Архив журнала';
    fillTeaFilter();
    render();
  });

  onAuthChange(() => load());
  await load();
}

init();