// Revisa las traducciones precalculadas de docs/data/es: aplica el glosario, valida cifras y simbolos,
// y rehace (o deja en ingles) las que no superen la validacion. Requiere el traductor: npm run translator
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repairTranslation, translatorStatus } from '../src/translate.mjs';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'data', 'es');
if (!(await translatorStatus()).available) {
  console.error('El traductor local no responde en 127.0.0.1:5001. Arráncalo con: npm run translator');
  process.exit(1);
}

let total = 0;
let redone = 0;
let english = 0;
for (const f of readdirSync(dir)) {
  const file = join(dir, f);
  const dict = JSON.parse(readFileSync(file, 'utf8'));
  let changed = false;
  for (const [en, es] of Object.entries(dict)) {
    total++;
    const r = await repairTranslation(en, es);
    if (r.redone) redone++;
    if (r.es === en) english++;
    if (r.es !== es) {
      dict[en] = r.es;
      changed = true;
    }
  }
  if (changed) writeFileSync(file, JSON.stringify(dict));
  if (changed) console.log(`${f}: actualizado`);
}
console.log(`\nFrases: ${total} | rehechas: ${redone} | quedan en inglés por seguridad: ${english}`);
