/* Aurora Music — frontend player logic (vanilla JS). */
'use strict';

const el = (id) => document.getElementById(id);

const NOTE_SVG = '<svg viewBox="0 0 24 24"><path d="M9 18V6l12-2v12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" fill="currentColor"/><circle cx="18" cy="16" r="3" fill="currentColor"/></svg>';
const PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';
const REPEAT_SVG = '<svg viewBox="0 0 24 24"><path d="M17 3l3 3-3 3M4 6h10a3 3 0 0 1 3 3v1M7 21l-3-3 3-3M20 18H10a3 3 0 0 1-3-3v-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const REPEAT_ONE_SVG = '<svg viewBox="0 0 24 24"><path d="M17 3l3 3-3 3M4 6h10a3 3 0 0 1 3 3v1M7 21l-3-3 3-3M20 18H10a3 3 0 0 1-3-3v-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="15.5" font-size="9.5" fill="currentColor" text-anchor="middle" font-weight="800">1</text></svg>';
const VOL_SVG = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3z" fill="currentColor"/><path d="M16 8a5 5 0 0 1 0 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const VOL_MUTE_SVG = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const DOWNLOAD_SVG = '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12l4 4L19 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const audio = el('audio');

const state = {
  tracks: [],
  currentId: null,
  shuffle: false,
  repeat: 0, // 0 off, 1 all, 2 one
  playing: false,
  serverBase: (localStorage.getItem('aurora_server') || ''),
  cookiesBrowser: (localStorage.getItem('aurora_cookies_browser') || ''),
  volume: parseFloat(localStorage.getItem('aurora_volume') || '1'),
  artUrls: {},   // id -> objectURL (offline covers)
  audioUrls: {}, // id -> objectURL (offline audio)
};

let seeking = false;
let toastTimer = null;

// ---------------------------------------------------------------- helpers
function api(p) { return state.serverBase + p; }

function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function plural(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return n + ' трек';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return n + ' трека';
  return n + ' треков';
}

function isUrl(s) { return /^https?:\/\//i.test(String(s || '').trim()); }

function shuffleArray(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function trackById(id) { return state.tracks.find((t) => t.id === id) || null; }

function toast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function paintRange(r) {
  const min = parseFloat(r.min) || 0, max = parseFloat(r.max) || 1;
  const p = ((parseFloat(r.value) - min) / (max - min)) * 100;
  r.style.setProperty('--range-bg', `linear-gradient(to right, #d946ef 0%, #d946ef ${p}%, rgba(255,255,255,0.14) ${p}%, rgba(255,255,255,0.14) 100%)`);
}

function artSrc(t) {
  if (state.artUrls[t.id]) return state.artUrls[t.id];
  if (t.artFile && !t.offline) return api('/api/art/' + encodeURIComponent(t.id));
  return '';
}

// ---------------------------------------------------------------- volume
function setMiniVolIcon(muted) {
  el('miniVol').innerHTML = muted ? VOL_MUTE_SVG : VOL_SVG;
}

function setVolume(v) {
  v = Math.max(0, Math.min(1, parseFloat(v) || 0));
  state.volume = v;
  audio.volume = v;
  try { localStorage.setItem('aurora_volume', String(v)); } catch {}
  el('volume').value = v; paintRange(el('volume'));
  el('volPopSlider').value = v; paintRange(el('volPopSlider'));
  setMiniVolIcon(v === 0);
}

// ---------------------------------------------------------------- offline
async function refreshOfflineState() {
  const map = {};
  try {
    const recs = await OfflineDB.list();
    for (const r of recs) {
      map[r.id] = true;
      if (r.artBlob && !state.artUrls[r.id]) state.artUrls[r.id] = URL.createObjectURL(r.artBlob);
    }
  } catch {}
  return map;
}

async function downloadOffline(t) {
  toast('Сохраняю офлайн…');
  try {
    const [audioRes, artRes] = await Promise.all([
      fetch(api('/api/audio/' + encodeURIComponent(t.id))),
      t.artFile ? fetch(api('/api/art/' + encodeURIComponent(t.id))).catch(() => null) : Promise.resolve(null),
    ]);
    if (!audioRes.ok) throw new Error('аудио ' + audioRes.status);
    const audioBlob = await audioRes.blob();
    const artBlob = artRes && artRes.ok ? await artRes.blob() : null;
    await OfflineDB.save({
      id: t.id, title: t.title, artist: t.artist, album: t.album,
      duration: t.duration, fileName: t.fileName, source: t.source,
      addedAt: t.addedAt, size: t.size, audioBlob, artBlob,
    });
    if (artBlob) state.artUrls[t.id] = URL.createObjectURL(artBlob);
    t.offline = true;
    renderLibrary();
    toast('Сохранено офлайн ✓');
  } catch (e) {
    toast('Не удалось сохранить офлайн: ' + (e && e.message ? e.message : 'ошибка'));
  }
}

async function removeOffline(t) {
  try { await OfflineDB.remove(t.id); } catch {}
  t.offline = false;
  if (state.artUrls[t.id]) { URL.revokeObjectURL(state.artUrls[t.id]); delete state.artUrls[t.id]; }
  if (state.audioUrls[t.id]) { URL.revokeObjectURL(state.audioUrls[t.id]); delete state.audioUrls[t.id]; }
  renderLibrary();
  toast('Офлайн-копия удалена');
}

// ---------------------------------------------------------------- library
function renderLibrary() {
  const lib = el('library');
  lib.replaceChildren();

  for (const t of state.tracks) {
    const row = document.createElement('div');
    row.className = 'track' + (t.id === state.currentId ? ' playing' : '');
    row.dataset.id = t.id;

    const cover = document.createElement('div');
    cover.className = 'cover md';
    const src = artSrc(t);
    if (src) {
      const img = document.createElement('img');
      img.src = src; img.alt = '';
      cover.appendChild(img);
    } else {
      cover.innerHTML = NOTE_SVG;
    }

    const info = document.createElement('div');
    info.className = 'info';
    const title = document.createElement('div');
    title.className = 't-title';
    title.textContent = t.title;
    const artist = document.createElement('div');
    artist.className = 't-artist';
    artist.textContent = t.artist || 'Неизвестный исполнитель';
    info.append(title, artist);

    const dl = document.createElement('button');
    dl.className = 'track-dl' + (t.offline ? ' offline' : '');
    dl.title = t.offline ? 'Удалить офлайн-копию' : 'Скачать офлайн';
    dl.innerHTML = t.offline ? CHECK_SVG : DOWNLOAD_SVG;
    dl.addEventListener('click', (e) => { e.stopPropagation(); if (t.offline) removeOffline(t); else downloadOffline(t); });

    const eq = document.createElement('div');
    eq.className = 'eq';
    eq.innerHTML = '<span></span><span></span><span></span>';

    const dur = document.createElement('div');
    dur.className = 'dur';
    dur.textContent = t.duration ? fmtTime(t.duration) : '';

    row.append(cover, info, dl, eq, dur);
    row.addEventListener('click', () => playTrack(t.id));
    lib.appendChild(row);
  }

  el('emptyState').classList.toggle('hidden', state.tracks.length > 0);
  el('trackCount').textContent = plural(state.tracks.length);
}

async function loadTracks() {
  const offlineMap = await refreshOfflineState();
  let serverTracks = null;
  try {
    const res = await fetch(api('/api/tracks'));
    if (res.ok) { const data = await res.json(); serverTracks = data.tracks || []; }
  } catch {}

  if (serverTracks) {
    for (const t of serverTracks) t.offline = !!offlineMap[t.id];
    state.tracks = serverTracks;
  } else {
    // офлайн-режим: библиотека из локального хранилища
    let recs = [];
    try { recs = await OfflineDB.list(); } catch {}
    state.tracks = recs.map((r) => ({
      id: r.id, title: r.title, artist: r.artist || '', album: r.album || '',
      duration: r.duration || 0, fileName: r.fileName || '', artFile: r.artBlob ? 'local' : null,
      source: r.source || '', addedAt: r.addedAt || 0, size: r.size || 0, offline: true,
    }));
  }
  renderLibrary();
}

// ---------------------------------------------------------------- playback
function setPlaying(playing) {
  state.playing = playing;
  el('miniPlay').innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
  el('npPlay').innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
  if ('mediaSession' in navigator) {
    try { navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch {}
  }
}

async function playTrack(id, opts = {}) {
  const t = trackById(id);
  if (!t) return;
  state.currentId = id;
  let src = api('/api/audio/' + encodeURIComponent(id));
  if (t.offline) {
    try {
      const rec = await OfflineDB.get(id);
      if (rec && rec.audioBlob) {
        if (!state.audioUrls[id]) state.audioUrls[id] = URL.createObjectURL(rec.audioBlob);
        src = state.audioUrls[id];
      }
    } catch {}
  }
  audio.src = src;
  const p = audio.play();
  if (p && p.catch) p.catch(() => { if (!opts.silent) toast('Нажмите ▶ для воспроизведения'); });
  updateNowPlaying();
  renderLibrary();
  el('mini').classList.remove('hidden');
}

function togglePlay() {
  if (!state.currentId) return;
  if (audio.paused) audio.play().catch(() => toast('Нажмите ▶ для воспроизведения'));
  else audio.pause();
}

function getOrder() {
  let ids = state.tracks.map((t) => t.id);
  if (state.shuffle) {
    ids = shuffleArray(ids);
    if (state.currentId) {
      const i = ids.indexOf(state.currentId);
      if (i > 0) { ids.splice(i, 1); ids.unshift(state.currentId); }
    }
  }
  return ids;
}

function next() {
  const order = getOrder();
  const i = order.indexOf(state.currentId);
  if (i === -1) { if (order[0]) playTrack(order[0]); return; }
  if (i < order.length - 1) playTrack(order[i + 1]);
  else if (state.repeat === 1) playTrack(order[0]);
}

function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  const order = getOrder();
  const i = order.indexOf(state.currentId);
  if (i > 0) playTrack(order[i - 1]);
  else if (state.repeat === 1 && order.length) playTrack(order[order.length - 1]);
  else audio.currentTime = 0;
}

function onEnded() {
  if (state.repeat === 2) { audio.currentTime = 0; audio.play().catch(() => {}); return; }
  const order = getOrder();
  const i = order.indexOf(state.currentId);
  if (i !== -1 && i < order.length - 1) { playTrack(order[i + 1]); return; }
  if (state.repeat === 1 && order.length) { playTrack(order[0]); return; }
  setPlaying(false);
}

function updateNowPlaying() {
  const t = trackById(state.currentId);
  const miniTitle = el('miniTitle'), miniArtist = el('miniArtist'), miniCover = el('miniCover');
  const npTitle = el('npTitle'), npArtist = el('npArtist'), npCover = el('npCover');
  if (!t) {
    miniTitle.textContent = '—'; miniArtist.textContent = '—';
    npTitle.textContent = '—'; npArtist.textContent = '—';
    return;
  }
  miniTitle.textContent = t.title;
  miniArtist.textContent = t.artist || 'Неизвестный исполнитель';
  npTitle.textContent = t.title;
  npArtist.textContent = t.artist || 'Неизвестный исполнитель';
  const src = artSrc(t);
  miniCover.innerHTML = src ? `<img src="${src}" alt="">` : NOTE_SVG;
  npCover.innerHTML = src ? `<img src="${src}" alt="">` : NOTE_SVG;

  if ('mediaSession' in navigator && navigator.mediaSession) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist || '',
        album: t.album || '',
        artwork: src ? [{ src, sizes: '512x512', type: 'image/jpeg' }] : [],
      });
    } catch {}
  }

  el('miniProgress').style.width = '0%';
  el('seek').value = 0; paintRange(el('seek'));
  el('curTime').textContent = '0:00';
  el('totalTime').textContent = t.duration ? fmtTime(t.duration) : '0:00';
}

function stopPlayback() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  state.currentId = null;
  setPlaying(false);
  el('mini').classList.add('hidden');
  el('nowPlaying').classList.remove('open');
  document.body.classList.remove('lock');
  renderLibrary();
}

// ---------------------------------------------------------------- sheet / search
function openSheet() {
  el('addSheet').classList.add('open');
  document.body.classList.add('lock');
  el('searchInput').value = '';
  el('searchResults').replaceChildren();
  el('downloadState').classList.add('hidden');
  setTimeout(() => el('searchInput').focus(), 260);
}
function closeSheet() {
  el('addSheet').classList.remove('open');
  document.body.classList.remove('lock');
}

async function doSearch(q) {
  el('searchResults').replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'sheet-hint';
  loading.textContent = 'Ищу…';
  el('searchResults').appendChild(loading);
  try {
    const res = await fetch(api('/api/search'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q }) });
    const data = await res.json();
    if (data.error) { toast(data.error); el('searchResults').replaceChildren(); return; }
    renderResults(data.results || []);
  } catch {
    toast('Ошибка поиска (нет связи с сервером?)');
    el('searchResults').replaceChildren();
  }
}

function renderResults(results) {
  const box = el('searchResults');
  box.replaceChildren();
  if (!results.length) {
    const d = document.createElement('div');
    d.className = 'sheet-hint';
    d.textContent = 'Ничего не найдено. Попробуйте другой запрос или вставьте ссылку.';
    box.appendChild(d);
    return;
  }
  for (const r of results) {
    const row = document.createElement('div');
    row.className = 'result';
    const info = document.createElement('div');
    info.className = 'r-info';
    const title = document.createElement('div');
    title.className = 'r-title';
    title.textContent = r.title;
    const chan = document.createElement('div');
    chan.className = 'r-channel';
    chan.textContent = (r.channel || '') + (r.duration ? ' · ' + fmtTime(r.duration) : '');
    info.append(title, chan);
    const add = document.createElement('button');
    add.className = 'r-add';
    add.title = 'Скачать';
    add.innerHTML = DOWNLOAD_SVG;
    row.append(info, add);
    row.addEventListener('click', () => { startDownload({ id: r.id, title: r.title }); });
    add.addEventListener('click', (e) => { e.stopPropagation(); startDownload({ id: r.id, title: r.title }); });
    box.appendChild(row);
  }
}

// ---------------------------------------------------------------- download (server)
function showDownload(d) {
  const box = el('downloadState');
  if (!d) { box.classList.add('hidden'); box.replaceChildren(); return; }
  box.classList.remove('hidden');
  box.replaceChildren();
  const title = document.createElement('div');
  title.className = 'ds-title';
  title.textContent = d.title || 'Скачивание…';
  box.appendChild(title);
  if (!d.error) {
    const sub = document.createElement('div');
    sub.className = 'ds-sub';
    sub.textContent = d.progress >= 0 ? Math.round(d.progress) + '%' : 'Подготовка…';
    box.appendChild(sub);
    if (d.progress >= 0) {
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      fill.style.width = d.progress + '%';
      bar.appendChild(fill);
      box.appendChild(bar);
    }
  } else {
    const err = document.createElement('div');
    err.className = 'ds-err';
    err.textContent = d.error;
    box.appendChild(err);
  }
}

async function startDownload(payload) {
  showDownload({ title: payload.title || 'Скачивание…', progress: 0 });
  try {
    const body = payload.id ? { id: payload.id } : { input: payload.input };
    body.cookiesBrowser = state.cookiesBrowser;
    const res = await fetch(api('/api/download'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!data.jobId) { toast('Не удалось начать загрузку'); return; }
    pollJob(data.jobId);
  } catch {
    showDownload({ title: 'Ошибка', progress: -1, error: 'Нет связи с сервером' });
  }
}

async function pollJob(jobId) {
  const step = async () => {
    try {
      const res = await fetch(api('/api/jobs/' + jobId));
      const j = await res.json();
      if (j.status === 'done') {
        showDownload(null);
        toast('Трек добавлен');
        await loadTracks();
        closeSheet();
        if (j.track) playTrack(j.track.id, { silent: true });
        return;
      }
      if (j.status === 'error') {
        showDownload({ title: 'Ошибка загрузки', progress: -1, error: j.error || 'Неизвестная ошибка' });
        return;
      }
      showDownload({ title: 'Скачивание…', progress: j.progress || 0 });
      setTimeout(step, 900);
    } catch {
      showDownload({ title: 'Ошибка', progress: -1, error: 'Нет связи с сервером' });
    }
  };
  step();
}

async function deleteTrack(id) {
  try {
    const res = await fetch(api('/api/delete/' + encodeURIComponent(id)), { method: 'POST' });
    if (res.ok) {
      if (state.currentId === id) stopPlayback();
      await loadTracks();
      toast('Трек удалён');
    }
  } catch {
    toast('Ошибка удаления');
  }
}

// ---------------------------------------------------------------- settings
function openSettings() {
  el('settingsModal').classList.remove('hidden');
  el('serverInput').value = state.serverBase;
  el('cookiesInput').value = state.cookiesBrowser;
}
function closeSettings() {
  el('settingsModal').classList.add('hidden');
}
function saveSettings() {
  const v = el('serverInput').value.trim().replace(/\/+$/, '');
  const cb = el('cookiesInput').value.trim();
  state.serverBase = v;
  state.cookiesBrowser = cb;
  try { localStorage.setItem('aurora_server', v); localStorage.setItem('aurora_cookies_browser', cb); } catch {}
  closeSettings();
  toast('Настройки сохранены');
  loadTracks();
}

// ---------------------------------------------------------------- events
function bindEvents() {
  audio.addEventListener('play', () => setPlaying(true));
  audio.addEventListener('pause', () => setPlaying(false));
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const p = audio.currentTime / audio.duration;
    el('miniProgress').style.width = (p * 100) + '%';
    if (!seeking) { el('seek').value = Math.round(p * 1000); paintRange(el('seek')); }
    el('curTime').textContent = fmtTime(audio.currentTime);
  });
  audio.addEventListener('loadedmetadata', () => {
    el('totalTime').textContent = fmtTime(audio.duration || 0);
  });
  audio.addEventListener('error', () => {
    if (state.currentId) toast('Не удалось воспроизвести аудио');
  });

  el('btnAdd').addEventListener('click', openSheet);
  el('btnAddEmpty').addEventListener('click', openSheet);
  el('sheetClose').addEventListener('click', closeSheet);
  el('sheetScrim').addEventListener('click', closeSheet);

  el('btnSettings').addEventListener('click', openSettings);
  el('settingsScrim').addEventListener('click', closeSettings);
  el('settingsCancel').addEventListener('click', closeSettings);
  el('settingsSave').addEventListener('click', saveSettings);

  el('searchInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = el('searchInput').value.trim();
    if (!q) return;
    if (isUrl(q)) { el('searchInput').value = ''; startDownload({ input: q, title: 'Скачивание по ссылке…' }); }
    else doSearch(q);
  });

  el('miniPlay').addEventListener('click', togglePlay);
  el('miniNext').addEventListener('click', () => next());
  el('miniInfo').addEventListener('click', () => {
    el('nowPlaying').classList.add('open');
    document.body.classList.add('lock');
  });

  // volume
  el('miniVol').addEventListener('click', (e) => {
    e.stopPropagation();
    el('volPop').classList.toggle('hidden');
  });
  el('volPopSlider').addEventListener('input', () => setVolume(parseFloat(el('volPopSlider').value)));
  el('volume').addEventListener('input', () => setVolume(parseFloat(el('volume').value)));
  document.addEventListener('click', (e) => {
    const vp = el('volPop');
    if (vp.classList.contains('hidden')) return;
    if (!vp.contains(e.target) && !el('miniVol').contains(e.target)) vp.classList.add('hidden');
  });

  el('npCollapse').addEventListener('click', () => {
    el('nowPlaying').classList.remove('open');
    document.body.classList.remove('lock');
  });
  el('npPlay').addEventListener('click', togglePlay);
  el('btnNext').addEventListener('click', () => next());
  el('btnPrev').addEventListener('click', () => prev());

  el('btnShuffle').addEventListener('click', () => {
    state.shuffle = !state.shuffle;
    el('btnShuffle').classList.toggle('on', state.shuffle);
  });

  el('btnRepeat').addEventListener('click', () => {
    state.repeat = (state.repeat + 1) % 3;
    const b = el('btnRepeat');
    b.classList.toggle('on', state.repeat > 0);
    b.innerHTML = state.repeat === 2 ? REPEAT_ONE_SVG : REPEAT_SVG;
    b.title = ['Повтор выключен', 'Повтор всех', 'Повтор одного'][state.repeat];
  });

  el('npMore').addEventListener('click', () => {
    if (!state.currentId) return;
    if (confirm('Удалить этот трек?')) deleteTrack(state.currentId);
  });

  el('seek').addEventListener('input', () => {
    seeking = true;
    paintRange(el('seek'));
    if (audio.duration) el('curTime').textContent = fmtTime((el('seek').value / 1000) * audio.duration);
  });
  el('seek').addEventListener('change', () => {
    if (audio.duration) audio.currentTime = (el('seek').value / 1000) * audio.duration;
    seeking = false;
  });

  if ('mediaSession' in navigator && navigator.mediaSession) {
    try {
      navigator.mediaSession.setActionHandler('play', () => audio.play().catch(() => {}));
      navigator.mediaSession.setActionHandler('pause', () => audio.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => prev());
      navigator.mediaSession.setActionHandler('nexttrack', () => next());
      navigator.mediaSession.setActionHandler('seekto', (d) => { if (d.seekTime != null) audio.currentTime = d.seekTime; });
    } catch {}
  }
}

// ---------------------------------------------------------------- init
(async function init() {
  bindEvents();
  paintRange(el('seek'));
  setVolume(state.volume);
  await loadTracks();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();
