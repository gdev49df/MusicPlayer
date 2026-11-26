// Окна аккаунта: вход, профиль, код активации и объяснение ограничений.
import { AccountError } from './account.js';

const $ = (id) => document.getElementById(id);
// без «г.» на конце: после даты в предложении и так стоит точка
const date = (ms) => new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
const say = (id, text, bad = false) => { $(id).textContent = text; $(id).classList.toggle('bad', bad); };

export function createAccountUI(account) {
  let creating = false;
  let busy = false;

  // кнопка, пока идёт запрос, не нажимается второй раз
  async function task(button, status, working, action) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    say(status, working);
    try {
      await action();
    } catch (e) {
      if (!(e instanceof AccountError)) console.error(e);
      say(status, e.message, true);
    } finally {
      busy = false;
      button.disabled = false;
    }
  }

  function setCreating(value) {
    creating = value;
    $('accountTitle').textContent = value ? 'Новый аккаунт' : 'Вход в аккаунт';
    $('signSubmit').textContent = value ? 'Создать аккаунт' : 'Войти';
    $('signSwitch').textContent = value ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Создать';
    $('repeatRow').hidden = !value;
    $('forgot').hidden = value;
    $('password').autocomplete = value ? 'new-password' : 'current-password';
    say('signStatus', '');
  }

  function planLine() {
    const a = account.account;
    const c = account.config;
    if (!a) return ['Чтобы сделать видео, войдите в аккаунт — это бесплатно.', false];
    if (account.isPro()) return [`Pro до ${date(a.proUntil)} — без ограничений`, false];
    const mark = c.watermark ? ' · с водяным знаком' : '';
    // вчерашний счётчик не показываем как сегодняшний
    return [`Бесплатно: сегодня осталось ${a.leftToday ?? c.freeDaily} из ${c.freeDaily} видео · до ${c.freeSeconds} с${mark}`, a.leftToday === 0];
  }

  function render() {
    if (!account.enabled) return;
    const a = account.account;
    const pro = account.isPro();
    const c = account.config;
    $('accountButton').hidden = false;
    $('accountButton').textContent = a ? `${a.login} · ${pro ? 'Pro' : 'бесплатный'}` : 'Войти';
    $('accountButton').classList.toggle('pro', pro);
    const [text, bad] = planLine();
    $('planLine').hidden = false;
    $('planLine').textContent = text;
    $('planLine').classList.toggle('bad', bad);

    $('signForm').hidden = Boolean(a);
    $('profile').hidden = !a;
    if (!a) return;
    $('profileName').textContent = a.login;
    $('profilePlan').textContent = pro ? 'Pro' : 'Бесплатный тариф';
    $('profilePlan').classList.toggle('pro', pro);
    say('profileUsage', pro ? `Действует до ${date(a.proUntil)}. Новый код продлит срок.` : text.replace('Бесплатно: ', ''));
    $('perks').hidden = pro;
    $('price').textContent = c.price;
    $('contact').textContent = c.contact || 'Чтобы подключить Pro, получите код активации и введите его ниже.';
    const link = /^https:\/\//.test(c.contactUrl);
    $('contactLink').hidden = !link;
    if (link) $('contactLink').href = c.contactUrl;
  }

  function open(note = '') {
    render();
    $('signNote').textContent = note;
    say('signStatus', '');
    say('codeStatus', '');
    if (!$('account').open) $('account').showModal();
    // свежие цены и остаток
    account.refresh().catch(() => {});
  }

  $('accountButton').onclick = () => open();
  $('accountClose').onclick = () => $('account').close();
  $('account').addEventListener('close', () => { $('password').value = $('password2').value = $('oldPass').value = $('newPass').value = ''; });
  $('signSwitch').onclick = () => setCreating(!creating);

  $('signForm').onsubmit = (event) => {
    event.preventDefault();
    const login = $('login').value.trim();
    const password = $('password').value;
    if (!/^[a-zA-Z0-9_.]{3,24}$/.test(login)) return say('signStatus', 'Логин: 3–24 латинские буквы, цифры, точка или _', true);
    if (password.length < 6) return say('signStatus', 'Пароль — не короче 6 знаков', true);
    if (creating && password !== $('password2').value) return say('signStatus', 'Пароли не совпадают', true);
    task($('signSubmit'), 'signStatus', creating ? 'Создаю аккаунт…' : 'Вхожу…', async () => {
      await account.enter(login, password, creating);
      $('password').value = $('password2').value = '';
      setCreating(false);
      render();
    });
  };

  $('codeForm').onsubmit = (event) => {
    event.preventDefault();
    const code = $('code').value.trim();
    if (!code) return say('codeStatus', 'Введите код.', true);
    task($('codeSubmit'), 'codeStatus', 'Проверяю код…', async () => {
      const { added } = await account.redeem(code);
      $('code').value = '';
      render();
      say('codeStatus', `Готово: добавлено дней — ${added}.`);
    });
  };

  $('passForm').onsubmit = (event) => {
    event.preventDefault();
    const [old, next] = [$('oldPass').value, $('newPass').value];
    if (next.length < 6) return say('passStatus', 'Новый пароль — не короче 6 знаков', true);
    task(event.submitter || $('passForm').querySelector('button'), 'passStatus', 'Меняю…', async () => {
      await account.changePassword(old, next);
      $('oldPass').value = $('newPass').value = '';
      say('passStatus', 'Пароль изменён.');
    });
  };

  $('logout').onclick = () => account.logout().then(() => { setCreating(false); render(); });

  // что мешает сделать видео; ответ: 'pro', 'fix' или null
  function gate(title, problems, fix) {
    $('gateTitle').textContent = title;
    $('gateList').replaceChildren(...problems.map((p) => Object.assign(document.createElement('li'), { textContent: p })));
    $('gateFix').hidden = !fix;
    if (fix) $('gateFix').textContent = fix;
    $('gate').showModal();
    return new Promise((resolve) => {
      let answer = null;
      $('gatePro').onclick = () => { answer = 'pro'; $('gate').close(); };
      $('gateFix').onclick = () => { answer = 'fix'; $('gate').close(); };
      $('gateClose').onclick = () => $('gate').close();
      $('gate').addEventListener('close', () => resolve(answer), { once: true });
    });
  }

  setCreating(false);
  return { render, open, gate };
}
