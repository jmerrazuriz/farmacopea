const app = document.getElementById('app');
// 'static' = version web sin servidor (telefono / GitHub Pages); 'server' = servidor local con login
const STATIC = window.APP_MODE === 'static';
const state = { user: null, hasUsers: true, interactionIds: [], interactionNames: new Map() };

// ---------- utilidades ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}

async function api(path, opts = {}) {
  if (STATIC) {
    const { staticApi } = await import('./static-api.js');
    return staticApi(path, opts);
  }
  const res = await fetch(`/api${path}`, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.user) {
    state.user = null;
    route();
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

const go = (hash) => (location.hash = hash);
const showError = (box, e) => box.replaceChildren(h('div', { class: 'error', role: 'alert' }, e.message));

// ---------- vistas ----------
function layout(...content) {
  return [
    h('header', { class: 'topbar' },
      h('span', { class: 'logo', onclick: () => go('#/') }, '⚕ Farmacopea'),
      h('nav', {},
        navBtn('🔍', 'Buscar', '#/'),
        navBtn('🔤', 'A-Z', '#/indice'),
        navBtn('⚠️', `Interacciones${state.interactionIds.length ? ` (${state.interactionIds.length})` : ''}`, '#/interacciones'),
        navBtn('★', 'Favoritos', '#/favoritos')),
      !STATIC && h('span', { class: 'who' }, state.user.username),
      !STATIC && h('button', { class: 'out', onclick: logout }, 'Salir')),
    h('main', {}, content,
      h('p', { class: 'disclaimer' },
        'Datos de fichas técnicas (SPL) obtenidos de openFDA, de dominio público. Pueden estar desactualizados o ser incompletos. ',
        'Esta herramienta no sustituye al juicio clínico ni a una referencia farmacológica con licencia.')),
  ];
}

function navBtn(icon, label, hash) {
  const on = (location.hash || '#/') === hash;
  return h('button', { class: on ? 'on' : '', onclick: () => go(hash) }, h('span', { class: 'ico', 'aria-hidden': 'true' }, icon), h('span', { class: 'lbl' }, label));
}

function drugItem(d) {
  const sub = [d.brands.filter((b) => b.toLowerCase() !== d.generic.toLowerCase()).slice(0, 3).join(', '), d.classes[0]]
    .filter(Boolean).join(' · ');
  return h('li', { class: 'item', tabindex: '0', role: 'link', onclick: () => go(`#/medicamento/${d.id}`),
      onkeydown: (e) => e.key === 'Enter' && go(`#/medicamento/${d.id}`) },
    h('div', {}, h('div', { class: 'name' }, d.generic), sub && h('div', { class: 'sub' }, sub)),
    h('button', { class: 'btn ghost', title: 'Añadir al comprobador de interacciones',
      onclick: (e) => { e.stopPropagation(); addToInteractions(d); e.target.textContent = '✓'; } }, '+ Interacción'));
}

function addToInteractions(d) {
  if (!state.interactionIds.includes(d.id)) state.interactionIds.push(d.id);
  state.interactionNames.set(d.id, d.generic);
}

async function viewHome() {
  const results = h('div');
  const err = h('div');
  const input = h('input', { type: 'search', placeholder: 'Nombre genérico, marca o clase terapéutica…', autofocus: true, 'aria-label': 'Buscar medicamento' });
  let timer;
  const run = async () => {
    const q = input.value.trim();
    err.replaceChildren();
    if (!q) return showRecent();
    try {
      const { results: rows } = await api(`/search?q=${encodeURIComponent(q)}`);
      if (q !== input.value.trim()) return;
      results.replaceChildren(
        rows.length ? h('ul', { class: 'list' }, rows.map(drugItem)) : '',
        h('div', { class: 'card', style: 'margin-top:.75rem' },
          h('p', { class: 'muted' }, rows.length
            ? '¿No está el que buscas?'
            : `No hay coincidencias locales para "${q}".`),
          q.length >= 2 && h('button', { class: 'btn', onclick: (e) => importDrug(q, e.target) }, `Buscar "${q}" en openFDA e importar`)));
    } catch (e) { showError(err, e); }
  };
  async function importDrug(name, btn) {
    btn.disabled = true;
    btn.textContent = 'Importando…';
    try {
      const { id } = await api('/import', { method: 'POST', body: { name } });
      go(`#/medicamento/${id}`);
    } catch (e) { showError(err, e); btn.disabled = false; btn.textContent = 'Reintentar'; }
  }
  async function showRecent() {
    try {
      const [hist, favs] = await Promise.all([api('/history'), api('/favorites')]);
      results.replaceChildren(h('div', {},
        hist.results.length ? [h('h2', {}, 'Consultados recientemente'), h('ul', { class: 'list' }, hist.results.slice(0, 8).map(drugItem))] : '',
        favs.results.length ? [h('h2', {}, 'Favoritos'), h('ul', { class: 'list' }, favs.results.map(drugItem))] : '',
        !hist.results.length && !favs.results.length ? h('p', { class: 'muted' }, 'Escribe un medicamento para empezar o explora el índice A-Z.') : ''));
    } catch (e) { showError(err, e); }
  }
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
  app.replaceChildren(...layout(h('h1', {}, 'Buscar medicamento'), h('div', { class: 'searchbox' }, input), err, results));
  input.focus();
  showRecent();
}

async function viewIndex(letter) {
  const list = h('div');
  const err = h('div');
  app.replaceChildren(...layout(h('h1', {}, 'Índice de medicamentos'), err, list));
  try {
    const { results, letters } = await api(`/drugs${letter ? `?letter=${letter}` : ''}`);
    list.replaceChildren(
      h('div', { class: 'azbar' },
        h('button', { class: !letter ? 'on' : '', onclick: () => go('#/indice') }, 'Todos'),
        letters.map((l) => h('button', { class: l === letter ? 'on' : '', onclick: () => go(`#/indice/${l}`) }, l))),
      h('p', { class: 'muted' }, `${results.length} medicamento(s)`),
      h('ul', { class: 'list' }, results.map(drugItem)));
  } catch (e) { showError(err, e); }
}

async function viewDrug(id) {
  const body = h('div');
  app.replaceChildren(...layout(body));
  try {
    const d = await api(`/drugs/${id}`);
    const allTabs = [{ key: 'summary', title: 'Resumen' }, ...d.sections];
    let current = 'summary';
    let favorite = d.favorite;
    let query = '';
    const content = h('div');
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    const count = (text) => (query ? (text.toLowerCase().split(query.toLowerCase()).length - 1) : 0);
    const filter = h('input', { type: 'search', class: 'filter', placeholder: 'Buscar dentro de la ficha…', 'aria-label': 'Buscar dentro de la ficha' });
    filter.addEventListener('input', () => {
      query = filter.value.trim();
      if (query) {
        const first = d.sections.find((s) => count(s.text) > 0);
        if (first && !(current !== 'summary' && count(d.sections.find((s) => s.key === current)?.text || '') > 0)) current = first.key;
      }
      paint();
    });

    // Texto con coincidencias resaltadas (sin innerHTML)
    const highlight = (text) => {
      if (!query) return text;
      const out = [];
      const lower = text.toLowerCase();
      const q = query.toLowerCase();
      let i = 0;
      for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, i)) {
        out.push(text.slice(i, at), h('mark', {}, text.slice(at, at + q.length)));
        i = at + q.length;
      }
      out.push(text.slice(i));
      return out;
    };

    // ---- traduccion (bajo demanda, con el traductor local) ----
    let lang = 'en';
    const tcache = new Map();
    const notice = h('div', { class: 'tr-notice', role: 'status' });
    const trBtn = h('button', { class: 'btn ghost', onclick: () => toggleLang() }, '🌐 Traducir al español');
    const show = (t) => (lang === 'es' && tcache.has(t) ? tcache.get(t) : t);

    // Textos que se ven ahora mismo (para traducir solo lo necesario)
    const visibleTexts = () => {
      if (current !== 'summary') return [d.sections.find((x) => x.key === current)?.text].filter(Boolean);
      const sm = d.summary;
      return [
        ...(sm.boxed?.items || []), ...(sm.indications?.items || []), ...(sm.contraindications?.items || []),
        ...sm.adjustments.flatMap((a) => a.items.map((i) => i.text)),
      ];
    };

    async function ensureTranslated() {
      if (lang !== 'es') { notice.replaceChildren(); return; }
      const need = [...new Set(visibleTexts())].filter((t) => !tcache.has(t));
      if (!need.length) {
        notice.replaceChildren('Traducción automática del inglés: puede contener errores. El texto original de la ficha prevalece.');
        return;
      }
      notice.replaceChildren('Traduciendo… (la primera vez puede tardar; después queda guardada)');
      try {
        for (let i = 0; i < need.length; i += 20) {
          const batch = need.slice(i, i + 20);
          const { translations } = await api('/translate', { method: 'POST', body: { texts: batch } });
          batch.forEach((t, n) => tcache.set(t, translations[n]));
          if (lang === 'es') paint(false);
        }
        if (lang === 'es') notice.replaceChildren('Traducción automática del inglés: puede contener errores. El texto original de la ficha prevalece.');
      } catch (e) {
        lang = 'en';
        trBtn.textContent = '🌐 Traducir al español';
        notice.replaceChildren(h('div', { class: 'error', role: 'alert' }, e.message));
        paint(false);
      }
    }

    function toggleLang() {
      lang = lang === 'es' ? 'en' : 'es';
      trBtn.textContent = lang === 'es' ? '↩ Ver original (inglés)' : '🌐 Traducir al español';
      paint();
    }

    const sourceNote = (i) => h('span', { class: 'src' }, ` — ${i.source}`);

    const summaryView = () => {
      const sm = d.summary;
      const jump = (key) => () => { current = key; paint(); };
      const list = (b) => h('ul', {}, b.items.map((t) => h('li', {}, show(t))));
      const more = (b, key) => b.truncated && h('p', { class: 'muted' }, 'Hay más texto en la ficha. ', h('button', { class: 'link', onclick: jump(key) }, 'Ver sección completa'));
      return h('div', {},
        sm.boxed && h('div', { class: 'qa boxed-qa' }, h('h3', {}, '⚠ Advertencia en recuadro'), list(sm.boxed), more(sm.boxed, 'boxed_warning')),
        h('div', { class: 'qa' }, h('h3', {}, 'Indicaciones'),
          sm.indications ? [list(sm.indications), more(sm.indications, 'indications')] : h('p', { class: 'muted' }, 'La ficha no incluye esta sección.')),
        h('div', { class: 'qa' }, h('h3', {}, 'Contraindicaciones'),
          sm.contraindications ? [list(sm.contraindications), more(sm.contraindications, 'contraindications')] : h('p', { class: 'muted' }, 'La ficha no incluye esta sección.')),
        h('h3', { class: 'qa-title' }, 'Ajustes de dosis y poblaciones especiales'),
        h('div', { class: 'grid' }, sm.adjustments.map((a) => h('div', { class: 'qa small' }, h('h4', {}, a.title),
          a.items.length
            ? [h('ul', {}, a.items.map((i) => h('li', {}, show(i.text), sourceNote(i)))),
              a.truncated && h('p', { class: 'muted' }, 'Hay más texto en la ficha completa.')]
            : h('p', { class: 'muted' }, 'La ficha no da recomendaciones específicas para este grupo.')))),
        h('div', { class: 'qa' }, h('h3', {}, 'Embarazo y lactancia'),
          sm.hasPregnancy
            ? h('p', {}, 'Consulta las pestañas ', h('button', { class: 'link', onclick: jump('pregnancy') }, 'Embarazo'), ' y ', h('button', { class: 'link', onclick: jump('lactation') }, 'Lactancia'), '.')
            : h('p', { class: 'muted' }, 'La ficha no incluye estas secciones por separado.')),
        h('p', { class: 'muted' }, 'Cada frase es una cita literal de la ficha de openFDA (con su sección de origen); no hay paráfrasis. Los números de referencia se omiten.'));
    };
    const favBtn = h('button', { class: 'btn ghost', onclick: async () => {
      await api(`/drugs/${id}/favorite`, { method: favorite ? 'DELETE' : 'PUT' });
      favorite = !favorite;
      paintFav();
    } });
    const paintFav = () => { favBtn.textContent = favorite ? '★ Favorito' : '☆ Añadir a favoritos'; };
    const paint = (translate = true) => {
      tabs.replaceChildren(...allTabs.map((s) => {
        const n = s.text ? count(show(s.text)) : 0;
        return h('button', { role: 'tab', class: `${s.key === current ? 'on' : ''} ${s.key === 'boxed_warning' ? 'boxed' : ''}`,
          'aria-selected': String(s.key === current), onclick: () => { current = s.key; paint(); } },
          s.title, n ? h('span', { class: 'badge-count' }, String(n)) : '');
      }));
      if (current === 'summary') content.replaceChildren(summaryView());
      else {
        const s = d.sections.find((x) => x.key === current);
        content.replaceChildren(s ? h('div', { class: `content${s.key === 'boxed_warning' ? ' boxed' : ''}`, lang: lang === 'es' && tcache.has(s.text) ? 'es' : 'en' }, highlight(show(s.text))) : h('p', { class: 'muted' }, 'Sin información.'));
      }
      if (translate) ensureTranslated();
    };
    paintFav();
    paint();
    const extra = d.brands.filter((b) => b.toLowerCase() !== d.generic.toLowerCase());
    body.replaceChildren(
      h('div', { class: 'head' },
        h('div', {},
          h('h1', {}, d.generic),
          extra.length ? h('div', {}, 'Marcas: ', extra.map((b) => h('span', { class: 'tag' }, b))) : '',
          h('div', {}, d.classes.map((c) => h('span', { class: 'tag' }, c)), d.routes.map((r) => h('span', { class: 'tag' }, `Vía: ${r}`))),
          d.manufacturer && h('div', { class: 'muted' }, `Fabricante de la ficha: ${d.manufacturer}`)),
        h('div', { class: 'actions' }, favBtn, ' ', trBtn, ' ',
          h('button', { class: 'btn ghost', onclick: () => window.print() }, '🖨 Imprimir'), ' ',
          h('button', { class: 'btn', onclick: () => { addToInteractions(d); go('#/interacciones'); } }, 'Comprobar interacciones'))),
      filter,
      notice,
      tabs,
      h('div', { class: 'card' }, content));
  } catch (e) { showError(body, e); }
}

async function viewInteractions() {
  const chips = h('div', { class: 'chips' });
  const out = h('div');
  const err = h('div');
  const input = h('input', { type: 'search', placeholder: 'Añadir medicamento…', 'aria-label': 'Añadir medicamento' });
  const suggestions = h('ul', { class: 'list' });
  const checkBtn = h('button', { class: 'btn', onclick: check }, 'Comprobar interacciones');

  const paintChips = () => {
    chips.replaceChildren(...state.interactionIds.map((id) =>
      h('span', { class: 'chip' }, state.interactionNames.get(id) || `#${id}`,
        h('button', { 'aria-label': 'Quitar', onclick: () => { state.interactionIds = state.interactionIds.filter((x) => x !== id); paintChips(); } }, '×'))));
    checkBtn.disabled = state.interactionIds.length < 2;
  };
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (!q) return suggestions.replaceChildren();
      try {
        const { results } = await api(`/search?q=${encodeURIComponent(q)}`);
        suggestions.replaceChildren(...results.slice(0, 6).map((d) =>
          h('li', { class: 'item', tabindex: '0', onclick: () => { addToInteractions(d); input.value = ''; suggestions.replaceChildren(); paintChips(); } },
            h('span', { class: 'name' }, d.generic), h('span', { class: 'sub' }, '+ añadir'))));
      } catch (e) { showError(err, e); }
    }, 250);
  });

  async function check() {
    err.replaceChildren();
    out.replaceChildren(h('p', { class: 'muted' }, 'Comprobando…'));
    try {
      const r = await api('/interactions', { method: 'POST', body: { ids: state.interactionIds } });
      const missing = r.drugs.filter((d) => !d.hasInteractionText);
      out.replaceChildren(h('div', {},
        h('h2', {}, r.pairs.length ? `${r.pairs.length} posible(s) interacción(es) encontrada(s)` : 'Sin interacciones mencionadas en las fichas'),
        !r.pairs.length && h('p', { class: 'ok' }, 'Ninguna ficha menciona a las otras por nombre ni por clase. Esto NO garantiza que no exista interacción.'),
        r.pairs.map((p) => h('div', { class: `card pair ${p.strength} sev-${p.severity.label}`, style: 'margin-bottom:.75rem' },
          h('h3', {}, `${p.a.name} + ${p.b.name}`,
            h('span', { class: `sev ${p.severity.label}`, title: 'Estimada por el tono del texto de la ficha; no es una clasificación clínica' }, `Gravedad estimada: ${p.severity.label}`),
            h('span', { class: `badge ${p.strength}` }, p.strength === 'nombre' ? 'MENCIÓN DIRECTA' : 'POR CLASE'),
            p.bidirectional && h('span', { class: 'badge bi', title: 'Ambas fichas mencionan al otro fármaco' }, 'EN AMBAS FICHAS')),
          p.evidence.map((ev) => [
            h('div', { class: 'muted' }, `Según la ficha de ${ev.source} (${ev.level}):`),
            ev.snippets.map((s) => h('blockquote', {}, s)),
          ]))),
        missing.length ? h('p', { class: 'muted' }, `Sin sección de interacciones en la ficha de: ${missing.map((d) => d.name).join(', ')}.`) : ''));
    } catch (e) { out.replaceChildren(); showError(err, e); }
  }

  app.replaceChildren(...layout(
    h('h1', {}, 'Comprobador de interacciones'),
    h('p', { class: 'muted' }, 'Busca en la sección de interacciones de cada ficha menciones a los demás medicamentos seleccionados (por nombre, marca o clase). Es un cribado orientativo, no un análisis clínico.'),
    h('div', { class: 'searchbox' }, input), suggestions, chips, checkBtn, err, out));
  paintChips();
}

async function viewFavorites() {
  const list = h('div');
  app.replaceChildren(...layout(h('h1', {}, 'Favoritos'), list));
  try {
    const { results } = await api('/favorites');
    list.replaceChildren(results.length ? h('ul', { class: 'list' }, results.map(drugItem)) : h('p', { class: 'muted' }, 'Aún no tienes favoritos.'));
  } catch (e) { showError(list, e); }
}

function viewLogin() {
  const err = h('div');
  const setup = !state.hasUsers;
  const user = h('input', { type: 'text', autocomplete: 'username', required: true, autofocus: true });
  const pass = h('input', { type: 'password', autocomplete: setup ? 'new-password' : 'current-password', required: true, minlength: setup ? 8 : 1 });
  const form = h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault();
    err.replaceChildren();
    try {
      await api(setup ? '/auth/register' : '/auth/login', { method: 'POST', body: { username: user.value.trim(), password: pass.value } });
      await boot();
    } catch (ex) { showError(err, ex); }
  } },
    h('label', {}, 'Usuario'), user,
    h('label', {}, 'Contraseña'), pass,
    setup && h('p', { class: 'muted' }, 'Primer uso: esta cuenta será tu usuario local (mínimo 8 caracteres).'),
    err,
    h('button', { class: 'btn', type: 'submit' }, setup ? 'Crear cuenta e iniciar sesión' : 'Iniciar sesión'));
  app.replaceChildren(h('div', { class: 'login' }, h('h1', {}, '⚕ Farmacopea Local'), form,
    h('p', { class: 'disclaimer' }, 'Cuenta local: tus credenciales se guardan solo en esta máquina (hash scrypt). Datos de openFDA.')));
}

async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  state.user = null;
  state.interactionIds = [];
  await boot();
}

// ---------- router ----------
function route() {
  if (!state.user) return viewLogin();
  const [, page, arg] = (location.hash || '#/').split('/');
  if (page === 'medicamento' && /^\d+$/.test(arg)) return viewDrug(arg);
  if (page === 'indice') return viewIndex(/^[A-Za-z]$/.test(arg || '') ? arg.toUpperCase() : '');
  if (page === 'interacciones') return viewInteractions();
  if (page === 'favoritos') return viewFavorites();
  return viewHome();
}

async function boot() {
  if (STATIC && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  const s = await api('/auth/status');
  state.user = s.user;
  state.hasUsers = s.hasUsers;
  route();
}

window.addEventListener('hashchange', route);
boot();
