// Genera la version web estatica (carpeta docs/) para publicarla en GitHub Pages y usarla en el telefono.
// Uso: npm run build:web
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs');
const pub = join(root, 'public');

// Se conserva docs/data/es (traducciones precalculadas: tardan en generarse)
mkdirSync(join(out, 'data', 'es'), { recursive: true });
for (const dir of ['data/drugs', 'shared', 'icons']) rmSync(join(out, dir), { recursive: true, force: true });
mkdirSync(join(out, 'data', 'drugs'), { recursive: true });

// ---- datos ----
const drugs = db.prepare('SELECT * FROM drugs ORDER BY generic COLLATE NOCASE').all();
const secStmt = db.prepare('SELECT key, title, text FROM sections WHERE drug_id = ? ORDER BY ord');
const index = [];
let bytes = 0;
for (const d of drugs) {
  const item = {
    id: d.id,
    generic: d.generic,
    brands: JSON.parse(d.brands),
    substances: JSON.parse(d.substances),
    classes: JSON.parse(d.pharm_class),
    routes: JSON.parse(d.routes),
    manufacturer: d.manufacturer,
    updated: d.effective_time,
  };
  index.push(item);
  const json = JSON.stringify({ ...item, sections: secStmt.all(d.id) });
  bytes += json.length;
  writeFileSync(join(out, 'data', 'drugs', `${d.id}.json`), json);
}
writeFileSync(join(out, 'data', 'index.json'), JSON.stringify(index));

// ---- aplicacion ----
const files = ['index.html', 'app.js', 'icons.js', 'static-api.js', 'styles.css', 'manifest.webmanifest'];
for (const f of files) cpSync(join(pub, f), join(out, f));
cpSync(join(pub, 'icons'), join(out, 'icons'), { recursive: true });
mkdirSync(join(out, 'shared'), { recursive: true });
for (const f of readdirSync(join(root, 'shared'))) cpSync(join(root, 'shared', f), join(out, 'shared', f));
writeFileSync(join(out, 'config.js'), "// Generado por scripts/build-static.mjs\nwindow.APP_MODE = 'static';\n");
writeFileSync(join(out, '.nojekyll'), '');

// ---- service worker ----
const version = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
const shell = [
  './', './index.html', './app.js', './icons.js', './static-api.js', './styles.css', './config.js', './manifest.webmanifest',
  './shared/derive.mjs', './shared/format.mjs', './shared/interactions-core.mjs', './shared/label.mjs',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './data/index.json',
];
writeFileSync(
  join(out, 'sw.js'),
  readFileSync(join(pub, 'sw.js'), 'utf8').replaceAll('__VERSION__', version).replaceAll('__SHELL_FILES__', JSON.stringify(shell))
);

const es = existsSync(join(out, 'data', 'es')) ? readdirSync(join(out, 'data', 'es')).length : 0;
console.log(`docs/ generado: ${drugs.length} fichas (${(bytes / 1e6).toFixed(1)} MB), traducciones del resumen: ${es}/${drugs.length}, version ${version}`);
