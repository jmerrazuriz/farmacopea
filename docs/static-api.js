// Version sin servidor: reemplaza a /api usando los JSON incluidos en el sitio + almacenamiento del navegador.
// Funciona igual en iPhone (Safari) y Android (Chrome), tambien sin conexion una vez visitadas las fichas.
import { buildSummary } from './shared/derive.mjs';
import { checkInteractionsCore } from './shared/interactions-core.mjs';
import { OPENFDA_URL, findLabel, labelToDrug } from './shared/label.mjs';

const USER_ID = 1;
const IMPORT_BASE = 1_000_000; // ids de fichas importadas por el usuario
let indexCache = null;
let currentDrugId = null;

class ApiError extends Error {}

// ---- almacenamiento local (try/catch: puede fallar en modo privado) ----
const ls = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento */ }
  },
};

// ---- IndexedDB para fichas importadas por el usuario ----
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('farmacopea', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('drugs', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbAll() {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const r = db.transaction('drugs').objectStore('drugs').getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  } catch { return []; }
}
async function idbGet(id) {
  const db = await idb();
  return new Promise((res, rej) => {
    const r = db.transaction('drugs').objectStore('drugs').get(id);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbPut(drug) {
  const db = await idb();
  return new Promise((res, rej) => {
    const r = db.transaction('drugs', 'readwrite').objectStore('drugs').put(drug);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new ApiError(`No se pudo cargar ${path} (${res.status}). Si estás sin conexión, abre antes esa ficha con internet.`);
  return res.json();
}

const meta = (d) => ({ id: d.id, generic: d.generic, brands: d.brands, substances: d.substances || [], classes: d.classes, routes: d.routes, manufacturer: d.manufacturer || null, updated: d.updated || null });

async function loadIndex() {
  if (!indexCache) {
    const base = await getJson('./data/index.json');
    const mine = (await idbAll()).map(meta);
    indexCache = [...base, ...mine];
  }
  return indexCache;
}

async function loadDrug(id) {
  if (id >= IMPORT_BASE) {
    const d = await idbGet(id);
    if (!d) throw new ApiError('Medicamento no encontrado');
    return d;
  }
  return getJson(`./data/drugs/${id}.json`);
}

const byName = (a, b) => a.generic.localeCompare(b.generic, 'es', { sensitivity: 'base' });

// ---- rutas ----
export async function staticApi(path, opts = {}) {
  const method = opts.method || 'GET';
  const url = new URL(path, 'http://x');
  const route = `${method} ${url.pathname}`;

  if (route === 'GET /auth/status') return { hasUsers: true, user: { id: USER_ID, username: 'local' } };

  if (route === 'GET /search') {
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    if (!q) return { results: [] };
    const idx = await loadIndex();
    const hit = (d) => [d.generic, ...d.brands, ...(d.substances || []), ...d.classes].some((t) => t.toLowerCase().includes(q));
    const results = idx.filter(hit).sort((a, b) => (b.generic.toLowerCase().startsWith(q) - a.generic.toLowerCase().startsWith(q)) || byName(a, b));
    return { results: results.slice(0, 50) };
  }

  if (route === 'GET /drugs') {
    const letter = (url.searchParams.get('letter') || '').toUpperCase();
    const idx = (await loadIndex()).slice().sort(byName);
    const letters = [...new Set(idx.map((d) => d.generic[0].toUpperCase()))].sort();
    return { results: /^[A-Z]$/.test(letter) ? idx.filter((d) => d.generic[0].toUpperCase() === letter) : idx, letters };
  }

  let m = url.pathname.match(/^\/drugs\/(\d+)$/);
  if (m && method === 'GET') {
    const id = Number(m[1]);
    const d = await loadDrug(id);
    currentDrugId = id;
    const hist = ls.get('history', []).filter((x) => x !== id);
    hist.unshift(id);
    ls.set('history', hist.slice(0, 30));
    return { ...meta(d), sections: d.sections, favorite: ls.get('favorites', []).includes(id), summary: buildSummary(d.sections) };
  }

  m = url.pathname.match(/^\/drugs\/(\d+)\/favorite$/);
  if (m && (method === 'PUT' || method === 'DELETE')) {
    const id = Number(m[1]);
    const favs = ls.get('favorites', []).filter((x) => x !== id);
    if (method === 'PUT') favs.push(id);
    ls.set('favorites', favs);
    return { ok: true };
  }

  if (route === 'GET /favorites' || route === 'GET /history') {
    const ids = ls.get(route.endsWith('favorites') ? 'favorites' : 'history', []);
    const idx = await loadIndex();
    const list = ids.map((id) => idx.find((d) => d.id === id)).filter(Boolean);
    return { results: route.endsWith('favorites') ? list.sort(byName) : list.slice(0, 15) };
  }

  if (route === 'POST /interactions') {
    const ids = [...new Set(opts.body?.ids || [])];
    if (ids.length < 2 || ids.length > 20) throw new ApiError('Indica entre 2 y 20 medicamentos');
    const drugs = await Promise.all(ids.map(loadDrug));
    return checkInteractionsCore(drugs.map((d) => ({
      id: d.id, generic: d.generic, brands: d.brands, substances: d.substances || [], classes: d.classes,
      text: d.sections.find((s) => s.key === 'interactions')?.text || '',
    })));
  }

  if (route === 'POST /import') {
    const name = String(opts.body?.name || '').trim();
    if (name.length < 2 || name.length > 80) throw new ApiError('Nombre inválido');
    let label;
    try {
      label = await findLabel(name, async (search, limit) => {
        const res = await fetch(`${OPENFDA_URL}?search=${encodeURIComponent(search)}&limit=${limit}`);
        if (res.status === 404) return [];
        if (!res.ok) throw new ApiError(`openFDA respondió ${res.status}`);
        return (await res.json()).results || [];
      });
    } catch (e) {
      throw new ApiError(e instanceof ApiError ? e.message : 'No se pudo consultar openFDA. Comprueba tu conexión a internet.');
    }
    const d = label && labelToDrug(label);
    if (!d) throw new ApiError(`openFDA no tiene una ficha para "${name}"`);
    const all = await idbAll();
    const same = all.find((x) => x.setId === d.setId);
    const id = same?.id ?? Math.max(IMPORT_BASE, ...all.map((x) => x.id)) + (same ? 0 : 1);
    await idbPut({ ...d, id });
    indexCache = null;
    return { id };
  }

  // Traduccion: en la version web solo estan traducidos de antemano los textos del Resumen
  if (route === 'GET /translate/status') return { available: true };
  if (route === 'POST /translate') {
    const dict = currentDrugId && currentDrugId < IMPORT_BASE
      ? await getJson(`./data/es/${currentDrugId}.json`).catch(() => ({}))
      : {};
    const texts = opts.body?.texts || [];
    const out = texts.map((t) => dict[t]);
    if (out.some((x) => x === undefined)) {
      throw new ApiError('En la versión web solo el Resumen está traducido de antemano. Para una sección completa usa «Traducir» de tu navegador: en Safari, el botón aA de la barra de direcciones; en Chrome, el menú ⋮ → Traducir.');
    }
    return { translations: out };
  }

  throw new ApiError('Ruta no encontrada');
}
