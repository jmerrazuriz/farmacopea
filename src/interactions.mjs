import { db } from './db.mjs';
import { checkInteractionsCore } from '../shared/interactions-core.mjs';

function loadDrug(id) {
  const d = db.prepare('SELECT * FROM drugs WHERE id = ?').get(id);
  if (!d) return null;
  const sec = db.prepare("SELECT text FROM sections WHERE drug_id = ? AND key = 'interactions'").get(id);
  return {
    id: d.id,
    generic: d.generic,
    brands: JSON.parse(d.brands),
    substances: JSON.parse(d.substances),
    classes: JSON.parse(d.pharm_class),
    text: sec?.text || '',
  };
}

export function checkInteractions(ids) {
  return checkInteractionsCore([...new Set(ids)].map(loadDrug).filter(Boolean));
}
