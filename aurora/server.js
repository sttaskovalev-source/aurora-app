/* Aurora Music — self-hosted music player + high-quality YouTube downloader.
 * Pure Node.js (no npm deps). Uses yt-dlp + ffmpeg for downloads.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { URL } = require('url');

const ROOT = __dirname;
const BIN = path.join(ROOT, 'bin');
const LIB = path.join(ROOT, 'library');
const PUB = path.join(ROOT, 'public');
const CACHE = path.join(ROOT, '.cache');
const TMP = path.join(ROOT, '.tmp');
const INDEX_PATH = path.join(ROOT, 'library.json');

const YTDLP = path.join(BIN, 'yt-dlp.exe');
const PYLIB = path.join(ROOT, 'pylibs');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = parseInt(process.env.PORT || '8787', 10);

const AUDIO_EXTS = new Set(['.m4a', '.mp3', '.flac', '.opus', '.ogg', '.webm', '.wav', '.aac', '.mka']);
const ART_EXTS = new Set(['.webp', '.jpg', '.jpeg', '.png']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.opus': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
};

// ---------------------------------------------------------------- utilities
function ensureDirs() {
  for (const d of [BIN, LIB, PUB, CACHE, TMP]) fs.mkdirSync(d, { recursive: true });
  // clear transient logs/junk from previous runs
  try {
    for (const f of fs.readdirSync(TMP)) {
      const p = path.join(TMP, f);
      try {
        if (fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true });
        else fs.unlinkSync(p);
      } catch {}
    }
  } catch {}
}

function loadIndex() {
  try {
    const data = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    return Array.isArray(data.tracks) ? data.tracks : [];
  } catch {
    return [];
  }
}

function saveIndex(tracks) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify({ version: 1, tracks }, null, 2));
}

function sanitizeId(s) {
  return String(s || '').replace(/[^A-Za-z0-9_-]/g, '');
}

function randomId() {
  return crypto.randomBytes(8).toString('hex');
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) { req.destroy(); resolve({}); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function isUrl(s) {
  return /^https?:\/\//i.test(String(s || '').trim());
}

function extractYoutubeId(input) {
  const s = String(input || '').trim();
  try {
    const u = new URL(s);
    if (u.hostname.endsWith('youtu.be')) return sanitizeId(u.pathname.slice(1));
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname.startsWith('/shorts/')) return sanitizeId(u.pathname.split('/')[2]);
      return sanitizeId(u.searchParams.get('v') || '');
    }
  } catch {}
  return '';
}

function findFilesByPrefix(id) {
  const prefix = id + ' ';
  return fs.readdirSync(LIB).filter((f) => f.startsWith(prefix));
}

function fileSizeSafe(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

function extOf(p) { return path.extname(p).toLowerCase(); }

// ------------------------------------------------------------- yt-dlp runner
// We avoid capturing stdio through pipes (sandbox-safe): redirect to files.
function resolvePython() {
  const explicit = process.env.PYTHON;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const names = ['python', 'python3'];
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const dir of dirs) {
      for (const ext of exts) {
        const p = path.join(dir, name + ext);
        try { if (fs.existsSync(p)) return p; } catch {}
      }
    }
  }
  return null;
}

function ytDlpInvocation() {
  const envBase = { ...process.env, TEMP: TMP, TMP: TMP, TMPDIR: TMP };
  const python = fs.existsSync(path.join(PYLIB, 'yt_dlp')) ? resolvePython() : null;
  if (python) {
    return {
      kind: 'python',
      cmd: python,
      pre: ['-m', 'yt_dlp'],
      env: { ...envBase, PYTHONPATH: PYLIB + path.delimiter + (process.env.PYTHONPATH || '') },
    };
  }
  if (fs.existsSync(YTDLP)) {
    return { kind: 'exe', cmd: YTDLP, pre: [], env: envBase };
  }
  return null;
}

function runYtDlp(args, onProgress) {
  return new Promise((resolve) => {
    const inv = ytDlpInvocation();
    if (!inv) {
      resolve({ code: -1, outPath: '', errPath: '', spawnError: 'yt-dlp not found (run scripts/fetch_tools.py or `pip install yt-dlp`)' });
      return;
    }
    const stamp = Date.now() + '-' + randomId();
    const outPath = path.join(TMP, `out-${stamp}.log`);
    const errPath = path.join(TMP, `err-${stamp}.log`);
    const outFd = fs.openSync(outPath, 'w');
    const errFd = fs.openSync(errPath, 'w');
    const poll = onProgress ? setInterval(() => {
      const p = progressFromLog(outPath);
      if (p != null) onProgress(p);
    }, 600) : null;
    let child;
    try {
      child = spawn(inv.cmd, [...inv.pre, ...args], { stdio: ['ignore', outFd, errFd], windowsHide: true, env: inv.env });
    } catch (e) {
      if (poll) clearInterval(poll);
      fs.closeSync(outFd); fs.closeSync(errFd);
      resolve({ code: -1, outPath, errPath, spawnError: e.message });
      return;
    }
    child.on('error', (e) => {
      if (poll) clearInterval(poll);
      fs.closeSync(outFd); fs.closeSync(errFd);
      resolve({ code: -1, outPath, errPath, spawnError: e.message });
    });
    child.on('close', (code) => {
      if (poll) clearInterval(poll);
      fs.closeSync(outFd); fs.closeSync(errFd);
      resolve({ code, outPath, errPath });
    });
  });
}

function readLogTail(p, bytes = 4096) {
  try {
    const fd = fs.openSync(p, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch { return ''; }
}

function progressFromLog(p) {
  const tail = readLogTail(p);
  const matches = tail.match(/\[download\]\s+([\d.]+)%/g);
  if (!matches) return null;
  const last = matches[matches.length - 1];
  const m = last.match(/([\d.]+)%/);
  return m ? parseFloat(m[1]) : null;
}

// ---------------------------------------------------------------- download
const jobs = new Map();

async function performDownload(job) {
  job.status = 'downloading';
  const id = extractYoutubeId(job.url) || 'yt-' + randomId().slice(0, 8);
  const target = isUrl(job.url) ? job.url : ('ytsearch1:' + job.url);

  const cookiesFile = path.join(ROOT, 'cookies.txt');
  const args = [
    '--ffmpeg-location', BIN,
    '--cache-dir', CACHE,
    '--newline',
    '--no-playlist',
    '--no-mtime',
    '--socket-timeout', '30',
    '--retries', '5',
    ...(fs.existsSync(cookiesFile) ? ['--cookies', cookiesFile]
       : (job.cookiesBrowser ? ['--cookies-from-browser', job.cookiesBrowser] : [])),
    '-f', 'bestaudio/best',
    '-x', '--audio-format', 'm4a', '--audio-quality', '0',
    '--embed-thumbnail', '--embed-metadata', '--add-metadata',
    '--write-thumbnail', '--write-info-json',
    '--trim-filenames', '120',
    '-o', path.join(LIB, '%(id)s %(title)s.%(ext)s'),
    target,
  ];

  const res = await runYtDlp(args, (p) => { job.progress = p; });
  if (res.code !== 0) {
    job.status = 'error';
    job.error = readLogTail(res.errPath).trim().split('\n').filter(Boolean).slice(-5).join('\n') ||
      (res.spawnError || 'yt-dlp failed (exit ' + res.code + ')');
    return;
  }

  const matches = findFilesByPrefix(id);
  const audioFile = matches.find((f) => AUDIO_EXTS.has(extOf(f)));
  const infoFile = matches.find((f) => f.endsWith('.info.json'));
  const artFile = matches.find((f) => ART_EXTS.has(extOf(f)));

  if (!audioFile) {
    job.status = 'error';
    job.error = 'Аудиофайл не найден после загрузки: ' + readLogTail(res.errPath).trim().slice(-400);
    return;
  }

  let info = {};
  if (infoFile) {
    try { info = JSON.parse(fs.readFileSync(path.join(LIB, infoFile), 'utf8')); } catch {}
    try { fs.unlinkSync(path.join(LIB, infoFile)); } catch {} // keep library tidy
  }

  const track = {
    id,
    title: info.title || path.basename(audioFile, extOf(audioFile)),
    artist: info.artist || (Array.isArray(info.artists) ? info.artists.join(', ') : '') || info.channel || info.uploader || '',
    album: info.album || '',
    duration: typeof info.duration === 'number' ? info.duration : 0,
    fileName: audioFile,
    artFile: artFile || null,
    source: info.webpage_url || job.url,
    addedAt: Date.now(),
    size: fileSizeSafe(path.join(LIB, audioFile)),
  };

  let tracks = loadIndex();
  tracks = tracks.filter((t) => t.id !== id);
  tracks.unshift(track);
  saveIndex(tracks);

  job.status = 'done';
  job.track = track;
  job.progress = 100;
}

function startDownload(input, cookiesBrowser) {
  const jobId = randomId();
  const job = { id: jobId, url: String(input || '').trim(), cookiesBrowser: String(cookiesBrowser || '').trim() || null, status: 'starting', progress: 0, track: null, error: '' };
  jobs.set(jobId, job);
  if (!job.url) { job.status = 'error'; job.error = 'Пустой запрос'; return job; }
  performDownload(job).catch((e) => { job.status = 'error'; job.error = String(e && e.message || e); });
  return job;
}

// ---------------------------------------------------------------- scanning
function scanLibrary() {
  let tracks = loadIndex();
  const known = new Set(tracks.map((t) => t.fileName));

  let files = [];
  try { files = fs.readdirSync(LIB); } catch {}

  for (const f of files) {
    if (!AUDIO_EXTS.has(extOf(f))) continue;
    if (known.has(f)) continue;
    const id = sanitizeId(path.basename(f, extOf(f)).slice(0, 60)) || 'id-' + randomId().slice(0, 6);
    const base = path.basename(f, extOf(f));
    const artFile = files.find((x) => ART_EXTS.has(extOf(x)) && x.startsWith(base + '.'));
    tracks.unshift({
      id,
      title: base,
      artist: '',
      album: '',
      duration: 0,
      fileName: f,
      artFile: artFile || null,
      source: '',
      addedAt: Date.now(),
      size: fileSizeSafe(path.join(LIB, f)),
    });
  }

  // prune entries whose file is gone
  tracks = tracks.filter((t) => files.includes(t.fileName));
  saveIndex(tracks);
  return tracks;
}

// ------------------------------------------------------------ HTTP serving
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const safe = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUB, safe);
  if (!filePath.startsWith(PUB)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const type = MIME[extOf(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

function serveFileRange(req, res, filePath, contentType) {
  fs.stat(filePath, (err, stat) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (isNaN(end) || end >= stat.size) end = stat.size - 1;
      if (start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end(); return;
      }
      res.writeHead(206, {
        'Content-Type': contentType,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });
}

function trackById(id) {
  return loadIndex().find((t) => t.id === id);
}

// ---------------------------------------------------------------- routes
async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/tracks') {
    return json(res, 200, { tracks: scanLibrary() });
  }

  if (req.method === 'POST' && pathname === '/api/search') {
    const body = await readBody(req);
    const q = String(body.q || '').trim();
    if (!q) return json(res, 400, { error: 'Пустой запрос' });
    const args = [
      '--ffmpeg-location', BIN,
      '--cache-dir', CACHE,
      '--flat-playlist', '--dump-single-json', '--quiet', '--no-warnings',
      '--no-playlist', '--skip-download', '--socket-timeout', '30', '--retries', '3',
      'ytsearch8:' + q,
    ];
    const r = await runYtDlp(args);
    if (r.code !== 0) {
      return json(res, 500, { error: (readLogTail(r.errPath) || 'search failed').trim().slice(-500) });
    }
    let raw = '';
    try { raw = fs.readFileSync(r.outPath, 'utf8'); } catch {}
    try {
      const data = JSON.parse(raw);
      const entries = (data.entries || [])
        .filter((e) => e && e.id && e.live_status !== 'is_live' && e.live_status !== 'is_upcoming')
        .map((e) => ({
          id: sanitizeId(e.id),
          title: e.title || '',
          duration: typeof e.duration === 'number' ? e.duration : 0,
          channel: e.channel || e.uploader || '',
        }));
      return json(res, 200, { results: entries });
    } catch (e) {
      return json(res, 500, { error: 'Не удалось разобрать результат поиска: ' + raw.slice(0, 300) });
    }
  }

  if (req.method === 'POST' && pathname === '/api/download') {
    const body = await readBody(req);
    let input = String(body.input || '').trim();
    if (!input && body.id) input = 'https://www.youtube.com/watch?v=' + sanitizeId(body.id);
    if (!input) return json(res, 400, { error: 'Пустой запрос' });
    const job = startDownload(input, body.cookiesBrowser);
    return json(res, 200, { jobId: job.id });
  }

  if (req.method === 'GET' && pathname.startsWith('/api/jobs/')) {
    const id = sanitizeId(pathname.slice('/api/jobs/'.length));
    const job = jobs.get(id);
    if (!job) return json(res, 404, { error: 'Job not found' });
    return json(res, 200, { id: job.id, status: job.status, progress: job.progress, track: job.track, error: job.error });
  }

  if (req.method === 'GET' && pathname.startsWith('/api/audio/')) {
    const id = sanitizeId(decodeURIComponent(pathname.slice('/api/audio/'.length)));
    const t = trackById(id);
    if (!t) { res.writeHead(404); res.end('Not found'); return; }
    return serveFileRange(req, res, path.join(LIB, t.fileName), MIME[extOf(t.fileName)] || 'audio/mp4');
  }

  if (req.method === 'GET' && pathname.startsWith('/api/art/')) {
    const id = sanitizeId(decodeURIComponent(pathname.slice('/api/art/'.length)));
    const t = trackById(id);
    if (!t || !t.artFile) { res.writeHead(404); res.end('Not found'); return; }
    const fp = path.join(LIB, t.artFile);
    return serveFileRange(req, res, fp, MIME[extOf(t.artFile)] || 'image/webp');
  }

  if (req.method === 'POST' && pathname.startsWith('/api/delete/')) {
    const id = sanitizeId(decodeURIComponent(pathname.slice('/api/delete/'.length)));
    let tracks = loadIndex();
    const t = tracks.find((x) => x.id === id);
    if (!t) return json(res, 404, { error: 'Not found' });
    for (const f of findFilesByPrefix(id)) {
      try { fs.unlinkSync(path.join(LIB, f)); } catch {}
    }
    tracks = tracks.filter((x) => x.id !== id);
    saveIndex(tracks);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'Not found' });
}

// ------------------------------------------------------------ server init
function lanAddresses() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const it of ifs[name] || []) {
      if (it.family === 'IPv4' && !it.internal) out.push(it.address);
    }
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  // CORS — позволяет установленному APK/WebView обращаться к серверу на ПК.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const u = new URL(req.url, 'http://localhost');
  const pathname = u.pathname;

  if (pathname.startsWith('/api/')) {
    try { await handleApi(req, res, pathname); }
    catch (e) { json(res, 500, { error: String(e && e.stack || e) }); }
    return;
  }
  serveStatic(req, res, pathname);
});

ensureDirs();
scanLibrary();

server.listen(PORT, HOST, () => {
  console.log('==============================================');
  console.log('  Aurora Music  (server)');
  console.log('  Local : http://127.0.0.1:' + PORT + '/');
  for (const ip of lanAddresses()) {
    console.log('  Phone : http://' + ip + ':' + PORT + '/   (та же Wi-Fi сеть)');
  }
  const inv = ytDlpInvocation();
  console.log('  yt-dlp: ' + (inv ? (inv.kind === 'python' ? 'OK (python module)' : 'OK (exe)') : 'NOT FOUND (run scripts/fetch_tools.py)'));
  console.log('  ffmpeg: ' + (fs.existsSync(path.join(BIN, 'ffmpeg.exe')) ? 'OK' : 'NOT FOUND'));
  console.log('==============================================');
});
