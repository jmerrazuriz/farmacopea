import { db, tx } from './db.mjs';
import { OPENFDA_URL, findLabel, labelToDrug } from '../shared/label.mjs';

export { SECTIONS } from '../shared/label.mjs';

async function query(search, limit = 8) {
  const key = process.env.OPENFDA_API_KEY;
  const url = `${OPENFDA_URL}?search=${encodeURIComponent(search)}&limit=${limit}${key ? `&api_key=${key}` : ''}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`openFDA respondió ${res.status}`);
  return (await res.json()).results || [];
}

export const fetchLabel = (name) => findLabel(name, query);

export function storeLabel(label) {
  const d = labelToDrug(label);
  if (!d) return null;

  return tx(() => {
    db.prepare(
      `INSERT INTO drugs (set_id, generic, brands, substances, pharm_class, routes, manufacturer, rxcui, effective_time, fetched)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(set_id) DO UPDATE SET generic=excluded.generic, brands=excluded.brands, substances=excluded.substances,
         pharm_class=excluded.pharm_class, routes=excluded.routes, manufacturer=excluded.manufacturer, rxcui=excluded.rxcui,
         effective_time=excluded.effective_time, fetched=CURRENT_TIMESTAMP`
    ).run(
      d.setId,
      d.generic,
      JSON.stringify(d.brands),
      JSON.stringify(d.substances),
      JSON.stringify(d.classes),
      JSON.stringify(d.routes),
      d.manufacturer,
      d.rxcui,
      d.updated
    );
    const { id } = db.prepare('SELECT id FROM drugs WHERE set_id = ?').get(d.setId);
    db.prepare('DELETE FROM sections WHERE drug_id = ?').run(id);
    const ins = db.prepare('INSERT INTO sections (drug_id, key, title, ord, text) VALUES (?, ?, ?, ?, ?)');
    for (const s of d.sections) ins.run(id, s.key, s.title, s.ord, s.text);
    return id;
  });
}

export async function importDrug(name) {
  const label = await fetchLabel(name);
  if (!label) return null;
  return storeLabel(label);
}
