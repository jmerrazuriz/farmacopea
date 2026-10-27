// Iconos minimalistas (trazo de 1 color, heredan el color del texto). Sin emojis ni imagenes externas.
const NS = 'http://www.w3.org/2000/svg';

// Cada icono es una lista de elementos SVG sobre una rejilla de 24x24
const PATHS = {
  search: [['circle', { cx: 11, cy: 11, r: 6.5 }], ['path', { d: 'm20 20-4.2-4.2' }]],
  list: [['path', { d: 'M4 6h16M4 12h11M4 18h7' }]],
  alert: [['path', { d: 'M12 4 2.8 19.5h18.4L12 4z' }], ['path', { d: 'M12 10v4.2M12 17.2v.1' }]],
  star: [['path', { d: 'm12 3.8 2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8L12 3.8z' }]],
  'star-fill': [['path', { d: 'm12 3.8 2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8L12 3.8z', fill: 'currentColor' }]],
  translate: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M3.5 12h17M12 3.5c2.4 2.3 3.6 5.2 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.2-3.6-8.5s1.2-6.2 3.6-8.5z' }]],
  printer: [['path', { d: 'M7 9V4h10v5M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2' }], ['rect', { x: 7, y: 14, width: 10, height: 6, rx: 1 }]],
  undo: [['path', { d: 'M9 8 4.5 12.5 9 17' }], ['path', { d: 'M5 12.5h9.5a4.5 4.5 0 0 1 0 9' }]],
  check: [['path', { d: 'm5 12.5 4.2 4.2L19 7' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  pill: [['rect', { x: 2.5, y: 8.5, width: 19, height: 7, rx: 3.5, transform: 'rotate(-40 12 12)' }], ['path', { d: 'm9.6 7.4 7 9.2', transform: 'rotate(0 12 12)' }]],
};

export function icon(name, { size = 18, cls = '' } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon${cls ? ` ${cls}` : ''}`);
  for (const [tag, attrs] of PATHS[name] || []) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}
