// ============================================================
// chatbot.js — бот-заглушка: шаблонные ответы по словам-маркерам.
// Позже заменяется на ИИ (Qwen + RAG) без переделки разметки.
// ============================================================
import { $ } from './ui.js';

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
];

const FALLBACK = 'Пока я понимаю только простые вопросы про полку, каталог, покупки и журнал. Позже сюда подключится ИИ-ассистент.';

function findAnswer(text) {
  const t = text.toLowerCase();
  const hit = RULES.find((r) => r.keys.some((k) => t.includes(k)));
  return hit ? hit.answer : FALLBACK;
}

function addMessage(text, who) {
  const box = $('#chatbotMessages');
  const m = document.createElement('div');
  m.className = 'chatbot-message ' + (who === 'user' ? 'is-user' : 'is-bot');
  m.textContent = text;
  box.appendChild(m);
  box.scrollTop = box.scrollHeight;
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
    setTimeout(() => addMessage(findAnswer(msg), 'bot'), 350);
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

  // Esc закрывает окно
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !win.hidden) setOpen(false);
  });
}