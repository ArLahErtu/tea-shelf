// ============================================================
// chatbot.js — умный чат с командами + режим ИИ (заглушка)
// + история диалогов (7 дней в localStorage)
// ============================================================

// ВАЖНО: сначала вставляем HTML, потом инициализируем логику
import './chatbotHTML.js';

import { $, $$, showToast, openOverlay } from './ui.js';
import { getUser } from './auth.js';
import { supabase } from './supabaseClient.js';
import { TABLES } from './config.js';
import { openAmountModal } from './amountModal.js';

let currentMode = 'bot'; // 'bot' или 'ai'
let shelfCache = null;
let catalogCache = null;
let journalCache = null;

// ---------- История диалогов ----------
const HISTORY_KEY = 'chatbot_history';
const HISTORY_DAYS = 7;

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const history = JSON.parse(raw);
    const weekAgo = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
    return history.filter(msg => msg.timestamp > weekAgo);
  } catch {
    return [];
  }
}

function saveHistory(msg) {
  const history = loadHistory();
  history.push({ ...msg, timestamp: Date.now() });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function renderHistory() {
  const history = loadHistory();
  const box = $('#chatbotMessages');
  if (!box) return;

  box.innerHTML = '';

  if (history.length === 0) {
    addMessage('Привет! Я помощник «Чайной полки». Напиши «Что ты можешь» — покажу все команды.', 'bot');
    return;
  }

  history.forEach(msg => {
    const m = document.createElement('div');
    m.className = 'chatbot-message ' + (msg.who === 'user' ? 'is-user' : 'is-bot');
    m.innerHTML = msg.text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
    box.appendChild(m);
  });

  box.scrollTop = box.scrollHeight;
}

// ---------- Парсер команд ----------
const COMMANDS = {
  add: {
    patterns: [/добавь\s+(.+?)\s+(\d+)\s*г/i, /положи\s+(.+?)\s+(\d+)\s*г/i],
    handler: handleAdd,
  },
  brew: {
    patterns: [/заварил\s+(.+?)\s+(\d+)\s*г/i, /заварива[юю]\s+(.+?)\s+(\d+)\s*г/i],
    handler: handleBrew,
  },
  remove: {
    patterns: [/удали\s+(.+)/i, /убери\s+(.+)/i, /сними\s+(.+)/i],
    handler: handleRemove,
  },
  check: {
    patterns: [/сколько\s+(.+?)\s+остал[оось]/i, /остаток\s+(.+)/i, /осталось\s+(.+)/i],
    handler: handleCheck,
  },
  shopping: {
    patterns: [/что докупить/i, /список покупок/i, /купить/i],
    handler: handleShopping,
  },
  stats: {
    patterns: [/статистик/i, /сколько ча[её]в/i, /мои чаи/i],
    handler: handleStats,
  },
  help: {
    patterns: [/что ты можешь/i, /помощь/i, /команды/i, /help/i],
    handler: handleHelp,
  },
};

// ---------- Обработчики команд ----------

async function handleAdd(match) {
  const teaName = match[1].trim();
  const amount = parseInt(match[2]);

  const tea = await findTeaInCatalog(teaName);
  if (!tea) {
    return `❌ Чай «${teaName}» не найден в каталоге. Попробуй добавить его через каталог или предложи новый чай.`;
  }

  const onShelf = await isTeaOnShelf(tea.id);
  if (onShelf) {
    return `⚠️ «${tea.name}» уже на полке (${onShelf.amount}г). Используй «Пополни ${tea.name} ${amount}г»`;
  }

  setTimeout(() => {
    openAmountModal({
      mode: 'add',
      teaName: tea.name,
      amount: amount,
      onSubmit: async (payload) => {
        const user = getUser();
        const { error } = await supabase.from(TABLES.shelf).insert({
          user_id: user.id,
          tea_id: tea.id,
          amount: payload.amount,
          unit: payload.unit,
          low_threshold: payload.threshold,
        });
        if (error) {
          showToast('Не удалось добавить: ' + error.message, 'warn');
          return;
        }
        showToast(`✅ «${tea.name}» добавлен на полку`);
        shelfCache = null;
      },
    });
  }, 100);

  return `📝 **Добавить «${tea.name}»:**\nКоличество: ${amount}г\nПорог "мало": 20г\n\nМодалка открыта — подтверди добавление.`;
}

async function handleBrew(match) {
  const teaName = match[1].trim();
  const amount = parseInt(match[2]);

  const row = await findTeaOnShelf(teaName);
  if (!row) {
    return `❌ «${teaName}» нет на полке. Сначала добавь чай.`;
  }

  if (row.amount < amount) {
    return `⚠️ Недостаточно чая: осталось ${row.amount}г, а ты хочешь ${amount}г.`;
  }

  setTimeout(() => {
    const ov = $('#brewOverlay');
    if (!ov) return;

    $('#brewTeaName').textContent = row.tea.name;
    $('#brewTeaId').value = row.tea_id;
    $('#brewAmount').value = amount;
    $('#brewNote').value = '';
    $$('#brewStars .star-btn').forEach((s) => {
      s.classList.remove('on');
      s.setAttribute('aria-checked', 'false');
    });

    openOverlay(ov);
    $('#brewAmount').dispatchEvent(new Event('input'));
  }, 100);

  return ` **Заваривание «${row.tea.name}»:**\nКоличество: ${amount}г\nОсталось после: ${row.amount - amount}г\n\nМодалка открыта — поставь оценку и нажми «Сохранить».`;
}

async function handleRemove(match) {
  const teaName = match[1].trim();

  const row = await findTeaOnShelf(teaName);
  if (!row) {
    return `❌ «${teaName}» нет на полке.`;
  }

  return {
    text: `❓ **Убрать «${row.tea.name}» с полки?**\nОстаток: ${row.amount}г`,
    actions: [
      { label: 'Да, убрать', action: 'confirm-remove', data: row.id },
      { label: 'Отмена', action: 'cancel' },
    ],
  };
}

async function handleCheck(match) {
  const teaName = match[1].trim();

  const row = await findTeaOnShelf(teaName);
  if (!row) {
    return `❌ «${teaName}» нет на полке.`;
  }

  const brews = await getTeaBrews(row.tea_id);
  const rated = brews.filter(b => b.rating);
  const avgRating = rated.length ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1) : null;

  let answer = `📊 **«${row.tea.name}»**\n`;
  answer += `Осталось: **${row.amount}${row.unit === 'g' ? 'г' : row.unit}**\n`;
  answer += `Завариваний: ${brews.length}`;
  if (avgRating) {
    answer += ` · Рейтинг: ${'★'.repeat(Math.round(avgRating))}${'☆'.repeat(5 - Math.round(avgRating))} (${avgRating})`;
  }
  if (row.amount <= (row.low_threshold || 0)) {
    answer += `\n⚠️ **Заканчивается!**`;
  }

  return answer;
}

async function handleShopping() {
  await loadShelfCache();
  const low = shelfCache.filter(r => r.amount > 0 && r.amount <= (r.low_threshold || 0));
  const finished = shelfCache.filter(r => r.amount <= 0);

  if (!low.length && !finished.length) {
    return '✅ Всё хорошо! Ничего не нужно докупать.';
  }

  let answer = '🛒 **Нужно докупить:**\n';
  finished.forEach(r => {
    answer += `❌ **«${r.tea.name}»** — закончился\n`;
  });
  low.forEach(r => {
    answer += `⚠️ **«${r.tea.name}»** — осталось ${r.amount}${r.unit === 'g' ? 'г' : r.unit}\n`;
  });

  return answer;
}

async function handleStats() {
  await loadShelfCache();
  await loadJournalCache();

  const rated = journalCache.filter(j => j.rating);
  const avgRating = rated.length ? (rated.reduce((s, j) => s + j.rating, 0) / rated.length).toFixed(1) : '–';

  let answer = '📊 **Твоя чайная статистика:**\n';
  answer += `Чай на полке: **${shelfCache.length}**\n`;
  answer += `Завариваний: **${journalCache.length}**\n`;
  answer += `Средний рейтинг: **${avgRating}**\n`;
  answer += `Заканчивается: **${shelfCache.filter(r => r.amount <= (r.low_threshold || 0)).length}**`;

  return answer;
}

async function handleHelp() {
  return `📋 **Что я умею:**\n\n` +
    `🛒 **Управление полкой:**\n` +
    `• «Добавь [чай] [кол-во]г» — добавить чай на полку\n` +
    `• «Заварил [чай] [кол-во]г» — записать заваривание\n` +
    `• «Убери [чай]» — убрать с полки\n` +
    `• «Сколько [чай] осталось?» — проверить остаток\n\n` +
    `📊 **Информация:**\n` +
    `• «Что докупить?» — список покупок\n` +
    `• «Статистика» — твоя чайная статистика\n\n` +
    `💡 **Примеры:**\n` +
    `• «Добавь Да Хун Пао 100г»\n` +
    `• «Заварил Сенча 5г»\n` +
    `• «Сколько Пуэр осталось?»`;
}

// ---------- Вспомогательные функции ----------

async function findTeaInCatalog(name) {
  await loadCatalogCache();
  const lower = name.toLowerCase();
  return catalogCache.find(t =>
    t.name.toLowerCase().includes(lower) ||
    lower.includes(t.name.toLowerCase())
  );
}

async function findTeaOnShelf(name) {
  await loadShelfCache();
  const lower = name.toLowerCase();
  return shelfCache.find(r =>
    r.tea.name.toLowerCase().includes(lower) ||
    lower.includes(r.tea.name.toLowerCase())
  );
}

async function isTeaOnShelf(teaId) {
  await loadShelfCache();
  return shelfCache.find(r => r.tea_id === teaId);
}

async function loadShelfCache() {
  const user = getUser();
  if (!user || shelfCache) return;

  const { data } = await supabase
    .from(TABLES.shelf)
    .select('*')
    .eq('user_id', user.id);

  shelfCache = data || [];
}

async function loadCatalogCache() {
  if (catalogCache) return;

  const { data } = await supabase
    .from(TABLES.catalog)
    .select('*')
    .eq('status', 'published');

  catalogCache = data || [];
}

async function loadJournalCache() {
  const user = getUser();
  if (!user || journalCache) return;

  const { data } = await supabase
    .from(TABLES.journal)
    .select('*')
    .eq('user_id', user.id);

  journalCache = data || [];
}

async function getTeaBrews(teaId) {
  const user = getUser();
  const { data } = await supabase
    .from(TABLES.journal)
    .select('*')
    .eq('user_id', user.id)
    .eq('tea_id', teaId);

  return data || [];
}

// ---------- Основная логика ----------

const FALLBACK = 'Не понимаю команду. Напиши «Что ты можешь» — покажу все доступные действия.';

async function findAnswer(text) {
  for (const [cmdName, cmd] of Object.entries(COMMANDS)) {
    for (const pattern of cmd.patterns) {
      const match = text.match(pattern);
      if (match) {
        return cmd.handler(match, text);
      }
    }
  }

  const RULES = [
    { keys: ['привет', 'здравств', 'hi'],
      answer: 'Привет! Я помощник «Чайной полки». Напиши «Что ты можешь» — покажу все команды.' },
    { keys: ['спасибо', 'благодар'],
      answer: 'Пожалуйста! Обращайся, если что-то нужно.' },
  ];

  const t = text.toLowerCase();
  const hit = RULES.find((r) => r.keys.some((k) => t.includes(k)));
  return hit ? hit.answer : FALLBACK;
}

async function askAI(text) {
  return '🤖 ИИ-ассистент пока в разработке. Скоро я смогу отвечать на любые вопросы о чае, подбирать сорта под настроение и давать рекомендации по завариванию!';
}

function addMessage(text, who, actions = null) {
  const box = $('#chatbotMessages');
  if (!box) return;

  const m = document.createElement('div');
  m.className = 'chatbot-message ' + (who === 'user' ? 'is-user' : 'is-bot');

  let html = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

  if (actions && actions.length > 0) {
    html += '<div class="chatbot-actions">';
    actions.forEach(action => {
      html += `<button class="action-btn" data-action="${action.action}" data-data="${action.data || ''}">${action.label}</button>`;
    });
    html += '</div>';
  }

  m.innerHTML = html;
  box.appendChild(m);
  box.scrollTop = box.scrollHeight;

  saveHistory({ text, who, actions });

  if (actions) {
    m.querySelectorAll('.action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const data = btn.dataset.data;

        if (action === 'confirm-remove') {
          const { error } = await supabase.from(TABLES.shelf).delete().eq('id', data);
          if (error) {
            showToast('Не удалось удалить: ' + error.message, 'warn');
            return;
          }
          addMessage('✅ Чай убран с полки', 'bot');
          shelfCache = null;
        } else if (action === 'cancel') {
          addMessage('Отменено', 'bot');
        }

        m.querySelector('.chatbot-actions')?.remove();
      });
    });
  }
}

function switchMode(mode) {
  currentMode = mode;
  $$('.chatbot-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  const hint = mode === 'ai'
    ? '🤖 ИИ-режим (пока заглушка)'
    : '💬 Обычный чат-бот с командами';
  showToast(hint);
}

export function initChatbot() {
  const fab    = $('#chatbotToggle');
  const win    = $('#chatbotWindow');
  const close  = $('#chatbotClose');
  const form   = $('#chatbotForm');
  const input  = $('#chatbotInput');
  if (!fab || !win) return;

  function setOpen(open) {
    win.hidden = !open;
    fab.setAttribute('aria-expanded', String(open));
    if (open) {
      input?.focus();
      renderHistory();
    }
  }

  fab.addEventListener('click', () => setOpen(win.hidden));
  close?.addEventListener('click', () => setOpen(false));

  async function send(text) {
    const msg = text.trim();
    if (!msg) return;
    addMessage(msg, 'user');

    const typingDiv = document.createElement('div');
    typingDiv.className = 'chatbot-message is-bot';
    typingDiv.textContent = 'Печатает...';
    typingDiv.style.opacity = '0.6';
    $('#chatbotMessages').appendChild(typingDiv);

    setTimeout(async () => {
      typingDiv.remove();

      let answer;
      if (currentMode === 'ai') {
        answer = await askAI(msg);
      } else {
        answer = await findAnswer(msg);
      }

      if (typeof answer === 'object' && answer.text) {
        addMessage(answer.text, 'bot', answer.actions);
      } else {
        addMessage(answer, 'bot');
      }
    }, 350);
  }

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    send(input.value);
    input.value = '';
  });

  $('#chatbotSuggestions')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.chatbot-suggestion');
    if (btn) send(btn.textContent);
  });

  $('#chatbotModeSwitch')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.chatbot-mode-btn');
    if (!btn || btn.disabled) return;
    switchMode(btn.dataset.mode);
  });

  const aiBtn = document.querySelector('.chatbot-mode-btn[data-mode="ai"]');
  if (aiBtn) {
    aiBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showToast('🤖 ИИ-ассистент скоро будет доступен!');
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !win.hidden) setOpen(false);
  });
}