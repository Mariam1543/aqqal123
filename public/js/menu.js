// The right-click menu.
import { state, emit, on, esc, grid, byId, isOpp } from './state.js';

let el = null;

export function initMenu() {
  el = document.getElementById('cmenu');
  on('menu', open);
  document.addEventListener('pointerdown', e => { if (el && !el.hidden && !el.contains(e.target)) close(); });
  window.addEventListener('resize', close);
  on('map-click', close);
}

export function close() { if (el) { el.hidden = true; el.__html = null; } }

function open({ kind, id, latlng, point }) {
  if (!el) return;
  const o = kind ? byId(kind, id) : null;
  const opp = kind ? isOpp(kind) : false;
  const g = grid(latlng.lat, latlng.lng);

  const items = o ? [
    ['Select', `data-select="${esc(kind)}:${esc(id)}"`],
    ['Focus on the map', `data-focus-target="${esc(kind)}:${esc(id)}"`],
    opp && (kind === 'oasset' || kind === 'onode')
      ? ['Strike option', `data-strike="${esc(kind)}:${esc(id)}"`, 'hostile']
      : ['Plan an objective here', `data-menu-plan="${latlng.lat},${latlng.lng}"`],
    o.rangeKm >= 10 ? [`Draw reach — ${o.rangeKm} km`, opp ? `data-oring="${esc(id)}"` : `data-ring="${esc(id)}"`] : null,
    ['Range from here', `data-menu-range="${latlng.lat},${latlng.lng}"`],
    ['Measure from here', `data-menu-measure="${latlng.lat},${latlng.lng}"`],
    ['Ask the agent about this', `data-ask-about="${esc(kind)}:${esc(id)}"`],
    ['Copy grid', `data-copy-grid="${esc(g)}"`],
  ] : [
    ['Plan an objective here', `data-menu-plan="${latlng.lat},${latlng.lng}"`],
    ['Range from here', `data-menu-range="${latlng.lat},${latlng.lng}"`],
    ['Measure from here', `data-menu-measure="${latlng.lat},${latlng.lng}"`],
    ['Ask the agent what reaches here', `data-ask="What reaches ${esc(g)}?"`],
    ['Copy grid', `data-copy-grid="${esc(g)}"`],
  ];

  el.innerHTML = (o ? `<div class="cmenu-h"><b>${esc((o.name || o.serial || '').replace(/\s*\(assessed\)/, ''))}</b>
      <div class="m"><span class="pill ${opp ? 'st-HOSTILE' : 'st-' + (o.status || 'GREEN')}">${esc(opp ? 'Assessed' : o.status || '')}</span>
      <span>${esc(kind.replace(/^o/, ''))}</span><span>${esc(g)}</span>
      ${o.confidence ? `<span>${esc(o.confidence)}</span>` : ''}</div></div>`
    : `<div class="cmenu-h"><b>${esc(g)}</b><div class="m"><span>${latlng.lat.toFixed(4)}°N ${latlng.lng.toFixed(4)}°E</span></div></div>`) +
    items.filter(Boolean).map(([label, attr, klass]) =>
      `<button role="menuitem" ${attr} class="${klass || ''}">${esc(label)}</button>`).join('');

  el.hidden = false;
  // position inside the viewport
  const r = el.getBoundingClientRect();
  const x = Math.min(point[0], window.innerWidth - r.width - 8);
  const y = Math.min(point[1], window.innerHeight - r.height - 8);
  el.style.left = Math.max(8, x) + 'px';
  el.style.top = Math.max(8, y) + 'px';
  el.querySelector('button')?.focus();

  el.onkeydown = e => {
    const btns = [...el.querySelectorAll('button')];
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
}
