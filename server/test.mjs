// Проверка сервера на локальной базе: npm test
import { spawn, execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = 'test-admin-password';
const state = '.wrangler/test-state';
const wrangler = 'node_modules/.bin/wrangler';

rmSync(state, { recursive: true, force: true });
execFileSync(wrangler, ['d1', 'execute', 'pripev', '--local', '--persist-to', state, '--file', 'schema.sql'], { stdio: 'ignore' });
const server = spawn(wrangler, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state, '--var', `ADMIN_PASSWORD:${ADMIN}`], { stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid); } catch {} };
process.on('exit', stop);

const keyOf = (login, password) => pbkdf2Sync(password.normalize('NFKC'), `pripev:v1:${login.toLowerCase()}`, 310000, 32, 'sha256').toString('hex');

async function call(path, data, token, headers = {}) {
  const res = await fetch(BASE + path, {
    method: data ? 'POST' : 'GET',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { 'content-type': 'application/json' } : {}), ...headers },
    body: data && JSON.stringify(data),
  });
  return { status: res.status, ...(await res.json()) };
}

try {
  for (let i = 0; ; i++) {
    try { await fetch(`${BASE}/api/config`); break; } catch { if (i > 120) throw new Error('сервер не поднялся'); await new Promise((r) => setTimeout(r, 500)); }
  }

  const config = await call('/api/config');
  assert.equal(config.config.freeDaily, 3);
  assert.equal(config.config.freeSeconds, 30);
  assert.ok(config.config.pro.includes('style:vinyl'));
  assert.equal(config.config.tzHours, undefined);

  const cors = await fetch(`${BASE}/api/me`, { method: 'OPTIONS' });
  assert.equal(cors.status, 204);
  assert.equal(cors.headers.get('access-control-allow-origin'), '*');

  const device = randomUUID();
  assert.equal((await call('/api/register', { login: 'ab', key: keyOf('ab', '123456'), device })).error, 'login');
  assert.equal((await call('/api/register', { login: 'Тест', key: keyOf('x', '123456'), device })).error, 'login');
  const reg = await call('/api/register', { login: 'Tester', key: keyOf('Tester', 'secret1'), device });
  assert.equal(reg.status, 200, JSON.stringify(reg));
  assert.equal(reg.account.plan, 'free');
  assert.equal(reg.account.leftToday, 3);
  assert.equal((await call('/api/register', { login: 'tester', key: keyOf('tester', 'secret1'), device })).error, 'taken');

  assert.equal((await call('/api/login', { login: 'tester', key: keyOf('tester', 'wrong!'), device })).status, 401);
  const login = await call('/api/login', { login: 'TESTER', key: keyOf('tester', 'secret1'), device });
  assert.equal(login.status, 200);
  const token = login.token;
  assert.equal((await call(`/api/me?device=${device}`)).status, 401);
  assert.equal((await call(`/api/me?device=${device}`, null, token)).account.login, 'Tester');

  // длина и дневной лимит
  assert.equal((await call('/api/export', { device, seconds: 45 }, token)).error, 'length');
  const results = await Promise.all(Array.from({ length: 8 }, () => call('/api/export', { device, seconds: 30 }, token)));
  assert.equal(results.filter((r) => r.ok).length, 3, 'параллельные запросы не обходят лимит');
  assert.equal(results.filter((r) => r.error === 'daily').length, 5);
  const made = results.find((r) => r.ok);
  const back = await call('/api/export/cancel', { device, id: made.id }, token);
  assert.equal(back.account.leftToday, 1);
  assert.equal((await call('/api/export', { device, seconds: 15 }, token)).account.leftToday, 0);

  // второй аккаунт на том же компьютере не даёт новые видео, на другом — даёт
  const second = await call('/api/register', { login: 'second', key: keyOf('second', 'secret1'), device });
  assert.equal(second.account.leftToday, 0);
  assert.equal((await call('/api/export', { device, seconds: 15 }, second.token)).error, 'daily');
  assert.equal((await call('/api/export', { device: randomUUID(), seconds: 15 }, second.token)).ok, true);

  // админ
  assert.equal((await call('/admin/api/overview')).status, 401);
  assert.equal((await call('/admin/api/login', { password: 'nope' })).status, 401);
  const admin = (await call('/admin/api/login', { password: ADMIN })).token;
  assert.ok(admin);
  assert.equal((await call('/admin/api/overview', null, token)).status, 401, 'обычный токен не пускает в админку');
  assert.equal((await call('/admin/api/overview', null, `${Date.now() + 1e7}.${admin.split('.')[1]}`)).status, 401, 'подделанный срок');
  const over = await call('/admin/api/overview', null, admin);
  assert.deepEqual(over.stats, { users: 2, pro: 0, today: 4, codes: 0 });

  const codes = (await call('/admin/api/codes', { days: 30, count: 2, note: '<b>тест</b>' }, admin)).made;
  assert.match(codes[0], /^PRO-[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  assert.equal((await call('/api/redeem', { device, code: 'PRO-0000-0000-0000' }, token)).error, 'code');
  const sloppy = codes[0].toLowerCase().replace(/-/g, ' ');
  const twice = await Promise.all([token, second.token].map((t) => call('/api/redeem', { device, code: sloppy }, t)));
  assert.equal(twice.filter((r) => r.ok).length, 1, 'код действует один раз');
  const winner = twice[0].ok ? token : second.token;
  const me = (await call(`/api/me?device=${device}`, null, winner)).account;
  assert.equal(me.plan, 'pro');
  assert.ok(Math.abs(me.proUntil - Date.now() - 30 * 86400000) < 60000);
  assert.equal((await call('/api/redeem', { device, code: codes[1].slice(4) }, winner)).account.proUntil - me.proUntil, 30 * 86400000, 'второй код продлевает');
  assert.equal((await call('/api/export', { device, seconds: 200 }, winner)).ok, true, 'Pro без лимитов');

  const list = await call('/admin/api/codes', null, admin);
  assert.equal(list.codes.filter((c) => c.used).length, 2);

  // настройки
  await call('/admin/api/config', { freeDaily: 5, freeSeconds: 20, watermark: 'Новое имя', price: '990 ₸', contact: 'Пишите', contactUrl: 'https://t.me/x', pro: ['fx:vhs', 'чужое'] }, admin);
  const next = (await call('/api/config')).config;
  assert.equal(next.freeDaily, 5);
  assert.equal(next.watermark, 'Новое имя');
  assert.deepEqual(next.pro, ['fx:vhs']);
  assert.equal((await call('/admin/api/config', { ...next, contactUrl: 'javascript:alert(1)' }, admin)).error, 'contactUrl');

  // смена пароля, сброс и блокировка
  assert.equal((await call('/api/password', { oldKey: keyOf('tester', 'bad000'), newKey: keyOf('tester', 'secret2') }, token)).status, 401);
  assert.equal((await call('/api/password', { oldKey: keyOf('tester', 'secret1'), newKey: keyOf('tester', 'secret2') }, token)).ok, true);
  assert.equal((await call('/api/login', { login: 'tester', key: keyOf('tester', 'secret2'), device })).ok, true);
  const users = (await call('/admin/api/users?q=test', null, admin)).users;
  assert.equal(users.length, 1);
  const id = users[0].id;
  assert.equal((await call('/admin/api/users?q=%25', null, admin)).users.length, 0, 'знак % ищется буквально');
  await call('/admin/api/user', { id, action: 'password', key: keyOf('tester', 'reset99') }, admin);
  assert.equal((await call(`/api/me?device=${device}`, null, token)).status, 401, 'после сброса сессии закрыты');
  const again = await call('/api/login', { login: 'tester', key: keyOf('tester', 'reset99'), device });
  assert.equal(again.ok, true);
  await call('/admin/api/user', { id, action: 'block' }, admin);
  assert.equal((await call(`/api/me?device=${device}`, null, again.token)).status, 401);
  assert.equal((await call('/api/login', { login: 'tester', key: keyOf('tester', 'reset99'), device })).error, 'blocked');
  await call('/admin/api/user', { id, action: 'unblock' }, admin);
  const out = await call('/api/login', { login: 'tester', key: keyOf('tester', 'reset99'), device });
  await call('/api/logout', {}, out.token);
  assert.equal((await call(`/api/me?device=${device}`, null, out.token)).status, 401);

  // перебор пароля тормозится, верный пароль потом тоже ждёт
  const tries = [];
  for (let i = 0; i < 10; i++) tries.push((await call('/api/login', { login: 'second', key: keyOf('second', 'x00000'), device })).status);
  assert.deepEqual(tries, [401, 401, 401, 401, 401, 401, 401, 401, 429, 429]);
  assert.equal((await call('/api/login', { login: 'second', key: keyOf('second', 'secret1'), device })).status, 429);

  const page = await fetch(`${BASE}/admin`);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(await page.text(), /Припев — управление/);

  console.log('Сервер: все проверки прошли');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  stop();
}
