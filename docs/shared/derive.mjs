// Resumen derivado de la ficha (openFDA). Principios para no ser impreciso:
//  - Solo frases LITERALES de la ficha, completas (nunca cortadas a mitad de frase).
//  - Cada dato indica la seccion de origen.
//  - Prioriza subsecciones dedicadas (p. ej. "8.6 Renal Impairment"); si no hay, solo frases que
//    mencionan la poblacion Y una accion (dosis, ajustar, evitar, vigilar...).
//  - Si no hay informacion fiable se dice asi, no se rellena.

const CITATIONS = [
  /\[\s*see[^\]]*\]/gi, // [see Warnings and Precautions (5.1)]
  /\(\s*\d{1,2}(?:\.\d{1,2})?(?:\s*,\s*\d{1,2}(?:\.\d{1,2})?)*\s*\)/g, // ( 2.1 ) ( 1 , 5.3 )
];

function tidy(s) {
  let t = s;
  for (const re of CITATIONS) t = t.replace(re, ' ');
  return t.replace(/\s+([.,;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

function cleanSentence(s) {
  return s
    .replace(/^(\d{1,2}(?:\.\d{1,2})*\s+)+(?=[A-Z])/, '')
    .replace(/^(?:Pediatric Use|Geriatric Use|Pregnancy|Lactation|Nursing Mothers)\s+(?:[A-Z][\w-]*(?: [A-Z][\w-]*)?\s+)?(?=The |In |No |Of |Adequate |Safety |Controlled |Normal |Use |Warfarin |Metformin |There |Because |It )/, '')
    // encabezado en mayusculas pegado a la frase ("WARNING: BLEEDING RISK Warfarin can...")
    .replace(/^(?:[A-Z]{3,}(?:[ &,/-]+[A-Z]{3,})*:?\s+)+(?=[A-Z][a-z])/, '')
    .replace(/^[\s:\u2022\u2212\u2013-]+/, '')
    .replace(/\.{2,}\s*$/, '.')
    .trim();
}

function splitSentences(text, minLen = 20) {
  return tidy(text)
    .split(/(?<=[.;!?])\s+(?=[A-Z(\u2022])/)
    .map(cleanSentence)
    // descarta fragmentos: una frase completa empieza en mayuscula o cifra
    .filter((s) => s.length >= minLen && /^[A-Z0-9(]/.test(s) && !/^See full prescribing information/i.test(s));
}

function dedupe(sentences) {
  const keys = [];
  return sentences.filter((s) => {
    const full = norm(s);
    const k = full.slice(0, 50);
    if (k.length < 8) return true;
    const head = k.slice(0, 28);
    // repetido, o resumen que contiene una frase ya vista (la ficha repite los "highlights")
    if (keys.some((p) => p === k || p.startsWith(head) || (p.length >= 24 && full.length > p.length * 1.5 && full.includes(p.slice(0, 24))))) return false;
    keys.push(k);
    return true;
  });
}

// Toma frases completas hasta un limite de caracteres; indica si quedo texto fuera.
function takeWhole(sentences, max) {
  const out = [];
  let used = 0;
  for (const s of sentences) {
    if (out.length && used + s.length > max) return { items: out, truncated: true };
    out.push(s);
    used += s.length;
  }
  return { items: out, truncated: false };
}

// ---- subsecciones numeradas / encabezados conocidos ----
const NEXT_HEADING = /\s(?=\d{1,2}\.\d{1,2}\s+[A-Z][A-Za-z])|\s(?=(?:Pregnancy|Lactation|Nursing Mothers|Pediatric Use|Geriatric Use|Renal (?:Impairment|Insufficiency)|Hepatic (?:Impairment|Insufficiency)|Females and Males of Reproductive Potential|Overdosage|Drug Abuse and Dependence|Information for Patients|Carcinogenesis)\b)/;

const HEADINGS = {
  renal: /\b(?:\d{1,2}\.\d{1,2}\s+)?(?:Dosage (?:Recommendations )?(?:in|for) (?:Patients with )?Renal (?:Impairment|Insufficiency)|Renal (?:Impairment|Insufficiency))\b/gi,
  hepatic: /\b(?:\d{1,2}\.\d{1,2}\s+)?(?:Dosage (?:Recommendations )?(?:in|for) (?:Patients with )?Hepatic (?:Impairment|Insufficiency)|Hepatic (?:Impairment|Insufficiency))\b/gi,
};

function subsection(text, headingRe) {
  const found = [];
  for (const m of text.matchAll(headingRe)) {
    const start = m.index + m[0].length;
    const rest = text.slice(start);
    const end = rest.search(NEXT_HEADING);
    const body = (end === -1 ? rest : rest.slice(0, end)).trim();
    // Evita falsas coincidencias: el cuerpo debe ser texto real, no un indice o referencia cruzada
    if (body.length >= 40 && !/^\)|^\]/.test(body)) found.push(body);
  }
  return found;
}

const CATEGORIES = [
  { key: 'renal', title: 'Insuficiencia renal', term: /\brenal (?:impairment|insufficiency|disease|failure)\b|\bkidney (?:disease|impairment)\b|\bcreatinine clearance\b|\begfr\b|\bcrcl\b/i, from: ['dosage', 'populations', 'warnings', 'pharmacology'] },
  { key: 'hepatic', title: 'Insuficiencia hepática', term: /\bhepatic (?:impairment|insufficiency|disease|dysfunction)\b|\bliver (?:disease|impairment|dysfunction)\b|\bcirrhosis\b|\bchild-pugh\b/i, from: ['dosage', 'populations', 'warnings', 'pharmacology'] },
  { key: 'pediatric', title: 'Pediatría', term: /\bpediatric\b|\bchildren\b|\bneonat\w*|\binfants?\b|\badolescents?\b/i, from: ['dosage', 'populations'], dedicated: 'pediatric' },
  { key: 'geriatric', title: 'Ancianos', term: /\bgeriatric\b|\belderly\b|\bolder (?:adults|patients)\b|\b65 years\b/i, from: ['dosage', 'populations'], dedicated: 'geriatric' },
];

// Frases con una accion concreta (dosis, ajuste, evitar, vigilar...)
const ACTION = /\b(?:dos(?:e|es|age|ing)|adjust\w*|reduc\w*|lower|avoid\w*|not recommended|do not|should not|contraindicated|monitor\w*|no (?:dos(?:e|age) )?adjustment|initiat\w*|start\w*|titrat\w*|discontinu\w*|caution)\b/i;

const titleOf = (sections, key) => sections.find((s) => s.key === key)?.title || key;

function adjustmentsFor(cat, sections, by) {
  const out = [];
  const push = (text, key, kind) => out.push({ text, source: titleOf(sections, key), sourceKey: key, kind });

  // 1) seccion dedicada completa (uso pediatrico / geriatrico: ya viene separada de la ficha)
  if (cat.dedicated && by[cat.dedicated]) {
    // openFDA a veces mezcla subsecciones (p. ej. parto o lactancia dentro de pediatria):
    // solo se aceptan frases que mencionan la poblacion
    const own = dedupe(splitSentences(by[cat.dedicated])).filter((x) => cat.term.test(x));
    const s = takeWhole(own, 650);
    s.items.forEach((t) => push(t, cat.dedicated, 'seccion'));
    if (s.truncated) out.truncated = true;
    if (out.length) return out;
  }

  // 2) subsecciones dedicadas dentro de dosis / poblaciones (solo renal y hepatica)
  if (HEADINGS[cat.key]) {
    for (const key of ['dosage', 'populations', 'pharmacology']) {
      if (!by[key]) continue;
      for (const body of subsection(by[key], HEADINGS[cat.key])) {
        const s = takeWhole(dedupe(splitSentences(body)), 600);
        s.items.forEach((t) => push(t, key, 'subseccion'));
        if (s.truncated) out.truncated = true;
        if (out.length >= 4) break;
      }
      if (out.length >= 4) break;
    }
    if (out.length) return dedupeItems(out).slice(0, 4);
  }

  // 3) respaldo estricto: frases que mencionan la poblacion Y una accion
  for (const key of cat.from) {
    if (!by[key]) continue;
    for (const s of dedupe(splitSentences(by[key]))) {
      if (s.length <= 420 && cat.term.test(s) && ACTION.test(s)) push(s, key, 'frase');
      if (out.length >= 3) break;
    }
    if (out.length >= 3) break;
  }
  return dedupeItems(out).slice(0, 3);
}

function dedupeItems(items) {
  const keys = [];
  const kept = items.filter((i) => {
    const k = norm(i.text).slice(0, 45);
    if (keys.includes(k)) return false;
    keys.push(k);
    return true;
  });
  if (items.truncated) kept.truncated = true;
  return kept;
}

function block(by, key, max, strip, opts = {}) {
  if (!by[key]) return null;
  let text = tidy(strip ? by[key].replace(strip, '') : by[key]);
  if (opts.intro) text = text.replace(opts.intro, '');
  const r = takeWhole(dedupe(splitSentences(text, opts.minLen)), max);
  return r.items.length ? r : null;
}

export function buildSummary(sections) {
  const by = Object.fromEntries(sections.map((s) => [s.key, s.text]));
  return {
    boxed: block(by, 'boxed_warning', 1100, /^BOXED WARNING\s*/i),
    indications: block(by, 'indications', 1100, /^\d*\s*INDICATIONS?(?: AND| &) USAGE\s*/i),
    contraindications: block(by, 'contraindications', 1400, /^\d*\s*CONTRAINDICATIONS?\s*/i, {
      minLen: 8,
      // quita la frase introductoria ("X is contraindicated in patients with:") y deja cada condicion
      intro: /\b[A-Z][\w ,'-]{0,70}?\b(?:is|are) contraindicated (?:in|for)(?: patients with| women who are pregnant)?\s*:\s*/g,
    }),
    adjustments: CATEGORIES.map((c) => {
      const items = adjustmentsFor(c, sections, by);
      return { key: c.key, title: c.title, items: [...items], truncated: !!items.truncated };
    }),
    hasPregnancy: !!(by.pregnancy || by.lactation),
  };
}
