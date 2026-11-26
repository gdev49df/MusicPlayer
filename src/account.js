// Аккаунт и тариф. Сервер — источник правды: он считает видео и проверяет коды.
// Если адрес сервера не задан при сборке, всё это выключено и ничего не ограничено.

const STORE = 'pripev.account';
const DEVICE = 'pripev.device';
const OFFLINE = 7 * 86400000; // столько Pro работает без связи с сервером

export const DEFAULTS = {
  freeDaily: 3, freeSeconds: 30, watermark: 'Припев', price: '', contact: '', contactUrl: '',
  pro: ['style:chat', 'style:lock', 'style:vinyl', 'style:cassette', 'fx:sparks', 'fx:vhs', 'fx:glitch', 'text:type', 'text:big'],
};

// пароль растягивается здесь, на сервер уходит только ключ
export async function passwordKey(login, password) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 310000, salt: enc.encode(`pripev:v1:${login.trim().toLowerCase()}`) }, base, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class AccountError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function read() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}

function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE);
    if (!id) localStorage.setItem(DEVICE, (id = crypto.randomUUID()));
    return id;
  } catch { return crypto.randomUUID(); }
}

export function createAccount(server, onChange = () => {}) {
  const enabled = Boolean(server);
  const saved = enabled ? read() : {};
  let token = saved.token || '';
  let account = (token && saved.account) || null;
  let config = { ...DEFAULTS, ...saved.config };
  let checkedAt = saved.checkedAt || 0;
  const device = enabled ? deviceId() : '';

  function keep() {
    try { localStorage.setItem(STORE, JSON.stringify({ token, account, config, checkedAt })); } catch { /* без памяти вход спросят снова */ }
    onChange();
  }

  function take(data) {
    if (data.config) config = { ...DEFAULTS, ...data.config };
    if (data.token) token = data.token;
    if (data.account) { account = data.account; checkedAt = Date.now(); }
    keep();
    return data;
  }

  function forget() {
    token = '';
    account = null;
    checkedAt = 0;
    keep();
  }

  async function call(path, body) {
    let response, data;
    const sent = token;
    try {
      response = await fetch(`${server}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { ...(sent ? { authorization: `Bearer ${sent}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      data = await response.json();
    } catch {
      throw new AccountError('network', 'Нет связи с сервером. Проверьте интернет.');
    }
    if (!data.ok) {
      // сессия закончилась или аккаунт заблокирован — выходим
      if (sent && sent === token && (data.error === 'auth' || data.error === 'blocked')) forget();
      throw new AccountError(data.error || 'server', data.message || 'Ошибка сервера');
    }
    return data;
  }

  const isPro = () => Boolean(account) && account.plan === 'pro' && account.proUntil > Date.now() && Date.now() - checkedAt < OFFLINE;

  const api = {
    enabled,
    get account() { return account; },
    get config() { return config; },
    isPro,
    // функция недоступна на текущем тарифе
    locked: (feature) => enabled && !isPro() && config.pro.includes(feature),
    watermark: () => (enabled && !isPro() ? config.watermark : ''),

    async refresh() {
      if (!enabled) return;
      if (!token) { take(await call('/api/config')); return; }
      take(await call(`/api/me?device=${device}`));
    },

    async enter(login, password, create) {
      token = '';
      const key = await passwordKey(login, password);
      take(await call(create ? '/api/register' : '/api/login', { login: login.trim(), key, device }));
    },

    async logout() {
      await call('/api/logout', {}).catch(() => {});
      forget();
    },

    async redeem(code) { return take(await call('/api/redeem', { code, device })); },

    async changePassword(oldPassword, newPassword) {
      const login = account.login;
      await call('/api/password', { oldKey: await passwordKey(login, oldPassword), newKey: await passwordKey(login, newPassword) });
    },

    // разрешение на сборку ролика; { id } — чтобы вернуть видео, если сборка не удалась
    async permit(seconds) {
      if (!enabled) return { id: null };
      if (!token) throw new AccountError('auth', 'Войдите в аккаунт');
      try {
        const data = take(await call('/api/export', { device, seconds }));
        return { id: data.id };
      } catch (e) {
        // оплаченный Pro работает и без интернета
        if (e.code === 'network' && isPro()) return { id: null };
        if (e.code === 'daily' && account) { account = { ...account, leftToday: 0 }; keep(); }
        throw e;
      }
    },

    async cancel(id) {
      if (id) take(await call('/api/export/cancel', { id, device }));
    },
  };
  return api;
}
