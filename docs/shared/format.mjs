// Da estructura legible al texto de una ficha (openFDA lo entrega aplanado en un solo parrafo).
// Devuelve bloques: { type: 'h', num, text } | { type: 'p', label?, text } | { type: 'ul', items: [{label?, text}] }
// Logica pura: la usan la version local y la version web.

const CONNECTORS = new Set(['of', 'and', 'the', 'in', 'for', 'to', 'with', 'or', 'on', 'a', 'an', 'by', 'from', 'during', 'after']);
const BULLET = /\s*[•●▪◦‣]\s+/;
const DASH_ITEM = /\s[−–]\s+(?=[A-Z])/;
const LABELS = ['Clinical Impact', 'Intervention', 'Examples', 'Management', 'Mechanism', 'Recommendation', 'Prevention', 'Risk Summary', 'Clinical Considerations', 'Data'];
const LABEL_SPLIT = new RegExp(`(?<=[.;:?!)\\]]\\s)(?=(?:${LABELS.join('|')}):\\s)`);
const LABEL_HEAD = new RegExp(`^(${LABELS.join('|')}):\\s+`);

// Referencias cruzadas que solo estorban al leer: [see Warnings (5.1)] y ( 7 )
function stripRefs(t) {
  return t
    .replace(/\[\s*see[^\]]*\]/gi, '')
    .replace(/\(\s*\d{1,2}(?:\.\d{1,2})?(?:\s*,\s*\d{1,2}(?:\.\d{1,2})?)*\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1');
}

const isCapWord = (w) => /^[A-Z][\w\-/(),&']*$/.test(w);

// Encabezados numerados dentro de una linea: "7.1 General Information Drugs may interact..."
function splitHeadings(line, names = new Set()) {
  const out = [];
  const re = /(?:^|(?<=[.;:?!)\]]\s))(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\s+(?=[A-Z])/g;
  let last = 0;
  let m;
  const marks = [];
  while ((m = re.exec(line))) marks.push({ at: m.index, num: m[1], start: m.index + m[0].length });
  if (!marks.length) return [{ text: line }];

  if (marks[0].at > 0) out.push({ text: line.slice(0, marks[0].at).trim() });
  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].at : line.length;
    const rest = line.slice(mk.start, end).trim();
    const words = rest.split(/\s+/);
    // titulo = palabras con mayuscula (y conectores) hasta la primera palabra "de frase normal"
    let n = 0;
    while (n < words.length && n < 9 && (isCapWord(words[n]) || (n > 0 && CONNECTORS.has(words[n])))) {
      const w = words[n].replace(/[^A-Za-z]/g, '');
      // el titulo se corta antes del nombre del farmaco o de una marca en MAYUSCULAS ("... Discontinue SYNJARDY")
      if (n >= 2 && w && (names.has(w.toLowerCase()) || (w.length >= 5 && w === w.toUpperCase()))) break;
      n++;
    }
    // si la siguiente palabra es minuscula, la ultima mayuscula suele ser el inicio de la frase ("Drugs may...")
    if (n > 1 && n < words.length && !CONNECTORS.has(words[n]) && /^[a-z]/.test(words[n]) && isCapWord(words[n - 1])) n--;
    // el titulo no termina en conector
    while (n > 1 && CONNECTORS.has(words[n - 1].toLowerCase())) n--;
    const title = words.slice(0, n).join(' ');
    const body = words.slice(n).join(' ').trim();
    out.push({ heading: { num: mk.num, text: title } });
    if (body) out.push({ text: body });
    last = end;
  });
  return out;
}

function sentences(text) {
  return text.split(/(?<=[.!?])\s+(?=[A-Z(])/).filter(Boolean);
}

// Agrupa frases en parrafos cortos (max. 3 frases o ~420 caracteres)
function paragraphs(text) {
  const out = [];
  let cur = [];
  let len = 0;
  for (const s of sentences(text)) {
    if (cur.length && (cur.length >= 3 || len + s.length > 420)) {
      out.push(cur.join(' '));
      cur = [];
      len = 0;
    }
    cur.push(s);
    len += s.length;
  }
  if (cur.length) out.push(cur.join(' '));
  return out;
}

// Subtitulo pegado antes de la etiqueta: "Alcohol Clinical Impact: ..." -> "Alcohol" + parrafo
const SUBTITLE = /(?<=^|[.;?!)\]]\s)([A-Z][\w\-/(),&']*(?:\s+(?:[A-Z][\w\-/(),&']*|of|and|the|or|to|with|for|in|that)){0,8})\s+(?=Clinical Impact:)/g;

// Parte un parrafo muy largo (tablas aplanadas) en trozos de ~500 caracteres, en comas o punto y coma
function hardWrap(text, max = 650) {
  if (text.length <= max) return [text];
  const out = [];
  let rest = text;
  while (rest.length > max) {
    const cut = Math.max(rest.lastIndexOf('; ', 560), rest.lastIndexOf(', ', 560), rest.lastIndexOf(' ', 560));
    const at = cut > 200 ? cut + 1 : 560;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function pushParagraphs(blocks, text) {
  // "Alcohol Clinical Impact: ..." -> subtitulo "Alcohol" + parrafo con etiqueta
  const MARK_A = '\u0001';
  const MARK_B = '\u0002';
  const withSubs = text.replace(SUBTITLE, `${MARK_A}$1${MARK_B}`);
  if (withSubs.includes(MARK_A)) {
    for (const piece of withSubs.split(MARK_A)) {
      if (!piece.trim()) continue;
      const close = piece.indexOf(MARK_B);
      if (close === -1) {
        pushPlain(blocks, piece.trim());
      } else {
        blocks.push({ type: 'h', sub: true, text: piece.slice(0, close).trim() });
        pushPlain(blocks, piece.slice(close + 1).trim());
      }
    }
    return;
  }
  pushPlain(blocks, text);
}

function pushPlain(blocks, text) {
  for (const part of text.split(LABEL_SPLIT)) {
    const t = part.trim();
    if (!t) continue;
    const lab = t.match(LABEL_HEAD);
    const body = lab ? t.slice(lab[0].length) : t;
    const isTable = /^Table \d+[:.]/.test(body);
    paragraphs(body).flatMap((p) => hardWrap(p)).forEach((p, i) =>
      blocks.push({ type: 'p', ...(lab && i === 0 ? { label: lab[1] } : isTable && i === 0 ? { label: 'Tabla' } : {}), text: p }));
  }
}

function pushSegment(blocks, text) {
  const parts = text.split(BULLET);
  if (parts.length > 1) {
    if (parts[0].trim()) pushParagraphs(blocks, parts[0].trim());
    const items = parts.slice(1).map((s) => s.trim()).filter(Boolean).map((t) => {
      const lab = t.match(LABEL_HEAD);
      return lab ? { label: lab[1], text: t.slice(lab[0].length) } : { text: t };
    });
    if (items.length) blocks.push({ type: 'ul', items });
    return;
  }
  const dashes = text.split(DASH_ITEM);
  if (dashes.length >= 3) {
    if (dashes[0].trim()) pushParagraphs(blocks, dashes[0].trim());
    blocks.push({ type: 'ul', items: dashes.slice(1).map((t) => ({ text: t.trim() })).filter((i) => i.text) });
    return;
  }
  pushParagraphs(blocks, text);
}

/**
 * @param {string} text texto de la seccion
 * @param {{structured?: boolean, names?: string[]}} opts structured=false para texto traducido (sin deteccion
 *   de encabezados en ingles); names = nombres del medicamento (generico, marcas) para no confundirlos con titulos
 */
export function formatText(text, { structured = true, names = [] } = {}) {
  const blocks = [];
  const nameSet = new Set(names.flatMap((n) => String(n).split(/[\s,/()-]+/)).map((w) => w.toLowerCase()).filter((w) => w.length >= 5));
  const lines = stripRefs(String(text)).split(/\n+/).map((s) => s.trim()).filter(Boolean);
  for (const line of lines) {
    // linea que es un encabezado en mayusculas: "7 DRUG INTERACTIONS"
    const up = line.match(/^(\d{1,2}(?:\.\d{1,2})*)\s+([A-Z][A-Z0-9 ,&/()'-]{3,})$/);
    if (up) {
      blocks.push({ type: 'h', num: up[1], text: up[2].charAt(0) + up[2].slice(1).toLowerCase() });
      continue;
    }
    if (!structured) {
      pushSegment(blocks, line);
      continue;
    }
    for (const seg of splitHeadings(line, nameSet)) {
      if (seg.heading) blocks.push({ type: 'h', num: seg.heading.num, text: seg.heading.text });
      else if (seg.text) pushSegment(blocks, seg.text);
    }
  }
  return blocks;
}
