// ============================================================
// chatbot.js — чат-помощник с выбором режима
// Режимы: 'bot' (обычный чат-бот) / 'ai' (ИИ-ассистент, пока заглушка)
// ============================================================
import { $, $$, showToast } from './ui.js';

let currentMode = 'bot'; // 'bot' или 'ai'

const RULES = [
  { keys: ['привет', 'здравств', 'hi'],
    answer: 'Привет! Я помощник «Чайной полки». Спросите про полку, покупки, журнал или каталог.' },
  { keys: ['докупить', 'покупк', 'закончил', 'мало'],
    answer: 'Список «Что докупить» собирается из чаёв со статусом «Мало» и «Закончился». Поправьте количество и нажмите «Пополнить выбранные» — остаток обновится.' },
  { keys: ['добавить', 'полк', 'каталог'],
    answer: 'Откройте «Каталог», выберите чай и нажмите «На полку». Если чая нет в каталоге — кнопка «Предложить чай» отправит заявку на модерацию.' },
  { keys: ['журнал', 'заварив', 'оценк'],
    answer: 'Журнал завариваний хранит дату, количество, оценку и заметки. Кнопка «Заварил» на карточке списывает чай и создаёт запись.' },
  { keys: ['модерац', 'заявк', 'предложить'],
    answer: 'Заявки в каталог видны только вам до одобрения модератором. Статус можно посмотреть на полке в блоке «Ждёт модерации».' },
  { keys: ['вход', 'войти', 'пароль', 'регистрац', 'аккаунт'],
    answer: 'Нажмите «Вход» в шапке: email + пароль (минимум 6 символов). Данные полки и журнала привязаны к аккаунту.' },
  { keys: ['температур', 'время', 'заварить', 'как завар'],
    answer: 'Параметры заваривания указаны в карточке чая: температура, время и пропорция. Откройте чай кликом по карточке.' },
  { keys: ['избранн', 'избранное', 'сердц', 'wishlist'],
    answer: 'Избранное — это список чаёв, которые вам понравились. Отмечайте сердечком в каталоге или на полке. Потом можно быстро добавить на полку из раздела «Избранное».' },
  { keys: ['остаток', 'сколько', 'грамм', 'количеств'],
    answer: 'Остаток показан на карточке чая на полке. Нажмите «Заварил» — укажите сколько граммов использовали, остаток автоматически уменьшится.' },
  { keys: ['статистик', 'средн', 'оценк', 'рейтинг'],
    answer: 'Статистика вверху полки показывает: сколько чаёв на полке, сколько завариваний, средний рейтинг и сколько чаёв нужно докупить.' },
];

const FALLBACK = 'Пока я понимаю только простые вопросы про полку, каталог, покупки и журнал. Позже сюда подключится ИИ-ассистент.';

function findAnswer(text) {
  const t = text.toLowerCase();
  const hit = RULES.find((r) => r.keys.some((k) => t.includes(k)));
  return hit ? hit.answer : FALLBACK;
}

// Заглушка для ИИ (пока не подключён Qwen)
async function askAI(text) {
  return '🤖 ИИ-ассистент скоро будет доступен! Пока я работаю в режиме обычного чат-бота. Задайте вопрос про полку, каталог или заваривание.';
}

function addMessage(text, who) {
  const box = $('#chatbotMessages');
  const m = document.createElement('div');
  m.className = 'chatbot-message ' + (who === 'user' ? 'is-user' : 'is-bot');
  m.textContent = text;
  box.appendChild(m);
  box.scrollTop = box.scrollHeight;
}

// Переключатель режимов
function switchMode(mode) {
  currentMode = mode;
  $$('.chatbot-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  const hint = mode === 'ai'
    ? '🤖 ИИ-режим (пока заглушка)'
    : '💬 Обычный чат-бот';
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
    if (open) input?.focus();
  }

  fab.addEventListener('click', () => setOpen(win.hidden));
  close?.addEventListener('click', () => setOpen(false));

  function send(text) {
    const msg = text.trim();
    if (!msg) return;
    addMessage(msg, 'user');

    // Показываем "печатает..."
    const typingId = 'typing-' + Date.now();
    const typingDiv = document.createElement('div');
    typingDiv.id = typingId;
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
        answer = findAnswer(msg);
      }

      addMessage(answer, 'bot');
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

  // Переключатель режимов
  $('#chatbotModeSwitch')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.chatbot-mode-btn');
    if (!btn) return;
    switchMode(btn.dataset.mode);
  });

  // Esc закрывает окно
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !win.hidden) setOpen(false);
  });
}