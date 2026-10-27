import { createHash } from 'node:crypto';
import { db } from './db.mjs';

// Servicio de traduccion compatible con LibreTranslate (por defecto, scripts/translator.py en local)
const URL_BASE = (process.env.TRANSLATE_URL || 'http://127.0.0.1:5001').replace(/\/$/, '');
const API_KEY = process.env.TRANSLATE_API_KEY;
const CHUNK = 900;

db.exec(`
  CREATE TABLE IF NOT EXISTS translations (
    hash TEXT PRIMARY KEY,
    es TEXT NOT NULL,
    created TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Version de la cache: subirla al cambiar el glosario para que se retraduzca
const CACHE_V = 'v5:';
const hash = (s) => createHash('sha256').update(CACHE_V + s).digest('hex');

// El traductor automatico falla con terminologia medica. Dos pasos:
//  - PRE: sinonimos ingleses que el modelo traduce bien ("impairment" -> "insufficiency")
//  - POST: correcciones de errores conocidos en la salida en español
const PRE = [
  [/\b(renal|kidney) impairment\b/gi, '$1 insufficiency'],
  [/\b(hepatic|liver) impairment\b/gi, '$1 insufficiency'],
  [/\bimpaired (renal|hepatic) function\b/gi, '$1 insufficiency'],
  [/\b(\w+) sodium\b/g, (m, w) => (/^(Warfarin|Valproate|Naproxen|Diclofenac|Levothyroxine|Heparin|Enoxaparin|Ketorolac)$/i.test(w) ? `${w} (sodium salt)` : m)],
  [/^Monitor /, 'Closely monitor '],
  // Encabezados EN MAYUSCULAS: el modelo los deja sin traducir. Se pasan a minusculas (siglas de <=3 letras intactas).
  [/\b[A-Z]{4,}(?:[ ,&-]+[A-Z]{4,})*\b/g, (m) => m.charAt(0) + m.slice(1).toLowerCase()],
];
const POST = [
  [/\bdiscapacidad (renal|hepática)\b/gi, 'insuficiencia $1'],
  [/\bafecto (renal|hepático)\b/gi, 'insuficiencia $1'],
  [/\balteración (renal|hepática)\b/gi, 'insuficiencia $1'],
  [/\bel sodio de ([a-záéíóú]+)\b/gi, 'la $1 sódica'],
  // "Warfarin (sal de sodio)" -> "Warfarina sódica"
  [/\b([A-Za-záéíóú]+) \((?:sal sódica|sal de sodio)\)/gi, (m, w) => `${/in$/i.test(w) ? `${w}a` : w} sódica`],
  [/\b([Ee])l ([a-záéíóú]+ina sódica)\b/g, (m, e, w) => `${e === 'E' ? 'La' : 'la'} ${w}`],
  [/\bMonitor INR\b/g, 'Vigile el INR'],
  [/\bINR\b/g, 'INR'],
];
const pre = (t) => PRE.reduce((s, [re, to]) => s.replace(re, to), t);
const post = (t) => {
  const s = POST.reduce((acc, [re, to]) => acc.replace(re, to), t);
  return s.charAt(0).toUpperCase() + s.slice(1); // la frase original siempre empieza en mayuscula
};
const getStmt = db.prepare('SELECT es FROM translations WHERE hash = ?');
const putStmt = db.prepare('INSERT OR REPLACE INTO translations (hash, es) VALUES (?, ?)');

export async function translatorStatus() {
  try {
    const r = await fetch(`${URL_BASE}/health`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) return { available: (await r.json()).model !== false };
  } catch { /* sin servicio */ }
  // LibreTranslate no tiene /health: probar /languages
  try {
    const r = await fetch(`${URL_BASE}/languages`, { signal: AbortSignal.timeout(2000) });
    return { available: r.ok };
  } catch {
    return { available: false };
  }
}

// Parte el texto en trozos de frases completas para no pasar de CHUNK caracteres
function chunks(text) {
  const out = [];
  for (const para of text.split(/\n+/)) {
    if (!para.trim()) continue;
    let cur = '';
    for (const s of para.split(/(?<=[.;!?])\s+/)) {
      if (cur && cur.length + s.length + 1 > CHUNK) {
        out.push(cur);
        cur = '';
      }
      cur = cur ? `${cur} ${s}` : s;
    }
    if (cur) out.push(cur);
  }
  return out;
}

async function callService(pieces) {
  const body = { q: pieces, source: 'en', target: 'es', format: 'text', ...(API_KEY ? { api_key: API_KEY } : {}) };
  const res = await fetch(`${URL_BASE}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!res.ok) throw new Error(`El traductor respondió ${res.status}`);
  const data = await res.json();
  const t = data.translatedText;
  return Array.isArray(t) ? t : [t];
}

async function translateOne(text) {
  const key = hash(text);
  const hit = getStmt.get(key);
  if (hit) return hit.es;

  const parts = chunks(pre(text));
  const out = new Array(parts.length);
  const missing = [];
  parts.forEach((p, i) => {
    const c = getStmt.get(hash(p));
    if (c) out[i] = c.es;
    else missing.push(i);
  });
  // lotes pequenos para que cada llamada sea corta
  for (let i = 0; i < missing.length; i += 8) {
    const idx = missing.slice(i, i + 8);
    const res = await callService(idx.map((j) => parts[j]));
    idx.forEach((j, n) => {
      out[j] = res[n] ? post(res[n]) : parts[j];
      putStmt.run(hash(parts[j]), out[j]);
    });
  }
  const joined = out.join('\n');
  putStmt.run(key, joined);
  return joined;
}

export async function translateTexts(texts) {
  const results = [];
  for (const t of texts) results.push(t && t.trim() ? await translateOne(t) : '');
  return results;
}
