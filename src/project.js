// Автосохранение, файл проекта и темы оформления.

const DB = 'pripev';
const STORE = 'kv';
let opened = null;

function database() {
  opened ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opened;
}

async function run(mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export const dbGet = (key) => run('readonly', (s) => s.get(key));
export const dbSet = (key, value) => run('readwrite', (s) => (value == null ? s.delete(key) : s.put(value, key)));
export const dbClear = () => run('readwrite', (s) => s.clear());

/* ---------- файл проекта: заголовок JSON, за ним песня и картинки ---------- */

const MAGIC = 'PRIPEV1\n';
export const FILE_KEYS = ['audio', 'cover', 'card'];

export function packProject(doc, files) {
  const list = FILE_KEYS.filter((k) => files[k]).map((k) => ({ key: k, name: files[k].name || k, type: files[k].type, size: files[k].size }));
  const head = new TextEncoder().encode(JSON.stringify({ doc, files: list }));
  const length = new DataView(new ArrayBuffer(4));
  length.setUint32(0, head.length, true);
  return new Blob([MAGIC, length.buffer, head, ...list.map((f) => files[f.key])], { type: 'application/octet-stream' });
}

export async function unpackProject(file) {
  const start = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (new TextDecoder().decode(start.slice(0, 8)) !== MAGIC) throw new Error('это не проект «Припев»');
  const size = new DataView(start.buffer).getUint32(8, true);
  const head = JSON.parse(await file.slice(12, 12 + size).text());
  let at = 12 + size;
  const files = {};
  for (const f of head.files) {
    if (!FILE_KEYS.includes(f.key) || at + f.size > file.size) throw new Error('файл проекта повреждён');
    files[f.key] = new File([file.slice(at, at + f.size)], f.name, { type: f.type });
    at += f.size;
  }
  return { doc: head.doc, files };
}

/* ---------- темы ---------- */

const theme = (name, accent, effect, bgMode, mono, strength = 70, pulse = 60) => ({
  name, controls: { accent, autoAccent: false, effect, bgMode, mono, strength, pulse },
});

export const THEMES = [
  theme('Красный дождь', '#ff4d62', 'rain', 'glow', true),
  theme('Синяя ночь', '#5a8dff', 'rain', 'cover', true, 55, 50),
  theme('Снег', '#8fd4ff', 'snow', 'cover', false, 65, 40),
  theme('Искры', '#ff9a3d', 'sparks', 'glow', false, 80, 80),
  theme('VHS', '#e46bff', 'vhs', 'cover', false, 70, 55),
  theme('Глитч', '#2fe3c6', 'glitch', 'glow', true, 75, 85),
  { name: 'Из обложки', controls: { autoAccent: true, effect: 'none', bgMode: 'cover', mono: false, strength: 70, pulse: 55 } },
];

const PRESETS = 'pripev.presets';
export function loadPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS)) || []; } catch { return []; }
}
export function savePresets(list) {
  try { localStorage.setItem(PRESETS, JSON.stringify(list)); return true; } catch { return false; }
}
