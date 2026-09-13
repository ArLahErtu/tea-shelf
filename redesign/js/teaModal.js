// ============================================================
// teaModal.js — общая каталожная карточка чая (используют
// catalog.html и shelf.html)
// Словарь БД (фактический): region, temp ('80°C'), time ('20–30 сек'),
// grams (число), steeps (текст, напр. '6–8'), tags — text.
// Блок 1: исправлен крах (typeChipClass не импортировался),
// поля приведены к реальной схеме, сетка параметров собирается
// из .bgrid без зависимости от старых id.
// ============================================================
import {
  $, openOverlay, wireOverlay, escapeHtml,
  typeClass, toTags,
} from './ui.js';

let wired = false;

// «зелёный» → «Зелёный»; для типов вне словаря (матте, матча, красный…)
const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function closeIt(ov) {
  ov.classList.remove('show');
  setTimeout(() => { ov.hidden = true; }, 200);
}

export function openTeaModal(tea, allTeas = []) {
  const ov = $('#teaOverlay');
  if (!ov) return;

  if (!wired) {
    wireOverlay(ov);
    $('#teaClose')?.addEventListener('click', () =>
      ov.classList.contains('show') && closeIt(ov));
    $('#teaCloseFooter')?.addEventListener('click', () => closeIt(ov));
    wired = true;
  }

  // ---------- Шапка и медиа ----------
  $('#teaTitle').textContent = tea.name;

  const img = $('#teaImage');
  const ph  = $('#teaPlaceholder');
  if (tea.photo_url) {
    img.src = tea.photo_url;
    img.alt = tea.name;
    img.classList.remove('hidden');
    ph.classList.add('hidden');
  } else {
    img.classList.add('hidden');
    ph.classList.remove('hidden');
  }

  const chip = $('#teaTypeChip');
  chip.textContent = capFirst(tea.type || '—');
  chip.className = 'typechip ' + typeClass(tea.type);

  $('#teaOrigin').textContent = tea.region || '—';
  $('#teaDescription').textContent = tea.description || 'Описания пока нет.';

  // ---------- Параметры заваривания ----------
  // Пересобираем .bgrid под реальные колонки БД:
  // температура / время / доза / проливы.
  const bgrid = $('.bgrid', ov);
  if (bgrid) {
    const cells = [
      { v: tea.temp || '–',                       l: 'температура' },
      { v: tea.time || '–',                       l: 'время' },
      { v: tea.grams ? `${tea.grams} г` : '–',    l: 'доза' },
      { v: tea.steeps != null && tea.steeps !== '' ? String(tea.steeps) : '–', l: 'проливов' },
    ];
    bgrid.innerHTML = '';
    cells.forEach((c) => {
      const d = document.createElement('div');
      d.className = 'bcell';
      const v = document.createElement('div');
      v.className = 'v';
      v.textContent = c.v;
      const l = document.createElement('div');
      l.className = 'l';
      l.textContent = c.l;
      d.append(v, l);
      bgrid.appendChild(d);
    });
  }

  // ---------- Теги ----------
  const tagsBox = $('#teaTags');
  const tags = toTags(tea.tags);
  tagsBox.innerHTML = '';
  tags.forEach((t) => {
    const s = document.createElement('span');
    s.className = 'tag';
    s.textContent = t;
    tagsBox.appendChild(s);
  });
  tagsBox.hidden = !tags.length;

  // ---------- Похожие чаи ----------
  const simBox = $('#teaSimilar');
  simBox.innerHTML = '';
  const similar = allTeas
    .filter((t) => t.id !== tea.id && t.type === tea.type)
    .slice(0, 3);
  if (similar.length) {
    similar.forEach((s) => {
      const row = document.createElement('div');
      row.className = 'sim';
      row.innerHTML =
        `<span class="sthumb">` +
        (s.photo_url
          ? `<img src="${escapeHtml(s.photo_url)}" alt="" loading="lazy">`
          : `<svg viewBox="0 0 24 24"><path d="M5 20c0-8 5-13 14-15-1 9-6 14-14 15Z"/></svg>`) +
        `</span> <span><b>${escapeHtml(s.name)}</b> <span>${escapeHtml(s.region || '')}</span></span>`;
      row.addEventListener('click', () => openTeaModal(s, allTeas));
      simBox.appendChild(row);
    });
  } else {
    simBox.innerHTML = '<p class="hint">Похожих чаёв пока нет.</p>';
  }

  openOverlay(ov);
}