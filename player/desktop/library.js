// Библиотека музыки: обход папок, теги, обложки и тексты. Работает в главном процессе.
// Файлы пользователя только читаются.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const AUDIO = new Set(['.mp3', '.m4a', '.m4b', '.aac', '.flac', '.wav', '.ogg', '.oga', '.opus', '.webm']);
const FOLDER_ART = /^(cover|folder|front|album|обложка)\.(jpe?g|png|webp)$/i;
const PARSER = 1; // увеличить, чтобы все теги перечитались после изменений в разборе

const sha = (data) => crypto.createHash('sha1').update(data).digest('hex').slice(0, 16);
const same = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const trackId = (p) => sha(same(p));
const inside = (file, dir) => same(file).startsWith(same(dir.endsWith(path.sep) ? dir : dir + path.sep));

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    // повреждённый файл не затираем: оставляем копию
    if (e.code !== 'ENOENT') { try { fs.copyFileSync(file, `${file}.broken`); } catch { /* нечего спасать */ } }
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
  fs.renameSync(`${file}.tmp`, file);
}

// тексты в старой кодировке Windows тоже читаются
function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1251').decode(buf);
  }
}

async function walk(dir, out, depth = 0) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('$')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < 12 && e.name !== 'node_modules') await walk(p, out, depth + 1);
    } else if (AUDIO.has(path.extname(e.name).toLowerCase())) {
      out.push(p);
    }
  }
}

class Library {
  constructor({ dir, nativeImage, onUpdate, onProgress }) {
    this.file = path.join(dir, 'library.json');
    this.coverDir = path.join(dir, 'covers');
    this.lyricsDir = path.join(dir, 'lyrics');
    fs.mkdirSync(this.coverDir, { recursive: true });
    fs.mkdirSync(this.lyricsDir, { recursive: true });
    this.nativeImage = nativeImage;
    this.onUpdate = onUpdate;
    this.onProgress = onProgress;
    this.data = { folders: [], files: [], hidden: [], tracks: {}, covers: {}, ...readJson(this.file, {}) };
    this.watchers = [];
    this.running = null;
    this.again = false;
    this.moves = {};
  }

  save() { writeJson(this.file, this.data); }

  snapshot() {
    const tracks = Object.values(this.data.tracks).map((t) => {
      const { path: p, mtime, size, parser, ...rest } = t;
      return { ...rest, file: path.basename(p), dir: path.dirname(p) };
    });
    return { folders: this.data.folders, tracks, covers: this.data.covers, scanning: Boolean(this.running), moves: this.moves };
  }

  pathOf(id) { return Object.hasOwn(this.data.tracks, id) ? this.data.tracks[id].path : null; }

  coverFile(hash, thumb) {
    if (!Object.hasOwn(this.data.covers, hash)) return null;
    const c = this.data.covers[hash];
    return path.join(this.coverDir, thumb && c.thumb ? `${hash}.t.jpg` : `${hash}.${c.ext}`);
  }

  /* ---------- папки и файлы ---------- */

  // возвращает треки из добавленного
  async add(paths) {
    const dirs = [];
    const files = [];
    for (const raw of paths) {
      if (typeof raw !== 'string' || !path.isAbsolute(raw)) continue;
      const p = path.resolve(raw);
      let st;
      try { st = await fsp.stat(p); } catch { continue; }
      if (st.isDirectory()) {
        this.data.hidden = this.data.hidden.filter((h) => !inside(h, p));
        if (!this.data.folders.some((f) => same(f) === same(p) || inside(p, f))) {
          this.data.folders = this.data.folders.filter((f) => !inside(f, p));
          this.data.files = this.data.files.filter((f) => !inside(f, p));
          this.data.folders.push(p);
        }
        dirs.push(p);
      } else if (AUDIO.has(path.extname(p).toLowerCase())) {
        this.data.hidden = this.data.hidden.filter((h) => same(h) !== same(p));
        if (!this.data.folders.some((f) => inside(p, f)) && !this.data.files.some((f) => same(f) === same(p))) {
          this.data.files.push(p);
        }
        files.push(trackId(p));
      }
    }
    if (!dirs.length && !files.length) return [];
    this.save();
    this.watch();
    await this.scan();
    const order = new Intl.Collator('ru', { numeric: true });
    const found = Object.values(this.data.tracks).filter((t) => dirs.some((d) => inside(t.path, d)))
      .sort((a, b) => order.compare(a.path, b.path)).map((t) => t.id);
    return [...new Set([...files.filter((id) => this.data.tracks[id]), ...found])];
  }

  async removeFolder(folder) {
    this.data.folders = this.data.folders.filter((f) => f !== folder);
    this.data.hidden = this.data.hidden.filter((h) => !inside(h, folder));
    for (const [id, t] of Object.entries(this.data.tracks)) {
      if (inside(t.path, folder) && !this.data.files.some((f) => same(f) === same(t.path))) delete this.data.tracks[id];
    }
    this.save();
    this.watch();
    this.onUpdate();
    await this.scan();
  }

  // убирает из библиотеки, сам файл остаётся на диске
  removeTracks(ids) {
    for (const id of ids) {
      const p = this.pathOf(id);
      if (!p) continue;
      this.data.files = this.data.files.filter((f) => same(f) !== same(p));
      if (this.data.folders.some((f) => inside(p, f))) this.data.hidden.push(p);
      delete this.data.tracks[id];
    }
    this.save();
    this.onUpdate();
  }

  watch() {
    this.watchers.forEach((w) => w.close());
    this.watchers = [];
    for (const folder of this.data.folders) {
      try {
        const w = fs.watch(folder, { recursive: true }, (_event, name) => {
          if (name && path.extname(String(name)) && !AUDIO.has(path.extname(String(name)).toLowerCase())) return;
          clearTimeout(this.timer);
          this.timer = setTimeout(() => this.scan(), 3000);
        });
        w.on('error', () => w.close());
        this.watchers.push(w);
      } catch { /* папка сейчас недоступна */ }
    }
  }

  /* ---------- чтение ---------- */

  // одновременно идёт только один обход; просьбы во время него повторят его в конце
  scan() {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.pass();
      } while (this.again);
    })()
      .catch((e) => console.error('scan', e))
      .finally(() => {
        this.running = null;
        this.onProgress(null);
        this.onUpdate();
      });
    return this.running;
  }

  async pass() {
    const found = [];
    const offline = [];
    for (const folder of this.data.folders) {
      if (fs.existsSync(folder)) await walk(folder, found);
      else offline.push(folder); // отключённый диск: треки не забываем
    }
    for (const f of this.data.files) if (fs.existsSync(f)) found.push(f);
    const hidden = new Set(this.data.hidden.map(same));
    const wanted = new Map();
    for (const p of found) if (!hidden.has(same(p))) wanted.set(trackId(p), p);

    const gone = [];
    for (const [id, t] of Object.entries(this.data.tracks)) {
      if (wanted.has(id) || offline.some((f) => inside(t.path, f))) continue;
      gone.push(t);
      delete this.data.tracks[id];
    }

    const jobs = [];
    for (const [id, p] of wanted) {
      let st;
      try { st = await fsp.stat(p); } catch { continue; }
      const old = this.data.tracks[id];
      if (old && old.mtime === st.mtimeMs && old.size === st.size && old.parser === PARSER) continue;
      jobs.push({ id, p, st, old });
    }

    const fresh = new Set(jobs.filter((j) => !j.old).map((j) => j.id));
    let done = 0;
    let shown = Date.now();
    const total = jobs.length;
    if (total) this.onProgress({ done, total });
    const worker = async () => {
      for (let job = jobs.shift(); job; job = jobs.shift()) {
        const track = await this.read(job);
        // пока читали, трек могли убрать из библиотеки
        if (!this.data.hidden.some((h) => same(h) === same(job.p))) this.data.tracks[job.id] = track;
        done++;
        this.onProgress({ done, total });
        if (Date.now() - shown > 1500) {
          shown = Date.now();
          this.onUpdate();
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);

    // файл переименовали или переложили: избранное и плейлисты переезжают вместе с ним
    this.moves = {};
    for (const old of gone) {
      const id = [...fresh].find((k) => this.data.tracks[k]?.size === old.size && this.data.tracks[k].duration === old.duration);
      if (id) {
        fresh.delete(id);
        this.moves[old.id] = id;
        this.data.tracks[id].added = old.added;
      }
    }
    this.save();
  }

  async read({ id, p, st, old }) {
    const track = {
      id, path: p, mtime: st.mtimeMs, size: st.size, parser: PARSER,
      added: old?.added || Math.round(st.birthtimeMs || st.mtimeMs),
      title: '', artist: '', album: '', albumArtist: '', no: 0, disc: 0, year: 0, duration: 0, cover: null,
    };
    let picture = null;
    try {
      this.mm ||= await import('music-metadata');
      const { common, format } = await this.mm.parseFile(p, { duration: true });
      Object.assign(track, {
        title: common.title || '',
        artist: common.artist || '',
        album: common.album || '',
        albumArtist: common.albumartist || '',
        no: common.track?.no || 0,
        disc: common.disk?.no || 0,
        year: common.year || 0,
        duration: Math.round((format.duration || 0) * 100) / 100,
      });
      picture = common.picture?.find((x) => /front/i.test(x.type || '')) || common.picture?.[0];
    } catch { /* теги не читаются: покажем имя файла */ }
    try {
      if (picture) track.cover = this.saveCover(Buffer.from(picture.data), picture.format);
      if (!track.cover) track.cover = await this.folderCover(path.dirname(p));
    } catch (e) { console.error('cover', p, e.message); }
    return track;
  }

  async folderCover(dir) {
    // имя картинки в папке одно на все треки, поэтому запоминаем
    this.dirCovers ||= new Map();
    const hit = this.dirCovers.get(dir);
    if (hit && Date.now() - hit.at < 5000) return hit.hash;
    let hash = null;
    try {
      const name = (await fsp.readdir(dir)).find((n) => FOLDER_ART.test(n));
      if (name) hash = this.saveCover(await fsp.readFile(path.join(dir, name)));
    } catch { /* без обложки */ }
    this.dirCovers.set(dir, { hash, at: Date.now() });
    return hash;
  }

  saveCover(buf, format = '') {
    if (!buf?.length || buf.length > 20e6) return null;
    const ext = buf[0] === 0x89 ? 'png' : buf[0] === 0xff ? 'jpg' : buf.subarray(8, 12).toString() === 'WEBP' ? 'webp' : /gif/i.test(format) || buf.subarray(0, 3).toString() === 'GIF' ? 'gif' : null;
    if (!ext) return null;
    const hash = sha(buf);
    if (this.data.covers[hash] && fs.existsSync(path.join(this.coverDir, `${hash}.${ext}`))) return hash;
    fs.writeFileSync(path.join(this.coverDir, `${hash}.${ext}`), buf);
    const info = { ext, thumb: false, color: null };
    const img = this.nativeImage.createFromBuffer(buf);
    if (!img.isEmpty()) {
      info.color = tint(img.resize({ width: 24, height: 24 }).toBitmap());
      if (img.getSize().width > 420) {
        fs.writeFileSync(path.join(this.coverDir, `${hash}.t.jpg`), img.resize({ width: 360, quality: 'good' }).toJPEG(86));
        info.thumb = true;
      }
    }
    this.data.covers[hash] = info;
    return hash;
  }

  /* ---------- тексты ---------- */

  async lyrics(id) {
    const p = this.pathOf(id);
    if (!p) return null;
    const read = async (file) => {
      try {
        const st = await fsp.stat(file);
        if (st.size > 500e3) return null;
        return decodeText(await fsp.readFile(file)).replace(/^﻿/, '');
      } catch { return null; }
    };
    const saved = await read(path.join(this.lyricsDir, `${id}.lrc`));
    if (saved !== null) return { source: 'saved', text: saved };
    const side = await read(`${p.slice(0, -path.extname(p).length)}.lrc`);
    if (side?.trim()) return { source: 'file', text: side };
    try {
      this.mm ||= await import('music-metadata');
      const { common } = await this.mm.parseFile(p, { skipCovers: true });
      for (const item of common.lyrics || []) {
        if (typeof item === 'string' && item.trim()) return { source: 'tags', text: item };
        if (item?.syncText?.length && item.timeStampFormat !== 1) {
          const text = item.syncText.map((l) => {
            const c = Math.round((l.timestamp || 0) / 10);
            const n = (v) => String(v).padStart(2, '0');
            return `[${n(Math.floor(c / 6000))}:${n(Math.floor(c / 100) % 60)}.${n(c % 100)}] ${String(l.text).trim()}`;
          }).join('\n');
          return { source: 'tags', text };
        }
        if (item?.text?.trim()) return { source: 'tags', text: item.text };
      }
    } catch { /* нет текста в тегах */ }
    return null;
  }

  // null — забыть свой вариант; пустая строка — «у этого трека текст не нужен»
  saveLyrics(id, text) {
    if (!this.pathOf(id)) return;
    const file = path.join(this.lyricsDir, `${id}.lrc`);
    if (text === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, String(text).slice(0, 200e3));
  }
}

// цвет обложки для фона: самый заметный насыщенный оттенок, а не серая смесь всех
function tint(bgra) {
  const hues = Array.from({ length: 12 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < bgra.length; i += 4) {
    const [b, g, r] = [bgra[i], bgra[i + 1], bgra[i + 2]];
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    const hue = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    const weight = 0.01 + (max ? d / max : 0) * (max / 255);
    const bin = hues[Math.floor(hue * 2) % 12];
    bin.weight += weight; bin.r += r * weight; bin.g += g * weight; bin.b += b * weight;
  }
  const best = hues.reduce((x, y) => (y.weight > x.weight ? y : x));
  return `#${[best.r, best.g, best.b].map((v) => Math.round(v / best.weight).toString(16).padStart(2, '0')).join('')}`;
}

module.exports = { Library, readJson, writeJson, trackId };
