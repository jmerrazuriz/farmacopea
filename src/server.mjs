import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { db } from './db.mjs';
import { importDrug } from './openfda.mjs';
import { checkInteractions } from './interactions.mjs';
import { buildSummary } from '../shared/derive.mjs';
import { translateTexts, translatorStatus } from './translate.mjs';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SHARED = join(dirname(fileURLToPath(import.meta.url)), '..', 'shared');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_MS = 1000 * 60 * 60 * 12;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

// ---------- utilidades ----------
const scryptAsync = (pw, salt) =>
  new Promise((res, rej) => scrypt(pw, salt, 64, (e, k) => (e ? rej(e) : res(k))));

async function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: (await scryptAsync(pw, salt)).toString('hex') };
}

async function verifyPassword(pw, salt, hash) {
  const a = await scryptAsync(pw, salt);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 100_000) throw new HttpError(413, 'Solicitud demasiado grande');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '')
      .split(';')
      .map((c) => c.trim().split('='))
      .filter((p) => p[0])
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])
  );
}

function sessionUser(req) {
  const token = cookies(req).sid;
  if (!token) return null;
  const row = db
    .prepare('SELECT u.id, u.username, s.expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?')
    .get(token);
  if (!row) return null;
  if (row.expires < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { id: row.id, username: row.username, token };
}

function startSession(res, userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)').run(token, userId, Date.now() + SESSION_MS);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
}

const loginAttempts = new Map(); // ip -> { n, until }
function throttle(ip) {
  const e = loginAttempts.get(ip);
  if (e && e.n >= 8 && e.until > Date.now()) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.');
}
function failed(ip) {
  const e = loginAttempts.get(ip) || { n: 0, until: 0 };
  e.n += 1;
  e.until = Date.now() + 5 * 60_000;
  loginAttempts.set(ip, e);
}

const parseDrug = (d) => ({
  id: d.id,
  generic: d.generic,
  brands: JSON.parse(d.brands),
  substances: JSON.parse(d.substances),
  classes: JSON.parse(d.pharm_class),
  routes: JSON.parse(d.routes),
  manufacturer: d.manufacturer,
  updated: d.effective_time,
});

const likeEsc = (s) => s.replace(/[\\%_]/g, '\\$&');

// ---------- API ----------
async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const ip = req.socket.remoteAddress;

  if (route === 'GET /api/auth/status') {
    const user = sessionUser(req);
    return send(res, 200, {
      hasUsers: db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0,
      user: user && { id: user.id, username: user.username },
    });
  }

  if (route === 'POST /api/auth/register') {
    const hasUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
    if (hasUsers && !sessionUser(req)) throw new HttpError(403, 'Solo un usuario con sesión puede crear cuentas');
    const { username, password } = await readJson(req);
    if (!/^[\w.-]{3,32}$/.test(username || '')) throw new HttpError(400, 'Usuario: 3-32 caracteres (letras, números, . _ -)');
    if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'Ese usuario ya existe');
    const { salt, hash } = await hashPassword(password);
    const { lastInsertRowid } = db.prepare('INSERT INTO users (username, salt, hash) VALUES (?, ?, ?)').run(username, salt, hash);
    if (!hasUsers) startSession(res, Number(lastInsertRowid));
    return send(res, 201, { ok: true });
  }

  if (route === 'POST /api/auth/login') {
    throttle(ip);
    const { username, password } = await readJson(req);
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
    if (!u || !(await verifyPassword(String(password || ''), u.salt, u.hash))) {
      failed(ip);
      throw new HttpError(401, 'Usuario o contraseña incorrectos');
    }
    loginAttempts.delete(ip);
    startSession(res, u.id);
    return send(res, 200, { ok: true });
  }

  const user = sessionUser(req);
  if (!user) throw new HttpError(401, 'Sesión requerida');

  if (route === 'POST /api/auth/logout') {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(user.token);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (route === 'GET /api/search') {
    const q = (url.searchParams.get('q') || '').trim();
    if (!q) return send(res, 200, { results: [] });
    const pat = `%${likeEsc(q)}%`;
    const rows = db
      .prepare(
        `SELECT * FROM drugs
         WHERE generic LIKE ? ESCAPE '\\' OR brands LIKE ? ESCAPE '\\' OR substances LIKE ? ESCAPE '\\' OR pharm_class LIKE ? ESCAPE '\\'
         ORDER BY (generic LIKE ? ESCAPE '\\') DESC, generic COLLATE NOCASE LIMIT 50`
      )
      .all(pat, pat, pat, pat, `${likeEsc(q)}%`);
    return send(res, 200, { results: rows.map(parseDrug) });
  }

  if (route === 'GET /api/drugs') {
    const letter = (url.searchParams.get('letter') || '').toUpperCase();
    const rows = /^[A-Z]$/.test(letter)
      ? db.prepare('SELECT * FROM drugs WHERE generic LIKE ? ORDER BY generic COLLATE NOCASE').all(`${letter}%`)
      : db.prepare('SELECT * FROM drugs ORDER BY generic COLLATE NOCASE').all();
    const letters = db.prepare('SELECT DISTINCT UPPER(SUBSTR(generic,1,1)) AS l FROM drugs ORDER BY l').all().map((r) => r.l);
    return send(res, 200, { results: rows.map(parseDrug), letters });
  }

  let m = url.pathname.match(/^\/api\/drugs\/(\d+)$/);
  if (m && req.method === 'GET') {
    const d = db.prepare('SELECT * FROM drugs WHERE id = ?').get(Number(m[1]));
    if (!d) throw new HttpError(404, 'Medicamento no encontrado');
    const sections = db.prepare('SELECT key, title, text FROM sections WHERE drug_id = ? ORDER BY ord').all(d.id);
    const favorite = !!db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND drug_id = ?').get(user.id, d.id);
    db.prepare('INSERT INTO history (user_id, drug_id) VALUES (?, ?)').run(user.id, d.id);
    return send(res, 200, { ...parseDrug(d), sections, favorite, summary: buildSummary(sections) });
  }

  m = url.pathname.match(/^\/api\/drugs\/(\d+)\/favorite$/);
  if (m && (req.method === 'PUT' || req.method === 'DELETE')) {
    const id = Number(m[1]);
    if (!db.prepare('SELECT 1 FROM drugs WHERE id = ?').get(id)) throw new HttpError(404, 'Medicamento no encontrado');
    if (req.method === 'PUT') db.prepare('INSERT OR IGNORE INTO favorites (user_id, drug_id) VALUES (?, ?)').run(user.id, id);
    else db.prepare('DELETE FROM favorites WHERE user_id = ? AND drug_id = ?').run(user.id, id);
    return send(res, 200, { ok: true });
  }

  if (route === 'GET /api/favorites') {
    const rows = db
      .prepare('SELECT d.* FROM favorites f JOIN drugs d ON d.id = f.drug_id WHERE f.user_id = ? ORDER BY d.generic COLLATE NOCASE')
      .all(user.id);
    return send(res, 200, { results: rows.map(parseDrug) });
  }

  if (route === 'GET /api/history') {
    const rows = db
      .prepare(
        `SELECT d.*, MAX(h.ts) AS last FROM history h JOIN drugs d ON d.id = h.drug_id
         WHERE h.user_id = ? GROUP BY d.id ORDER BY last DESC LIMIT 15`
      )
      .all(user.id);
    return send(res, 200, { results: rows.map(parseDrug) });
  }

  if (route === 'POST /api/interactions') {
    const { ids } = await readJson(req);
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 20 || !ids.every(Number.isInteger)) {
      throw new HttpError(400, 'Indica entre 2 y 20 medicamentos');
    }
    return send(res, 200, checkInteractions(ids));
  }

  if (route === 'GET /api/translate/status') {
    return send(res, 200, await translatorStatus());
  }

  if (route === 'POST /api/translate') {
    const { texts } = await readJson(req);
    if (!Array.isArray(texts) || !texts.length || texts.length > 80 || !texts.every((t) => typeof t === 'string' && t.length <= 40000)) {
      throw new HttpError(400, 'Solicitud de traducción inválida');
    }
    if (!(await translatorStatus()).available) {
      throw new HttpError(503, 'El traductor local no está en marcha. Arráncalo con: npm run translator');
    }
    try {
      return send(res, 200, { translations: await translateTexts(texts) });
    } catch (e) {
      throw new HttpError(502, e.message);
    }
  }

  if (route === 'POST /api/import') {
    const { name } = await readJson(req);
    if (typeof name !== 'string' || name.trim().length < 2 || name.length > 80) throw new HttpError(400, 'Nombre inválido');
    let id;
    try {
      id = await importDrug(name);
    } catch (e) {
      throw new HttpError(502, `No se pudo consultar openFDA: ${e.message}`);
    }
    if (!id) throw new HttpError(404, `openFDA no tiene una ficha para "${name.trim()}"`);
    return send(res, 200, { id });
  }

  throw new HttpError(404, 'Ruta no encontrada');
}

// ---------- estaticos ----------
async function serveStatic(res, pathname) {
  const rel = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  // /shared/* (modulos comunes con la version web) se sirven desde ../shared
  const posix = rel.split(sep).join('/');
  const isShared = posix.startsWith('/shared/');
  const file = isShared ? join(SHARED, posix.slice('/shared/'.length)) : join(PUBLIC, rel);
  if (!file.startsWith(isShared ? SHARED : PUBLIC)) throw new HttpError(403, 'Prohibido');
  try {
    const body = await readFile(file);
    send(res, 200, body, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  } catch {
    throw new HttpError(404, 'No encontrado');
  }
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
        throw new HttpError(403, 'Origen no permitido');
      }
      await api(req, res, url);
    } else if (req.method === 'GET') {
      await serveStatic(res, url.pathname);
    } else {
      throw new HttpError(405, 'Método no permitido');
    }
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Error interno' });
  }
}).listen(PORT, HOST, () => console.log(`Farmacopea local en http://${HOST}:${PORT}`));
