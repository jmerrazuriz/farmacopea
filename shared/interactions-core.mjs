// Cribado de interacciones a partir de la seccion "Interacciones" de cada ficha. Logica pura.
// drug = { id, generic, brands[], substances[], classes[], text }

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SALTS = /\s+(sodium|potassium|calcium|hydrochloride|hcl|sulfate|sulphate|phosphate|maleate|mesylate|tartrate|succinate|besylate|acetate|bromide|citrate|fumarate|carbonate|chloride|hydrobromide|nitrate)\b/gi;

// Terminos con los que el texto de A puede referirse a B (nombre, marcas, clase)
function termsFor(d) {
  const base = [d.generic, ...d.substances].map((t) => t.replace(SALTS, '').trim());
  const names = [d.generic, ...d.substances, ...base, ...d.brands].filter((t) => t && t.length >= 4);
  const classes = d.classes.filter((c) => c.length >= 6);
  return { names: [...new Set(names)], classes };
}

function snippets(text, patterns) {
  if (!text) return [];
  const out = [];
  for (const sentence of text.split(/(?<=[.;:])\s+|\n+/)) {
    const s = sentence.trim();
    if (s.length < 20) continue;
    if (patterns.some((re) => re.test(s))) out.push(s.length > 600 ? `${s.slice(0, 600)}…` : s);
    if (out.length >= 4) break;
  }
  return out;
}

function mentions(from, to) {
  const t = termsFor(to);
  const byName = snippets(from.text, t.names.map((n) => new RegExp(`\\b${esc(n)}\\b`, 'i')));
  if (byName.length) return { level: 'nombre', snippets: byName };
  const byClass = snippets(from.text, t.classes.map((c) => new RegExp(`\\b${esc(c)}s?\\b`, 'i')));
  if (byClass.length) return { level: 'clase', snippets: byClass };
  return null;
}

// Gravedad ESTIMADA por el tono del texto de la ficha. No es una clasificacion clinica.
const SEVERITY = [
  ['contraindicada', 4, /contraindicated|should not be (used|given|administered|co-?administered)|do not (use|co-?administer)|must not/i],
  ['mayor', 3, /avoid|serious|fatal|life-threatening|severe|major|increase[sd]? (the )?risk of (bleeding|toxicity|hemorrhage)|torsade|qt prolong|lactic acidosis/i],
  ['moderada', 2, /monitor|adjust|dose (reduction|adjustment)|caution|may (increase|decrease|potentiate|reduce)|closely/i],
];

function estimateSeverity(evidence) {
  const text = evidence.flatMap((e) => e.snippets).join(' ');
  for (const [label, rank, re] of SEVERITY) if (re.test(text)) return { label, rank };
  return { label: 'menor', rank: 1 };
}

export function checkInteractionsCore(drugs) {
  const pairs = [];
  for (let i = 0; i < drugs.length; i++) {
    for (let j = i + 1; j < drugs.length; j++) {
      const a = drugs[i];
      const b = drugs[j];
      const ab = mentions(a, b);
      const ba = mentions(b, a);
      if (!ab && !ba) continue;
      const evidence = [
        ...(ab ? [{ source: a.generic, level: ab.level, snippets: ab.snippets }] : []),
        ...(ba ? [{ source: b.generic, level: ba.level, snippets: ba.snippets }] : []),
      ];
      pairs.push({
        a: { id: a.id, name: a.generic },
        b: { id: b.id, name: b.generic },
        // coincidencia por nombre explicito = mas relevante que por clase
        strength: ab?.level === 'nombre' || ba?.level === 'nombre' ? 'nombre' : 'clase',
        severity: estimateSeverity(evidence),
        // documentada en ambas fichas = mayor respaldo
        bidirectional: !!(ab && ba),
        evidence,
      });
    }
  }
  pairs.sort((x, y) => y.severity.rank - x.severity.rank || (x.strength === y.strength ? 0 : x.strength === 'nombre' ? -1 : 1));
  return {
    drugs: drugs.map((d) => ({ id: d.id, name: d.generic, hasInteractionText: !!d.text })),
    pairs,
  };
}
