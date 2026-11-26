// Сервер «Припева»: аккаунты, дневной лимит, коды активации и админ-панель.
// Cloudflare Worker + D1. Пароль растягивается на стороне клиента (PBKDF2),
// сюда приходит уже ключ: так хватает бесплатного тарифа, а утечка базы
// всё равно требует тяжёлого перебора.

import ADMIN_PAGE from './admin.html';

const DAY = 86400000;
const SESSION = 90 * DAY;

// ключи функций, которые админ может делать платными
export const FEATURES = [
  'style:chat', 'style:lock', 'style:vinyl', 'style:cassette',
  'fx:sparks', 'fx:vhs', 'fx:glitch',
  'text:type', 'text:big',
];

export const DEFAULTS = {
  freeDaily: 3,
  freeSeconds: 30,
  watermark: 'Припев',
  price: '',
  contact: '',
  contactUrl: '',
  tzHours: 5,
  pro: FEATURES,
};

class Fail extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (text) => hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
const random = (bytes = 32) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

function same(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-max-age': '86400',
};

async function body(request) {
  const text = await request.text();
  if (text.length > 20000) throw new Fail(413, 'big', 'Слишком большой запрос');
  try {
    const data = JSON.parse(text || '{}');
    if (data && typeof data === 'object') return data;
  } catch {}
  throw new Fail(400, 'json', 'Неверный запрос');
}

async function config(db) {
  const { results } = await db.prepare('SELECT key, value FROM config').all();
  const out = { ...DEFAULTS };
  for (const row of results) {
    if (!(row.key in DEFAULTS)) continue;
    try { out[row.key] = JSON.parse(row.value); } catch {}
  }
  return out;
}

const publicConfig = ({ tzHours, ...rest }) => rest;
const dayOf = (now, tzHours) => Math.floor((now + tzHours * 3600000) / DAY);

// ---------- защита от перебора ----------

const slow = () => new Fail(429, 'slow', 'Слишком много попыток. Подождите и попробуйте снова.');

async function guard(db, key, max, windowMs, now) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND at > ?').bind(key, now - windowMs).first();
  if (row.n >= max) throw slow();
}

// попытка записывается до проверки, чтобы пачка параллельных запросов не проскочила;
// удачную потом убирает forgive
async function take(db, key, max, windowMs, now) {
  await note(db, key, now);
  const row = await db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND at > ?').bind(key, now - windowMs).first();
  if (row.n > max) throw slow();
}

const forgive = (db, key, now) => db.prepare('DELETE FROM attempts WHERE key = ? AND at = ?').bind(key, now).run();

async function note(db, key, now) {
  await db.batch([
    db.prepare('INSERT INTO attempts (key, at) VALUES (?, ?)').bind(key, now),
    db.prepare('DELETE FROM attempts WHERE at < ?').bind(now - 2 * DAY),
  ]);
}

// ---------- аккаунты ----------

function checkLogin(value) {
  const login = String(value ?? '').trim();
  if (!/^[a-zA-Z0-9_.]{3,24}$/.test(login)) {
    throw new Fail(400, 'login', 'Логин: 3–24 латинские буквы, цифры, точка или _');
  }
  return login;
}

function checkKey(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Fail(400, 'key', 'Неверный запрос');
  return value;
}

function checkDevice(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(value)) throw new Fail(400, 'device', 'Неверный запрос');
  return value;
}

async function used(db, userId, device, day) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM exports WHERE day = ? AND free = 1 AND (user_id = ? OR device = ?)')
    .bind(day, userId, device).first();
  return row.n;
}

async function account(db, user, device, cfg, now) {
  const pro = user.pro_until > now;
  const count = await used(db, user.id, device, dayOf(now, cfg.tzHours));
  return {
    login: user.login,
    plan: pro ? 'pro' : 'free',
    proUntil: pro ? user.pro_until : 0,
    usedToday: count,
    leftToday: pro ? null : Math.max(0, cfg.freeDaily - count),
    now,
  };
}

async function startSession(db, userId, device, now) {
  const token = random();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires < ?').bind(now),
    db.prepare('INSERT INTO sessions (token, user_id, device, expires) VALUES (?, ?, ?, ?)').bind(await sha(token), userId, device, now + SESSION),
    db.prepare('UPDATE users SET seen = ? WHERE id = ?').bind(now, userId),
  ]);
  return token;
}

async function authorize(db, request, now) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Fail(401, 'auth', 'Войдите в аккаунт');
  const hash = await sha(token);
  const row = await db.prepare('SELECT u.*, s.expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').bind(hash).first();
  if (!row || row.expires < now) throw new Fail(401, 'auth', 'Войдите в аккаунт снова');
  if (row.blocked) throw new Fail(403, 'blocked', 'Аккаунт заблокирован');
  // сессия продлевается не чаще раза в сутки
  if (row.expires < now + SESSION - DAY) {
    await db.batch([
      db.prepare('UPDATE sessions SET expires = ? WHERE token = ?').bind(now + SESSION, hash),
      db.prepare('UPDATE users SET seen = ? WHERE id = ?').bind(now, row.id),
    ]);
  }
  return { user: row, hash };
}

// ---------- коды активации ----------

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `PRO-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

// принимает код с пробелами, без дефисов и в любом регистре
export function normalizeCode(value) {
  const s = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^PRO(?=.{12}$)/, '');
  return s.length === 12 ? `PRO-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}` : '';
}

// ---------- API программы ----------

async function api(request, env, path, now) {
  const db = env.DB;
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const method = request.method;

  if (method === 'GET' && path === '/api/config') return { config: publicConfig(await config(db)) };

  if (method === 'POST' && path === '/api/register') {
    const data = await body(request);
    const login = checkLogin(data.login);
    const key = checkKey(data.key);
    const device = checkDevice(data.device);
    await guard(db, `reg:${ip}`, 15, DAY, now); // у мобильных операторов один адрес на многих
    await guard(db, `regd:${device}`, 3, DAY, now);
    const salt = random(16);
    const added = await db.prepare('INSERT OR IGNORE INTO users (login, login_key, salt, hash, created) VALUES (?, ?, ?, ?, ?)')
      .bind(login, login.toLowerCase(), salt, await sha(salt + key), now).run();
    if (!added.meta.changes) throw new Fail(409, 'taken', 'Этот логин уже занят');
    await note(db, `reg:${ip}`, now);
    await note(db, `regd:${device}`, now);
    const user = await db.prepare('SELECT * FROM users WHERE login_key = ?').bind(login.toLowerCase()).first();
    const cfg = await config(db);
    return { token: await startSession(db, user.id, device, now), account: await account(db, user, device, cfg, now), config: publicConfig(cfg) };
  }

  if (method === 'POST' && path === '/api/login') {
    const data = await body(request);
    const login = String(data.login ?? '').trim().toLowerCase().slice(0, 24);
    const key = checkKey(data.key);
    const device = checkDevice(data.device);
    await take(db, `login:${login}:${ip}`, 8, 15 * 60000, now);
    await take(db, `loginip:${ip}`, 30, 15 * 60000, now);
    const user = await db.prepare('SELECT * FROM users WHERE login_key = ?').bind(login).first();
    const hash = await sha((user?.salt || '') + key);
    if (!user || !same(hash, user.hash)) throw new Fail(401, 'password', 'Неверный логин или пароль');
    await forgive(db, `login:${login}:${ip}`, now);
    await forgive(db, `loginip:${ip}`, now);
    if (user.blocked) throw new Fail(403, 'blocked', 'Аккаунт заблокирован');
    const cfg = await config(db);
    return { token: await startSession(db, user.id, device, now), account: await account(db, user, device, cfg, now), config: publicConfig(cfg) };
  }

  const { user, hash } = await authorize(db, request, now);

  if (method === 'GET' && path === '/api/me') {
    const device = checkDevice(new URL(request.url).searchParams.get('device'));
    const cfg = await config(db);
    return { account: await account(db, user, device, cfg, now), config: publicConfig(cfg) };
  }

  if (method !== 'POST') throw new Fail(404, 'path', 'Не найдено');
  const data = await body(request);

  if (path === '/api/logout') {
    await db.prepare('DELETE FROM sessions WHERE token = ?').bind(hash).run();
    return {};
  }

  if (path === '/api/password') {
    const oldKey = checkKey(data.oldKey);
    const newKey = checkKey(data.newKey);
    await take(db, `pass:${user.id}`, 8, 15 * 60000, now);
    if (!same(await sha(user.salt + oldKey), user.hash)) throw new Fail(401, 'password', 'Старый пароль не подходит');
    await forgive(db, `pass:${user.id}`, now);
    const salt = random(16);
    await db.batch([
      db.prepare('UPDATE users SET salt = ?, hash = ? WHERE id = ?').bind(salt, await sha(salt + newKey), user.id),
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').bind(user.id, hash),
    ]);
    return {};
  }

  // разрешение на сборку ролика: проверяет длину и дневной лимит и сразу засчитывает видео
  if (path === '/api/export') {
    const device = checkDevice(data.device);
    const seconds = Number(data.seconds);
    if (!(seconds > 0 && seconds < 3600)) throw new Fail(400, 'seconds', 'Неверный запрос');
    const cfg = await config(db);
    const free = !(user.pro_until > now);
    if (free && seconds > cfg.freeSeconds + 0.6) throw new Fail(403, 'length', `Бесплатно — ролики до ${cfg.freeSeconds} секунд`);
    const day = dayOf(now, cfg.tzHours);
    // проверка и запись одним запросом, чтобы параллельные запросы не обошли лимит
    const added = await db.prepare(`INSERT INTO exports (user_id, device, day, free, seconds, at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6
      WHERE ?4 = 0 OR (SELECT COUNT(*) FROM exports WHERE day = ?3 AND free = 1 AND (user_id = ?1 OR device = ?2)) < ?7`)
      .bind(user.id, device, day, free ? 1 : 0, Math.round(seconds), now, cfg.freeDaily).run();
    if (!added.meta.changes) throw new Fail(403, 'daily', `Бесплатные видео на сегодня закончились (${cfg.freeDaily} в день)`);
    return { id: added.meta.last_row_id, account: await account(db, user, device, cfg, now), config: publicConfig(cfg) };
  }

  // сборка отменена или не удалась — видео не засчитывается
  if (path === '/api/export/cancel') {
    const device = checkDevice(data.device);
    await db.prepare('DELETE FROM exports WHERE id = ? AND user_id = ? AND at > ?').bind(Number(data.id) || 0, user.id, now - 30 * 60000).run();
    const cfg = await config(db);
    return { account: await account(db, user, device, cfg, now) };
  }

  if (path === '/api/redeem') {
    const device = checkDevice(data.device);
    const code = normalizeCode(data.code);
    await take(db, `code:${user.id}`, 10, 3600000, now);
    const row = code && await db.prepare('SELECT * FROM codes WHERE code = ?').bind(code).first();
    if (!row || row.used_by !== null) {
      throw new Fail(400, 'code', row ? 'Этот код уже использован' : 'Такого кода нет. Проверьте буквы и цифры.');
    }
    // обе записи в одной транзакции: срок добавляется, только пока код ещё свободен
    const [, claimed] = await db.batch([
      db.prepare('UPDATE users SET pro_until = MAX(pro_until, ?) + ? WHERE id = ? AND EXISTS (SELECT 1 FROM codes WHERE code = ? AND used_by IS NULL)')
        .bind(now, row.days * DAY, user.id, code),
      db.prepare('UPDATE codes SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL').bind(user.id, now, code),
    ]);
    if (!claimed.meta.changes) throw new Fail(400, 'code', 'Этот код уже использован');
    await forgive(db, `code:${user.id}`, now);
    const fresh = await db.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
    const cfg = await config(db);
    return { added: row.days, account: await account(db, fresh, device, cfg, now) };
  }

  throw new Fail(404, 'path', 'Не найдено');
}

// ---------- админ-панель ----------

async function sign(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

async function admin(request, env, path, now) {
  const db = env.DB;
  const secret = env.ADMIN_PASSWORD || '';
  if (secret.length < 8) throw new Fail(503, 'setup', 'Задайте секрет ADMIN_PASSWORD (не короче 8 символов) в настройках воркера');
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const method = request.method;

  if (method === 'POST' && path === '/admin/api/login') {
    const data = await body(request);
    await take(db, `admin:${ip}`, 6, 15 * 60000, now);
    if (!same(await sha(String(data.password ?? '')), await sha(secret))) throw new Fail(401, 'password', 'Неверный пароль');
    await forgive(db, `admin:${ip}`, now);
    const until = now + DAY / 2;
    return { token: `${until}.${await sign(secret, `admin:${until}`)}` };
  }

  const [until, mac] = (request.headers.get('authorization') || '').replace(/^Bearer /, '').split('.');
  if (!(Number(until) > now) || !mac || !same(mac, await sign(secret, `admin:${until}`))) throw new Fail(401, 'auth', 'Войдите снова');

  const cfg = await config(db);

  if (method === 'GET' && path === '/admin/api/overview') {
    const day = dayOf(now, cfg.tzHours);
    const [users, pro, today, codes] = await db.batch([
      db.prepare('SELECT COUNT(*) AS n FROM users'),
      db.prepare('SELECT COUNT(*) AS n FROM users WHERE pro_until > ?').bind(now),
      db.prepare('SELECT COUNT(*) AS n FROM exports WHERE day = ?').bind(day),
      db.prepare('SELECT COUNT(*) AS n FROM codes WHERE used_by IS NULL'),
    ]);
    const n = (r) => r.results[0].n;
    return { stats: { users: n(users), pro: n(pro), today: n(today), codes: n(codes) }, config: cfg, features: FEATURES };
  }

  if (method === 'GET' && path === '/admin/api/users') {
    const q = (new URL(request.url).searchParams.get('q') || '').toLowerCase().slice(0, 24).replace(/[\\%_]/g, '\\$&');
    const { results } = await db.prepare(`SELECT u.id, u.login, u.pro_until AS proUntil, u.blocked, u.created, u.seen,
      (SELECT COUNT(*) FROM exports e WHERE e.user_id = u.id) AS videos
      FROM users u WHERE u.login_key LIKE ? ESCAPE '\\' ORDER BY u.id DESC LIMIT 100`).bind(`%${q}%`).all();
    return { users: results };
  }

  if (method === 'GET' && path === '/admin/api/codes') {
    const { results } = await db.prepare(`SELECT c.code, c.days, c.note, c.created, c.used_at AS usedAt, u.login AS usedBy, c.used_by IS NOT NULL AS used
      FROM codes c LEFT JOIN users u ON u.id = c.used_by ORDER BY c.created DESC, c.code LIMIT 200`).all();
    return { codes: results };
  }

  if (method !== 'POST') throw new Fail(404, 'path', 'Не найдено');
  const data = await body(request);

  if (path === '/admin/api/codes') {
    const days = Math.round(Number(data.days));
    const count = Math.round(Number(data.count));
    if (!(days >= 1 && days <= 36500)) throw new Fail(400, 'days', 'Дней: от 1 до 36500');
    if (!(count >= 1 && count <= 50)) throw new Fail(400, 'count', 'Кодов за раз: от 1 до 50');
    const memo = String(data.note ?? '').slice(0, 80);
    const made = Array.from({ length: count }, newCode);
    await db.batch(made.map((code) => db.prepare('INSERT INTO codes (code, days, note, created) VALUES (?, ?, ?, ?)').bind(code, days, memo, now)));
    return { made };
  }

  if (path === '/admin/api/codes/delete') {
    await db.prepare('DELETE FROM codes WHERE code = ? AND used_by IS NULL').bind(String(data.code ?? '')).run();
    return {};
  }

  if (path === '/admin/api/user') {
    const id = Number(data.id) || 0;
    const target = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
    if (!target) throw new Fail(404, 'user', 'Такого пользователя нет');
    const dropSessions = db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id);
    if (data.action === 'addDays') {
      const days = Math.round(Number(data.days));
      if (!(days >= 1 && days <= 36500)) throw new Fail(400, 'days', 'Дней: от 1 до 36500');
      await db.prepare('UPDATE users SET pro_until = MAX(pro_until, ?) + ? WHERE id = ?').bind(now, days * DAY, id).run();
    } else if (data.action === 'removePro') {
      await db.prepare('UPDATE users SET pro_until = 0 WHERE id = ?').bind(id).run();
    } else if (data.action === 'block') {
      await db.batch([db.prepare('UPDATE users SET blocked = 1 WHERE id = ?').bind(id), dropSessions]);
    } else if (data.action === 'unblock') {
      await db.prepare('UPDATE users SET blocked = 0 WHERE id = ?').bind(id).run();
    } else if (data.action === 'password') {
      const salt = random(16);
      await db.batch([
        db.prepare('UPDATE users SET salt = ?, hash = ? WHERE id = ?').bind(salt, await sha(salt + checkKey(data.key)), id),
        dropSessions,
        db.prepare('DELETE FROM attempts WHERE key LIKE ?').bind(`login:${target.login_key}:%`),
      ]);
    } else if (data.action === 'delete') {
      await db.batch([db.prepare('DELETE FROM users WHERE id = ?').bind(id), dropSessions]);
    } else throw new Fail(400, 'action', 'Неизвестное действие');
    return {};
  }

  if (path === '/admin/api/config') {
    const int = (v, min, max, name) => {
      const x = Math.round(Number(v));
      if (!(x >= min && x <= max)) throw new Fail(400, name, `${name}: от ${min} до ${max}`);
      return x;
    };
    const url = String(data.contactUrl ?? '').trim().slice(0, 200);
    if (url && !/^https:\/\/\S+$/.test(url)) throw new Fail(400, 'contactUrl', 'Ссылка должна начинаться с https://');
    const next = {
      freeDaily: int(data.freeDaily, 0, 1000, 'Видео в день'),
      freeSeconds: int(data.freeSeconds, 5, 600, 'Секунд в ролике'),
      watermark: String(data.watermark ?? '').trim().slice(0, 30),
      price: String(data.price ?? '').trim().slice(0, 80),
      contact: String(data.contact ?? '').trim().slice(0, 300),
      contactUrl: url,
      pro: FEATURES.filter((f) => Array.isArray(data.pro) && data.pro.includes(f)),
    };
    await db.batch(Object.entries(next).map(([k, v]) => db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(k, JSON.stringify(v))));
    return {};
  }

  throw new Fail(404, 'path', 'Не найдено');
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    const isApi = path.startsWith('/api/');
    const cors = isApi ? CORS : {};
    if (isApi && request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (isApi) return json({ ok: true, ...(await api(request, env, path, Date.now())) }, 200, cors);
      if (path.startsWith('/admin/api/')) return json({ ok: true, ...(await admin(request, env, path, Date.now())) });
      if (path === '/admin' || path === '/') {
        return new Response(ADMIN_PAGE, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'x-frame-options': 'DENY',
            'referrer-policy': 'no-referrer',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'",
          },
        });
      }
      return json({ ok: false, error: 'path', message: 'Не найдено' }, 404);
    } catch (error) {
      if (error instanceof Fail) return json({ ok: false, error: error.code, message: error.message }, error.status, cors);
      console.error(error);
      return json({ ok: false, error: 'server', message: 'Ошибка сервера, попробуйте позже' }, 500, cors);
    }
  },
};
