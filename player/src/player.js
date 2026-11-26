// Очередь и проигрывание.

export function createPlayer(audio, { exists, onChange, onSkip, onPlayed }) {
  const s = { list: [], source: [], index: -1, shuffle: false, repeat: 'off' };
  let loaded = null;
  let failures = 0;
  let counted = false;
  let listened = 0;
  let last = 0;

  const current = () => s.list[s.index] ?? null;

  function shuffled(ids) {
    const a = [...ids];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function load(autoplay, at = 0) {
    const id = current();
    loaded = id;
    counted = false;
    listened = 0;
    last = at;
    if (!id) {
      audio.removeAttribute('src');
      audio.load();
    } else {
      // «#t=» открывает сразу с нужной секунды
      audio.src = `media://track/${id}${at > 1 ? `#t=${at.toFixed(1)}` : ''}`;
      if (autoplay) audio.play().catch(() => {});
    }
    onChange('track');
  }

  const api = {
    state: s,
    current,
    get playing() { return !audio.paused && !audio.ended; },

    // включить список с нужного места; from < 0 — любое место
    playList(ids, from = 0, shuffle = s.shuffle) {
      if (!ids.length) return;
      s.shuffle = shuffle;
      s.source = [...ids];
      const start = from < 0 ? (shuffle ? Math.floor(Math.random() * ids.length) : 0) : from;
      if (shuffle) {
        s.list = [ids[start], ...shuffled(ids.filter((_, i) => i !== start))];
        s.index = 0;
      } else {
        s.list = [...ids];
        s.index = start;
      }
      failures = 0;
      load(true);
    },

    toggle() {
      if (!current()) return false;
      if (loaded !== current() || audio.error) load(true);
      else if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
      return true;
    },

    next(auto = false) {
      if (!s.list.length) return;
      if (auto && s.repeat === 'one') {
        audio.currentTime = 0;
        counted = false;
        listened = 0;
        audio.play().catch(() => {});
        return;
      }
      if (s.index < s.list.length - 1) {
        s.index++;
        load(true);
      } else if (s.repeat === 'all' || !auto) {
        if (s.shuffle) s.list = shuffled(s.list);
        s.index = 0;
        load(true);
      } else {
        s.index = 0;
        load(false);
      }
    },

    prev() {
      if (!s.list.length) return;
      if (audio.currentTime > 3 || (s.index === 0 && s.repeat !== 'all')) {
        audio.currentTime = 0;
      } else {
        s.index = (s.index - 1 + s.list.length) % s.list.length;
        load(true);
      }
    },

    jump(index) {
      if (index < 0 || index >= s.list.length) return;
      s.index = index;
      load(true);
    },

    seek(t) {
      if (!current() || !Number.isFinite(audio.duration)) return;
      audio.currentTime = Math.max(0, Math.min(t, audio.duration - 0.05));
      last = audio.currentTime;
    },

    toggleShuffle() {
      s.shuffle = !s.shuffle;
      const id = current();
      if (id) {
        if (s.shuffle) {
          const rest = [...s.source];
          rest.splice(rest.indexOf(id), 1);
          s.list = [id, ...shuffled(rest)];
          s.index = 0;
        } else {
          s.list = [...s.source];
          s.index = Math.max(0, s.list.indexOf(id));
        }
      }
      onChange('queue');
    },

    cycleRepeat() {
      s.repeat = { off: 'all', all: 'one', one: 'off' }[s.repeat];
      onChange('queue');
    },

    // next=true — сразу после текущего, иначе в конец
    enqueue(ids, next = false) {
      if (!ids.length) return;
      if (!s.list.length) {
        s.list = [...ids];
        s.source = [...ids];
        s.index = 0;
        load(false);
        return;
      }
      if (next) {
        s.list.splice(s.index + 1, 0, ...ids);
        s.source.splice(s.source.indexOf(current()) + 1, 0, ...ids);
      } else {
        s.list.push(...ids);
        s.source.push(...ids);
      }
      onChange('queue');
    },

    removeAt(i) {
      if (i < 0 || i >= s.list.length) return;
      const [id] = s.list.splice(i, 1);
      s.source.splice(s.source.indexOf(id), 1);
      if (i < s.index) s.index--;
      else if (i === s.index) {
        const wasPlaying = api.playing;
        s.index = Math.min(s.index, s.list.length - 1);
        load(wasPlaying);
        return;
      }
      onChange('queue');
    },

    move(from, to) {
      if (from === to || from < 0 || from >= s.list.length) return;
      const keep = s.index;
      const [item] = s.list.splice(from, 1);
      s.list.splice(to, 0, item);
      if (from === keep) s.index = to;
      else if (from < keep && to >= keep) s.index = keep - 1;
      else if (from > keep && to <= keep) s.index = keep + 1;
      onChange('queue');
    },

    clearUpcoming() {
      for (const id of s.list.splice(s.index + 1)) s.source.splice(s.source.lastIndexOf(id), 1);
      onChange('queue');
    },

    // треки пропали из библиотеки или переехали
    sync(moves = {}) {
      const map = (id) => moves[id] || id;
      const before = current();
      s.source = s.source.map(map).filter(exists);
      const kept = s.list.map(map);
      const index = kept.slice(0, Math.max(0, s.index)).filter(exists).length;
      s.list = kept.filter(exists);
      s.index = s.list.length ? Math.min(index, s.list.length - 1) : -1;
      if (current() === before) return;
      // тот же файл под новым именем продолжает с той же секунды
      if (before && map(before) === current()) load(api.playing, audio.currentTime);
      else load(false);
    },

    restore(saved) {
      if (!saved) return;
      s.shuffle = Boolean(saved.shuffle);
      s.repeat = ['off', 'all', 'one'].includes(saved.repeat) ? saved.repeat : 'off';
      const list = (saved.list || []).filter(exists);
      if (!list.length) return;
      s.list = list;
      s.source = (saved.source || list).filter(exists);
      const id = saved.list[saved.index];
      s.index = Math.max(0, list.indexOf(id));
      load(false, exists(id) ? saved.position || 0 : 0);
    },

    snapshot() {
      return { list: s.list, source: s.source, index: s.index, shuffle: s.shuffle, repeat: s.repeat, position: current() ? audio.currentTime || 0 : 0 };
    },
  };

  audio.addEventListener('ended', () => api.next(true));
  audio.addEventListener('playing', () => { failures = 0; });
  audio.addEventListener('error', () => {
    if (!current() || !audio.getAttribute('src')) return;
    const id = current();
    failures++;
    onSkip(id);
    // если не открывается ничего, не крутимся по кругу
    if (failures < Math.min(5, s.list.length) && s.index < s.list.length - 1) api.next(false);
    else onChange('state');
  });
  // трек засчитывается, когда прослушана половина или 30 секунд
  audio.addEventListener('timeupdate', () => {
    const t = audio.currentTime;
    if (t > last && t - last < 2) listened += t - last;
    last = t;
    if (!counted && current() && listened >= Math.min(30, (audio.duration || 60) / 2)) {
      counted = true;
      onPlayed(current());
    }
  });
  for (const ev of ['play', 'pause', 'durationchange', 'seeked', 'volumechange']) audio.addEventListener(ev, () => onChange('state'));

  return api;
}
