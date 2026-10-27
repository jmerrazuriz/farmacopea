// Traduce de antemano (con el traductor local) los textos del Resumen de cada ficha para la version web.
// Requiere el traductor en marcha: npm run translator   |   Uso: npm run pretranslate
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db.mjs';
import { buildSummary } from '../shared/derive.mjs';
import { translateTexts, translatorStatus } from '../src/translate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'docs', 'data', 'es');
mkdirSync(dir, { recursive: true });

if (!(await translatorStatus()).available) {
  console.error('El traductor local no responde en 127.0.0.1:5001. Arráncalo con: npm run translator');
  process.exit(1);
}

const force = process.argv.includes('--force');
const drugs = db.prepare('SELECT id, generic FROM drugs ORDER BY id').all();
const secStmt = db.prepare('SELECT key, title, text FROM sections WHERE drug_id = ? ORDER BY ord');

let done = 0;
for (const [i, d] of drugs.entries()) {
  const file = join(dir, `${d.id}.json`);
  if (!force && existsSync(file)) { done++; continue; }
  const sm = buildSummary(secStmt.all(d.id));
  const texts = [...new Set([
    ...(sm.boxed?.items || []), ...(sm.indications?.items || []), ...(sm.contraindications?.items || []),
    ...sm.adjustments.flatMap((a) => a.items.map((x) => x.text)),
  ])];
  try {
    const tr = await translateTexts(texts);
    writeFileSync(file, JSON.stringify(Object.fromEntries(texts.map((t, n) => [t, tr[n]]))));
    done++;
    console.log(`[${i + 1}/${drugs.length}] ${d.generic}: ${texts.length} frases`);
  } catch (e) {
    console.log(`[${i + 1}/${drugs.length}] ${d.generic}: ERROR ${e.message}`);
  }
}
console.log(`\nTraducidas: ${done}/${drugs.length}`);
