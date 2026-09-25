// The layer control: force switch, presets, emphasis, per-system switches.
// Defaults on first load: nothing is on. An operator's first act is to say what
// they want to see.

import { state, emit, on, esc, num, setHtml, store, cls } from './state.js';
import { symbolSvg, typeFor, legend as symbolLegend } from './symbols.js';
import { setBasemap, applyHillshade, setGraticule, syncMap, BASEMAPS } from './map.js';

export const CATEGORIES = [
  'Fires', 'Strategic missile forces', 'Air defence', 'Electronic warfare',
  'Air bases', 'Coastal', 'Armour', 'Mechanised', 'Aviation',
];
const RINGED = new Set(['Fires', 'Strategic missile forces', 'Air defence', 'Electronic warfare', 'Air bases', 'Coastal', 'Aviation']);
const LOG_LAYERS = [
  ['depots', 'Depots'], ['routes', 'Routes'], ['formations', 'Formations'],
  ['serials', 'Serials'], ['reserves', 'Reserves'],
];
const OLOG_LAYERS = [['depots', 'Depots and ports'], ['routes', 'Routes'], ['formations', 'Formations']];
export const EMPHASES = [['systems', 'Systems'], ['supply', 'Supply'], ['flow', 'Flow'], ['reserves', 'Reserves']];

export function blank() {
  return {
    force: 'own', emphasis: null, collapsed: true,
    sys: {}, ring: {}, osys: {}, oring: {},
    log: { depots: false, routes: false, formations: false, serials: false, reserves: false },
    olog: { depots: false, routes: false, formations: false },
    oppMaster: true, basemap: 'imagery', hillshade: true,
    graticule: false, ringLabels: true,
  };
}

/* --- presets -------------------------------------------------------------
   A preset sets, in one click: which systems are on, which show their ring,
   which logistics layers are on, and the emphasis. */
export const PRESETS = {
  Default:       { cats: ['Fires', 'Air defence', 'Electronic warfare', 'Armour', 'Coastal', 'Air bases'], rings: ['Fires', 'Air defence'], log: ['depots', 'routes', 'formations'], emphasis: null },
  'Air defence': { cats: ['Air defence'], rings: ['Air defence'], log: ['depots'], emphasis: 'systems' },
  'Missile forces': { cats: ['Strategic missile forces', 'Fires'], rings: ['Strategic missile forces', 'Fires'], log: [], emphasis: 'systems' },
  'Non-contact': { cats: ['Fires', 'Strategic missile forces', 'Air defence', 'Electronic warfare'], rings: ['Fires', 'Strategic missile forces', 'Air defence', 'Electronic warfare'], log: [], emphasis: 'systems' },
  'Air bases':   { cats: ['Air bases'], rings: ['Air bases'], log: ['depots'], emphasis: 'systems' },
  Fires:         { cats: ['Fires'], rings: ['Fires'], log: [], emphasis: 'systems' },
  Armour:        { cats: ['Armour', 'Mechanised'], rings: [], log: ['formations', 'routes'], emphasis: 'systems' },
  Logistics:     { cats: [], rings: [], log: ['depots', 'routes', 'formations', 'serials'], emphasis: 'supply' },
  Flow:          { cats: [], rings: [], log: ['depots', 'routes', 'serials'], emphasis: 'flow' },
  Reserves:      { cats: [], rings: [], log: ['depots', 'reserves', 'routes'], emphasis: 'reserves' },
  Clear:         { cats: [], rings: [], log: [], emphasis: null },
};

export function initLayers() {
  if (!state.layers) state.layers = blank();
  const el = document.getElementById('layers');
  el.addEventListener('scroll', () => { el.__scroll = el.querySelector('.layers-body')?.scrollTop; }, true);
  setBasemap(state.layers.basemap);
  setGraticule(state.layers.graticule);
  render();
}

export function applyPreset(name) {
  const p = PRESETS[name];
  if (!p || !state.data) return;
  const L = state.layers;
  const force = L.force;
  const own = force === 'own' || force === 'both';
  const opp = force === 'opp' || force === 'both';

  if (own) {
    L.sys = {}; L.ring = {};
    for (const a of state.data.assets) {
      if (p.cats.includes(a.category)) L.sys[a.id] = true;
      if (p.rings.includes(a.category)) L.ring[a.id] = true;
    }
    for (const [k] of LOG_LAYERS) L.log[k] = p.log.includes(k);
  }
  if (opp) {
    L.osys = {}; L.oring = {};
    const oppCats = p.cats.length ? p.cats : ['Fires', 'Air defence', 'Electronic warfare', 'Armour', 'Air bases'];
    for (const a of state.data.opposing.assets) {
      if (oppCats.includes(a.category)) L.osys[a.id] = true;
      if (p.rings.includes(a.category)) L.oring[a.id] = true;
    }
    for (const [k] of OLOG_LAYERS) L.olog[k] = p.log.includes(k);
  }
  L.emphasis = p.emphasis;
  L.preset = name;
  changed();
}

export function setForce(force) {
  const L = state.layers;
  L.force = force;
  // Nothing on and switching to own: bring the Default preset up so the screen
  // is not blank after a deliberate act.
  const anyOn = Object.values(L.sys).some(Boolean) || Object.values(L.log).some(Boolean);
  if (force === 'own' && !anyOn) applyPreset('Default');
  else if ((force === 'opp' || force === 'both') && !Object.values(L.osys).some(Boolean)) applyPreset(L.preset || 'Default');
  else changed();
  emit('force', force);
}

export function setEmphasis(e) {
  state.layers.emphasis = state.layers.emphasis === e ? null : e;
  changed();
}

function changed() { render(); syncMap(); emit('layers-changed'); }

/* --- render --------------------------------------------------------------
   Re-render preserves the panel's scroll position and re-applies indeterminate
   after each paint (checkbox indeterminate is a property, not an attribute). */
export function render() {
  const host = document.getElementById('layers');
  if (!host || !state.data) return;
  const L = state.layers;
  const body = host.querySelector('.layers-body');
  const scroll = body ? body.scrollTop : 0;

  const shown = Object.values(L.sys).filter(Boolean).length + Object.values(L.osys).filter(Boolean).length;
  const own = L.force === 'own' || L.force === 'both';
  const opp = L.force === 'opp' || L.force === 'both';

  const html =
    `<div class="layers-h">
      <b>Layers</b><span class="sub">${shown} system${shown === 1 ? '' : 's'} shown</span>
      <button class="btn-sm quiet" data-layers-collapse title="Show or hide the panel (L)">${L.collapsed ? 'Show' : 'Hide'}</button>
    </div>` +
    (L.collapsed ? '' : `<div class="layers-body">
      <div class="layers-sec">
        <span class="lbl">Force</span>
        <div class="seg-group" role="radiogroup" aria-label="Force">
          <button class="seg ${L.force === 'own' ? 'is-on' : ''}" data-force="own" aria-pressed="${L.force === 'own'}">Own forces</button>
          <button class="seg ${L.force === 'opp' ? 'is-on hostile' : ''}" data-force="opp" aria-pressed="${L.force === 'opp'}">Opposing</button>
          <button class="seg ${L.force === 'both' ? 'is-on hostile' : ''}" data-force="both" aria-pressed="${L.force === 'both'}">Both</button>
        </div>
      </div>
      <div class="layers-sec">
        <span class="lbl">Presets</span>
        <div class="chip-row">${Object.keys(PRESETS).map(p =>
          `<button class="chip ${L.preset === p ? 'is-on' : ''}" data-preset="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      </div>
      <div class="layers-sec">
        <span class="lbl">Emphasis</span>
        <div class="chip-row">${EMPHASES.map(([k, n]) =>
          `<button class="chip ${L.emphasis === k ? 'is-on' : ''}" data-emphasis="${k}">${esc(n)}</button>`).join('')}</div>
      </div>` +
      (own ? ownTree(L) : '') +
      (opp ? oppTree(L) : '') +
      chartSection(L) +
    `</div>`);

  if (setHtml(host, html)) {
    const nb = host.querySelector('.layers-body');
    if (nb) nb.scrollTop = scroll;
  }
  applyIndeterminate();
}

function ownTree(L) {
  const assets = state.data.assets;
  const byCat = new Map();
  for (const a of assets) {
    if (!byCat.has(a.category)) byCat.set(a.category, []);
    byCat.get(a.category).push(a);
  }
  let out = `<div class="layers-sec"><span class="lbl">Own forces</span>`;
  for (const cat of CATEGORIES) {
    const list = byCat.get(cat) || [];
    if (!list.length) continue;
    const on_ = list.filter(a => L.sys[a.id]).length;
    const open = L.open?.[cat];
    const ringOn = list.some(a => L.ring[a.id]);
    out += `<div class="cat">
      <div class="cat-h" role="group">
        <input type="checkbox" data-cat="${esc(cat)}" ${on_ === list.length ? 'checked' : ''}
          data-partial="${on_ > 0 && on_ < list.length}" aria-label="${esc(cat)}">
        <span class="gl">${symbolSvg(typeFor({ category: cat, type: '' }), 'friendly', 13)}</span>
        <button class="cat-h" style="padding:0;border:0;background:none;flex:1 1 auto;text-align:left"
          data-cat-toggle="${esc(cat)}" aria-expanded="${!!open}">
          ${esc(cat)}<span class="cnt">${on_}/${list.length}</span><span class="caret">▶</span>
        </button>
        ${RINGED.has(cat) ? `<button class="ring-btn ${ringOn ? 'is-on' : ''}" data-ring-cat="${esc(cat)}" title="Reach rings for the whole category">◎</button>` : ''}
      </div>` +
      (open ? list.map(a => `<div class="sys-item">
          <input type="checkbox" data-sys="${esc(a.id)}" ${L.sys[a.id] ? 'checked' : ''} aria-label="${esc(a.name)}">
          <span class="nm" data-select="asset:${esc(a.id)}">${esc(a.name)}</span>
          <span class="rk">${a.rangeKm ? num(a.rangeKm) + ' km' : '—'}</span>
          ${a.rangeKm >= 10 ? `<button class="ring-btn ${L.ring[a.id] ? 'is-on' : ''}" data-ring="${esc(a.id)}" title="Reach ring">◎</button>` : ''}
        </div>`).join('') : '') +
    `</div>`;
  }
  out += `</div><div class="layers-sec"><span class="lbl">Logistics</span>` +
    LOG_LAYERS.map(([k, n]) => `<div class="sys-item" style="padding-left:0">
      <input type="checkbox" data-log="${k}" ${L.log[k] ? 'checked' : ''} aria-label="${esc(n)}">
      <span class="nm">${esc(n)}</span></div>`).join('') + `</div>`;
  return out;
}

function oppTree(L) {
  const o = state.data.opposing;
  const byCat = new Map();
  for (const a of o.assets) {
    if (!byCat.has(a.category)) byCat.set(a.category, []);
    byCat.get(a.category).push(a);
  }
  let out = `<div class="layers-sec opp-tree">
    <div class="sys-item" style="padding-left:0">
      <input type="checkbox" data-opp-master ${L.oppMaster ? 'checked' : ''} aria-label="Opposing forces">
      <span class="lbl" style="flex:1 1 auto">Opposing forces</span>
      <span class="rk">assessed · ${esc(o.meta.confidence)}</span>
    </div>
    <div class="${L.oppMaster ? '' : 'is-off'}">`;
  for (const cat of CATEGORIES) {
    const list = byCat.get(cat) || [];
    if (!list.length) continue;
    const on_ = list.filter(a => L.osys[a.id]).length;
    const open = L.oopen?.[cat];
    const ringOn = list.some(a => L.oring[a.id]);
    out += `<div class="cat">
      <div class="cat-h">
        <input type="checkbox" data-ocat="${esc(cat)}" ${on_ === list.length ? 'checked' : ''}
          data-partial="${on_ > 0 && on_ < list.length}" aria-label="${esc(cat)} (assessed)">
        <span class="gl">${symbolSvg(typeFor({ category: cat, type: '' }), 'hostile', 13)}</span>
        <button style="padding:0;border:0;background:none;flex:1 1 auto;text-align:left;color:inherit;cursor:pointer"
          data-ocat-toggle="${esc(cat)}" aria-expanded="${!!open}">
          ${esc(cat)}<span class="cnt">${on_}/${list.length}</span><span class="caret">▶</span>
        </button>
        ${RINGED.has(cat) ? `<button class="ring-btn hostile ${ringOn ? 'is-on' : ''}" data-oring-cat="${esc(cat)}">◎</button>` : ''}
      </div>` +
      (open ? list.map(a => `<div class="sys-item">
        <input type="checkbox" data-osys="${esc(a.id)}" ${L.osys[a.id] ? 'checked' : ''} aria-label="${esc(a.name)}">
        <span class="nm" data-select="oasset:${esc(a.id)}">${esc(a.name.replace(/\s*\(assessed\)/, ''))}</span>
        <span class="rk">${a.rangeKm ? num(a.rangeKm) + ' km' : '—'}</span>
        ${a.rangeKm >= 10 ? `<button class="ring-btn hostile ${L.oring[a.id] ? 'is-on' : ''}" data-oring="${esc(a.id)}">◎</button>` : ''}
      </div>`).join('') : '') + `</div>`;
  }
  out += `<span class="lbl" style="display:block;margin:8px 0 4px">Assessed logistics</span>` +
    OLOG_LAYERS.map(([k, n]) => `<div class="sys-item" style="padding-left:0">
      <input type="checkbox" data-olog="${k}" ${L.olog[k] ? 'checked' : ''} aria-label="${esc(n)}">
      <span class="nm">${esc(n)}</span></div>`).join('');
  return out + `</div></div>`;
}

function chartSection(L) {
  const theme = document.documentElement.dataset.theme === 'light';
  const id = document.getElementById('map')?.dataset.basemap || 'imagery';
  return `<div class="layers-sec">
    <span class="lbl">Chart</span>
    <div class="chip-row">${Object.entries(BASEMAPS).map(([k, b]) =>
      `<button class="chip ${id === k ? 'is-on' : ''}" data-basemap="${k}">${esc(b.name)}</button>`).join('')}</div>
    <div style="margin-top:7px">
      ${(id === 'dark' || id === 'light') ? `<div class="sys-item" style="padding-left:0">
        <input type="checkbox" data-hillshade ${L.hillshade ? 'checked' : ''} aria-label="Relief shading">
        <span class="nm">Relief shading</span></div>` : ''}
      <div class="sys-item" style="padding-left:0">
        <input type="checkbox" data-graticule ${L.graticule ? 'checked' : ''} aria-label="Graticule">
        <span class="nm">Graticule</span></div>
      <div class="sys-item" style="padding-left:0">
        <input type="checkbox" data-ring-labels ${L.ringLabels !== false ? 'checked' : ''} aria-label="Range labels">
        <span class="nm">Range labels</span></div>
      <div class="chip-row" style="margin-top:7px">
        <button class="chip" data-lang-toggle>${document.body.classList.contains('lang-ur') ? 'English' : 'اردو'}</button>
        <button class="chip" data-theme-toggle>${theme ? 'Dark room' : 'Daylight room'}</button>
      </div>
    </div>
  </div>`;
}

// indeterminate is a property, not an attribute — it must be set after each paint.
function applyIndeterminate() {
  for (const cb of document.querySelectorAll('#layers input[data-partial]')) {
    cb.indeterminate = cb.dataset.partial === 'true';
  }
}

/* --- the click contract -------------------------------------------------- */
export function handleLayersClick(t) {
  const L = state.layers;
  if (!L || !state.data) return false;
  const d = state.data;

  if (t.closest('[data-layers-collapse]')) { L.collapsed = !L.collapsed; render(); return true; }
  const preset = t.closest('[data-preset]'); if (preset) { applyPreset(preset.dataset.preset); return true; }
  const emph = t.closest('[data-emphasis]'); if (emph) { setEmphasis(emph.dataset.emphasis); return true; }
  const force = t.closest('[data-force]'); if (force) { setForce(force.dataset.force); return true; }

  const catT = t.closest('[data-cat-toggle]');
  if (catT) { L.open = L.open || {}; L.open[catT.dataset.catToggle] = !L.open[catT.dataset.catToggle]; render(); return true; }
  const ocatT = t.closest('[data-ocat-toggle]');
  if (ocatT) { L.oopen = L.oopen || {}; L.oopen[ocatT.dataset.ocatToggle] = !L.oopen[ocatT.dataset.ocatToggle]; render(); return true; }

  const cat = t.closest('[data-cat]');
  if (cat) {
    const list = d.assets.filter(a => a.category === cat.dataset.cat);
    const turnOn = list.some(a => !L.sys[a.id]);
    for (const a of list) L.sys[a.id] = turnOn;
    changed(); return true;
  }
  const ocat = t.closest('[data-ocat]');
  if (ocat) {
    const list = d.opposing.assets.filter(a => a.category === ocat.dataset.ocat);
    const turnOn = list.some(a => !L.osys[a.id]);
    for (const a of list) L.osys[a.id] = turnOn;
    changed(); return true;
  }
  const ringCat = t.closest('[data-ring-cat]');
  if (ringCat) {
    const list = d.assets.filter(a => a.category === ringCat.dataset.ringCat && a.rangeKm >= 10);
    const turnOn = list.some(a => !L.ring[a.id]);
    for (const a of list) { L.ring[a.id] = turnOn; if (turnOn) L.sys[a.id] = true; }
    changed(); return true;
  }
  const oringCat = t.closest('[data-oring-cat]');
  if (oringCat) {
    const list = d.opposing.assets.filter(a => a.category === oringCat.dataset.oringCat && a.rangeKm >= 10);
    const turnOn = list.some(a => !L.oring[a.id]);
    for (const a of list) { L.oring[a.id] = turnOn; if (turnOn) L.osys[a.id] = true; }
    changed(); return true;
  }

  const sys = t.closest('[data-sys]'); if (sys) { L.sys[sys.dataset.sys] = !L.sys[sys.dataset.sys]; changed(); return true; }
  const osys = t.closest('[data-osys]'); if (osys) { L.osys[osys.dataset.osys] = !L.osys[osys.dataset.osys]; changed(); return true; }
  const ring = t.closest('[data-ring]');
  if (ring) { const id = ring.dataset.ring; L.ring[id] = !L.ring[id]; if (L.ring[id]) L.sys[id] = true; changed(); return true; }
  const oring = t.closest('[data-oring]');
  if (oring) { const id = oring.dataset.oring; L.oring[id] = !L.oring[id]; if (L.oring[id]) L.osys[id] = true; changed(); return true; }

  const log = t.closest('[data-log]'); if (log) { L.log[log.dataset.log] = !L.log[log.dataset.log]; changed(); return true; }
  const olog = t.closest('[data-olog]'); if (olog) { L.olog[olog.dataset.olog] = !L.olog[olog.dataset.olog]; changed(); return true; }
  if (t.closest('[data-opp-master]')) { L.oppMaster = !L.oppMaster; changed(); return true; }

  const bm = t.closest('[data-basemap]');
  if (bm) { L.basemap = bm.dataset.basemap; setBasemap(L.basemap); render(); return true; }
  if (t.closest('[data-hillshade]')) { L.hillshade = !L.hillshade; applyHillshade(); render(); return true; }
  if (t.closest('[data-graticule]')) { L.graticule = !L.graticule; setGraticule(L.graticule); render(); return true; }
  if (t.closest('[data-ring-labels]')) { L.ringLabels = L.ringLabels === false; changed(); return true; }
  return false;
}

/* --- 7.4 The legend, generated from what is actually on the map ---------- */
export function renderLegend() {
  const host = document.getElementById('legend');
  if (!host || !state.data) return;
  const L = state.layers;
  const rows = [];
  const sym = symbolLegend();
  const seen = new Set();

  const addAsset = (a, opp) => {
    const t = typeFor(a);
    const k = `${opp ? 'o' : ''}${t}`;
    if (seen.has(k)) return;
    seen.add(k);
    rows.push({ svg: symbolSvg(t, opp ? 'hostile' : 'friendly', 14), name: a.category + (opp ? ' (assessed)' : '') });
  };
  for (const a of state.data.assets) if (L.sys[a.id]) addAsset(a, false);
  for (const a of state.data.opposing.assets) if (L.osys[a.id] && L.oppMaster) addAsset(a, true);

  // Rings: if no air-defence ring is on, the air-defence row does not exist.
  const ringCats = new Set();
  for (const a of state.data.assets) if (L.ring[a.id]) ringCats.add(a.category);
  for (const c of ringCats) {
    const r = sym.rings.find(x => x.name === c) || { id: 'cov-other' };
    rows.push({ swatch: `<svg width="14" height="14"><circle cx="7" cy="7" r="5.5" fill="none" class="${r.id}" stroke="var(--${r.id})" stroke-width="1.4"/></svg>`, name: `${c} reach` });
  }
  if (Object.values(L.oring).some(Boolean) && L.oppMaster)
    rows.push({ swatch: `<svg width="14" height="14"><circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--hostile)" stroke-width="1.2" stroke-dasharray="3 2"/></svg>`, name: 'Assessed reach' });

  if (L.log.depots) rows.push({ svg: symbolSvg('depot', 'friendly', 14), name: 'Depots' });
  if (L.log.formations) rows.push({ svg: symbolSvg('infantry', 'friendly', 14), name: 'Formations' });
  if (L.log.routes) {
    const classes = new Set(state.data.routes.map(r => r.cls));
    for (const c of classes) {
      const r = sym.routes.find(x => x.id === c);
      rows.push({ swatch: `<svg width="14" height="14"><line x1="0" y1="7" x2="14" y2="7" stroke="var(--ok)" stroke-width="2" stroke-dasharray="${r?.dash || ''}"/></svg>`, name: r?.name || c, rk: c });
    }
  }
  if (L.log.serials) rows.push({ swatch: `<svg width="14" height="14"><path d="M7 1 L13 7 L7 13 L1 7 Z" fill="var(--accent)"/></svg>`, name: 'Serials in motion' });
  if (L.log.reserves) rows.push({ swatch: `<svg width="14" height="14"><rect x="2" y="2" width="10" height="10" rx="2" fill="none" stroke="var(--accent)" stroke-width="1.5"/></svg>`, name: 'Reserves' });

  const open = store('legend') === 'open';
  const html = `<button class="legend-h" data-legend-toggle aria-expanded="${open}">
      <b>Legend · ${rows.length}</b><span class="dim">${open ? '−' : '+'}</span>
    </button>
    <div class="legend-body">${rows.length
      ? rows.map(r => `<div class="leg-row"><span class="sw">${r.svg || r.swatch}</span>${esc(r.name)}${r.rk ? `<span class="rk">${esc(r.rk)}</span>` : ''}</div>`).join('')
      : `<div class="leg-row dim">Nothing is on the map.</div>`}</div>`;
  setHtml(host, html);
  host.classList.toggle('is-open', open);
  host.hidden = rows.length === 0 && !open;
}
