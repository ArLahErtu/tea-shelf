// ============================================================
// gate.js — маршрутизация «две страницы» редизайна v2.
//   • Лонгрид (index.html) — только для НЕзарегистрированных:
//     вошедший пользователь сразу уезжает в личный кабинет.
//   • Сервисные страницы (shelf / journal / profile) — только
//     для вошедших: гость уходит на лонгрид с ?next=… и после
//     входа возвращается туда, куда хотел.
//   • Каталог и политика публичны (SEO), «На полку» требует входа.
// ============================================================
import { getUser, onAuthChange } from './auth.js';

const PROTECTED = ['shelf.html', 'journal.html', 'profile.html'];
const LANDING = ['index.html', ''];

export function currentFile() {
  const p = location.pathname.split('/').pop() || 'index.html';
  return p;
}

export function nextParam() {
  const next = new URLSearchParams(location.search).get('next');
  return next && PROTECTED.includes(next) ? next : null;
}

export function initGate() {
  const file = currentFile();
  const isProtected = PROTECTED.includes(file);
  const isLanding = LANDING.includes(file);
  if (!isProtected && !isLanding) return;

  let redirected = false;

  const apply = (user) => {
    if (redirected) return;
    if (isLanding && user) {
      redirected = true;
      location.replace(nextParam() || 'shelf.html');
      return;
    }
    if (isProtected && !user) {
      redirected = true;
      location.replace('index.html?next=' + encodeURIComponent(file));
    }
  };

  apply(getUser());
  onAuthChange((user) => apply(user));
}
