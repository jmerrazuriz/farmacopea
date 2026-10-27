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

// Version de la cache: subirla al cambiar el glosario o la validacion para que se retraduzca
const CACHE_V = 'v7:';
const hash = (s) => createHash('sha256').update(CACHE_V + s).digest('hex');

// El traductor automatico falla con terminologia medica. Dos pasos:
//  - PRE: sinonimos ingleses que el modelo traduce bien ("impairment" -> "insufficiency")
//  - POST: correcciones de errores conocidos en la salida en español
const PRE = [
  [/\b(renal|kidney) impairment\b/gi, '$1 insufficiency'],
  [/\b(hepatic|liver) impairment\b/gi, '$1 insufficiency'],
  [/\bimpaired (renal|hepatic) function\b/gi, '$1 insufficiency'],
  [/\b(\w+) sodium\b/g, (m, w) => (/^(Warfarin|Valproate|Naproxen|Diclofenac|Levothyroxine|Heparin|Enoxaparin|Ketorolac)$/i.test(w) ? `${w} (sodium salt)` : m)],
  // El modelo cambia o pierde los simbolos de comparacion: se pasan a palabras
  [/≥/g, ' greater than or equal to '],
  [/≤/g, ' less than or equal to '],
  [/(?<=[\s(])>(?=\s*\d)/g, ' greater than '],
  [/(?<=[\s(])<(?=\s*\d)/g, ' less than '],
  [/^Monitor /, 'Closely monitor '],
  // Encabezados EN MAYUSCULAS: el modelo los deja sin traducir. Se pasan a minusculas (siglas de <=3 letras intactas).
  [/\b[A-Z]{4,}(?:[ ,&-]+[A-Z]{4,})*\b/g, (m) => m.charAt(0) + m.slice(1).toLowerCase()],
];
const POST = [
  [/\bdiscapacidad (renal|hepática)\b/gi, 'insuficiencia $1'],
  [/\bafecto (renal|hepático)\b/gi, 'insuficiencia $1'],
  [/\balteración (renal|hepática)\b/gi, 'insuficiencia $1'],
  [/\blimpieza de (la )?creatinina\b/gi, 'aclaramiento de creatinina'],
  [/\bincautaci(ón|ones)\b/gi, (m, e) => (e === 'ones' ? 'crisis convulsivas' : 'crisis convulsiva')],
  [/\bel sodio de ([a-záéíóú]+)\b/gi, 'la $1 sódica'],
  // "Warfarin (sal de sodio)" -> "Warfarina sódica"
  [/\b([A-Za-záéíóú]+) \((?:sal sódica|sal de sodio)\)/gi, (m, w) => `${/in$/i.test(w) ? `${w}a` : w} sódica`],
  [/\b([Ee])l ([a-záéíóú]+ina sódica)\b/g, (m, e, w) => `${e === 'E' ? 'La' : 'la'} ${w}`],
  [/\bMonitor INR\b/g, 'Vigile el INR'],
];
const pre = (t) => PRE.reduce((s, [re, to]) => s.replace(re, to), t);
export const post = (t) => {
  const s = POST.reduce((acc, [re, to]) => acc.replace(re, to), t);
  return s.charAt(0).toUpperCase() + s.slice(1); // la frase original siempre empieza en mayuscula
};

// ---- Validacion: una traduccion que cambia cifras o simbolos puede ser peligrosa en medicina ----
// Si no supera las comprobaciones se muestra el texto ORIGINAL en ingles, nunca una traduccion dudosa.
const normNums = (s) => {
  const t = s
    .replace(/(?<![\d.,])([1-9]\d{0,2})[.,](\d{3})(?!\d)/g, '$1$2') // separador de miles: 1,200 / 1.200 -> 1200
    .replace(/(\d)[.,](\d)/g, '$1.$2'); // coma decimal -> punto
  return (t.match(/\d+(?:\.\d+)?/g) || []).map((n) => String(Number(n))).sort().join(',');
};
const OP_WORDS = /\b(mayor|menor|superior|inferior|igual|más de|menos de|por encima|por debajo|al menos|como mínimo|como máximo|máximo|mínimo|hasta|sobre|bajo|menos|más)\b|[<>≤≥]/gi;
const EN_FUNC = /\b(the|of|have|has|with|and|in|to|is|are|was|were|that|which|for|should|may|can|patients?|use|not)\b/gi;

// Anclas semanticas: si el original lleva una de estas palabras clave, la traduccion debe llevar su equivalente.
// Evita errores como "halve the dose" -> "la hemorragia".
const ANCHORS = [
  [/\b(halve|half)\b/i, /mitad|reduc|dividi|disminu/i],
  [/\b(reduce[sd]?|reduction|decrease[sd]?|lower)\b/i, /reduc|disminu|men[oa]r|baj/i],
  [/\b(increase[sd]?|elevat\w+|raise[sd]?)\b/i, /aument|increment|elev|mayor|subi|incrementa/i],
  [/\bavoid\w*\b/i, /evit/i],
  [/\bcontraindicat\w+\b/i, /contraindic/i],
  [/\bnot recommended\b/i, /no (se )?recomiend|no recomend|desaconsej/i],
  [/\b(discontinu\w+|stop|withhold|withdraw\w*)\b/i, /suspend|interrump|discontinu|retir|deten|abandon|cese|cesar/i],
  [/\bmonitor\w*\b/i, /vigil|monitor|control|supervis|segui/i],
  [/\b(not|never|without|no)\b/i, /\b(no|sin|ni|nunca|ning[uú]n[oa]?|tampoco)\b|\bnada\b/i],
];

export function faithful(en, es) {
  if (normNums(en) !== normNums(es)) return false;
  for (const [enRe, esRe] of ANCHORS) if (enRe.test(en) && !esRe.test(es)) return false;
  const syms = (en.match(/[<>≤≥]/g) || []).length;
  if (syms && (es.match(OP_WORDS) || []).length < syms) return false;
  if (es.length < en.length * 0.45) return false; // el modelo se "comio" parte de la frase
  const words = es.split(/\s+/).length;
  const hits = (es.match(EN_FUNC) || []).length;
  if (hits >= 4 && hits / words > 0.25) return false; // quedo en ingles a medias
  return true;
}

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

// Traduce un trozo; si falla la validacion lo reintenta frase a frase; lo que siga fallando queda en ingles.
async function translateChunk(raw) {
  // Tablas aplanadas (muchas cifras): el modelo las destroza; se dejan en ingles
  if ((raw.match(/\d+/g) || []).length >= 12) return raw;
  const [first] = await callService([pre(raw)]);
  const es = first ? post(first) : '';
  if (es && faithful(raw, es)) return es;

  const sentences = raw.split(/(?<=[.;!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) return raw;
  const out = [];
  for (const s of sentences) {
    const [t] = await callService([pre(s)]);
    const e = t ? post(t) : '';
    out.push(e && faithful(s, e) ? e : s);
  }
  return out.join(' ');
}

async function translateOne(text, { force = false } = {}) {
  const key = hash(text);
  if (!force) {
    const hit = getStmt.get(key);
    if (hit) return hit.es;
  }
  const out = [];
  for (const raw of chunks(text)) {
    const c = force ? null : getStmt.get(hash(raw));
    if (c) {
      out.push(c.es);
      continue;
    }
    const es = await translateChunk(raw);
    putStmt.run(hash(raw), es);
    out.push(es);
  }
  const joined = out.join('\n');
  putStmt.run(key, joined);
  return joined;
}

export async function translateTexts(texts, opts) {
  const results = [];
  for (const t of texts) results.push(t && t.trim() ? await translateOne(t, opts) : '');
  return results;
}

/** Revisa una traduccion ya hecha: la acepta (aplicando el glosario) o la rehace con validacion. */
export async function repairTranslation(en, es) {
  const fixed = post(es);
  if (faithful(en, fixed)) return { es: fixed, redone: false };
  return { es: (await translateTexts([en], { force: true }))[0], redone: true };
}
