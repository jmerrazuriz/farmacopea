// Logica pura (sin Node ni DOM) para convertir fichas de openFDA en medicamentos.
// La usan el servidor local y la version web para el telefono.

export const OPENFDA_URL = 'https://api.fda.gov/drug/label.json';

// [clave, titulo, campos de openFDA que alimentan la seccion]
export const SECTIONS = [
  ['boxed_warning', 'Advertencia en recuadro', ['boxed_warning']],
  ['indications', 'Indicaciones y uso', ['indications_and_usage']],
  ['dosage', 'Dosis y administración', ['dosage_and_administration', 'dosage_forms_and_strengths']],
  ['contraindications', 'Contraindicaciones', ['contraindications']],
  ['warnings', 'Advertencias y precauciones', ['warnings_and_cautions', 'warnings_and_precautions', 'warnings', 'precautions']],
  ['adverse', 'Reacciones adversas', ['adverse_reactions']],
  ['interactions', 'Interacciones', ['drug_interactions']],
  ['pregnancy', 'Embarazo', ['pregnancy', 'teratogenic_effects', 'nonteratogenic_effects', 'labor_and_delivery']],
  ['lactation', 'Lactancia', ['lactation', 'nursing_mothers']],
  ['pediatric', 'Uso pediátrico', ['pediatric_use']],
  ['geriatric', 'Uso geriátrico', ['geriatric_use']],
  ['populations', 'Poblaciones especiales', ['use_in_specific_populations']],
  ['overdose', 'Sobredosis', ['overdosage']],
  ['description', 'Descripción', ['description']],
  ['pharmacology', 'Farmacología clínica', ['clinical_pharmacology', 'mechanism_of_action', 'pharmacodynamics', 'pharmacokinetics']],
  ['supply', 'Presentación', ['how_supplied']],
  ['patient', 'Información al paciente', ['information_for_patients', 'spl_patient_package_insert', 'patient_medication_information']],
];

const SALT_TAIL = /\s+(sodium|potassium|calcium|hydrochloride|hcl|sulfate|phosphate|maleate|mesylate|tartrate|succinate|besylate|acetate|bromide|citrate|fumarate|carbonate)$/;

const score = (label) => SECTIONS.filter(([, , fields]) => fields.some((f) => label[f]?.length)).length;

const clean = (s) =>
  String(s)
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/(\d)\s+([A-Z]{3,}[A-Z ,&-]{3,})\s/g, '$1 $2\n') // separa encabezados numerados
    .trim();

export const titleCase = (s) => s.toLowerCase().replace(/(^|[\s(/-])([a-záéíóú])/g, (m, a, b) => a + b.toUpperCase());

/**
 * Busca la mejor ficha para un nombre. `query(search, limit)` devuelve un array de fichas de openFDA
 * (se inyecta para poder usar fetch de Node o del navegador).
 */
export async function findLabel(name, query) {
  const n = String(name).replace(/["\\]/g, '').trim();
  if (!n) return null;
  const field = `(openfda.generic_name:"${n}" OR openfda.brand_name:"${n}" OR openfda.substance_name:"${n}")`;
  let results = await query(`${field} AND openfda.product_type:"HUMAN PRESCRIPTION DRUG"`, 8);
  if (!results.length) results = await query(field, 8);
  if (!results.length) return null;
  // prefiere fichas de un solo principio activo cuyo nombre coincide con lo buscado
  const lower = n.toLowerCase();
  const exact = (l) => (l.openfda?.generic_name || []).some((g) => g.toLowerCase().replace(SALT_TAIL, '') === lower);
  const best = (list) => [...list].sort((a, b) => exact(b) - exact(a) || score(b) - score(a))[0];
  let pick = best(results);
  if (!exact(pick)) {
    // p. ej. aspirina: solo existe como OTC, el filtro Rx devuelve combinaciones
    const alt = best(await query(field, 20));
    if (alt && exact(alt)) pick = alt;
  }
  return pick;
}

/** Ficha de openFDA -> { setId, generic, brands, ..., sections:[{key,title,ord,text}] } (o null) */
export function labelToDrug(label) {
  const of = label.openfda || {};
  const generic = titleCase((of.generic_name?.[0] || of.substance_name?.[0] || of.brand_name?.[0] || '').trim());
  if (!generic) return null;
  const sections = [];
  SECTIONS.forEach(([key, title, fields], ord) => {
    const text = fields
      .flatMap((f) => label[f] || [])
      .map(clean)
      .filter(Boolean)
      .join('\n\n');
    if (text) sections.push({ key, title, ord, text });
  });
  return {
    setId: label.set_id || label.id,
    generic,
    brands: [...new Set((of.brand_name || []).map(titleCase))],
    substances: [...new Set((of.substance_name || []).map(titleCase))],
    classes: (of.pharm_class_epc || []).map((c) => c.replace(/\s*\[EPC\]/i, '')),
    routes: (of.route || []).map(titleCase),
    manufacturer: of.manufacturer_name?.[0] || null,
    rxcui: of.rxcui?.[0] || null,
    updated: label.effective_time || null,
    sections,
  };
}
