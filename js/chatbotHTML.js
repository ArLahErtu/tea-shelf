// ============================================================
// chatbotHTML.js — генерация HTML чат-бота
// Вставляется один раз при загрузке любой страницы
// ============================================================
const CHATBOT_HTML = `
<div id="chatbot-root">

<!-- FAB кнопка -->
<button
  class="chatbot-fab"
  id="chatbotToggle"
  type="button"
  aria-label="Открыть чат-помощник"
  aria-expanded="false"
  aria-controls="chatbotWindow"
>
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 20c0-8 5-13 14-15-1 9-6 14-14 15Z"/>
    <path d="M5 20c3-6 7-10 12-13"/>
  </svg>
</button>

<!-- Окно чата -->
<section
  class="chatbot-window"
  id="chatbotWindow"
  role="dialog"
  aria-modal="true"
  aria-label="Чат-помощник"
  hidden
>

  <!-- Шапка: заголовок + закрыть -->
  <div class="chatbot-header">
    <div class="chatbot-title">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5 20c0-8 5-13 14-15-1 9-6 14-14 15Z"/>
        <path d="M5 20c3-6 7-10 12-13"/>
      </svg>
      Чайный помощник
    </div>
    <button
      class="chatbot-close"
      id="chatbotClose"
      type="button"
      aria-label="Закрыть чат"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 6l12 12M18 6L6 18"/>
      </svg>
    </button>
  </div>

  <!-- Переключатель режимов -->
  <div class="chatbot-mode-switch" id="chatbotModeSwitch">
    <button class="chatbot-mode-btn active" data-mode="bot" type="button">
      💬 Чат-бот
    </button>
    <button class="chatbot-mode-btn" data-mode="ai" type="button" disabled>
      🤖 ИИ <span class="badge-soon">Скоро</span>
    </button>
  </div>

  <!-- Сообщения -->
  <div class="chatbot-messages" id="chatbotMessages">
    <div class="chatbot-message is-bot">
      Привет! Я помощник «Чайной полки».
      Напиши «Что ты можешь» — покажу все команды.
    </div>
  </div>

  <!-- Подсказки (показываются только при фокусе на поле ввода) -->
  <div class="chatbot-suggestions hidden" id="chatbotSuggestions">
    <button class="chatbot-suggestion" type="button">Что ты можешь?</button>
    <button class="chatbot-suggestion" type="button">Статистика</button>
  </div>

  <!-- Форма ввода -->
  <form class="chatbot-form" id="chatbotForm" autocomplete="off">
    <input
      class="chatbot-input"
      id="chatbotInput"
      name="message"
      type="text"
      placeholder="Напишите вопрос…"
      aria-label="Сообщение для чат-помощника"
    >
    <button
      class="chatbot-send"
      type="submit"
      aria-label="Отправить сообщение"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 12l16-7-4 14-4-5-8-2Z"/><path d="M12 14l8-9"/>
      </svg>
    </button>
  </form>

</section>
</div>
`;

// Вставляем HTML в body при импорте модуля
document.body.insertAdjacentHTML('beforeend', CHATBOT_HTML);
console.log('[ChatbotHTML] HTML чата вставлен в DOM');