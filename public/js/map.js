// The Leaflet picture: basemaps, markers, rings, routes, declutter.

import {
  state, emit, on, esc, days, num, pct, dtg, grid, distKm, byId, isOpp,
  classShort, className, statusOfRoute, debounce, cls, st as stCls,
} from './state.js';
import { assetSymbol, symbolSvg, typeFor } from './symbols.js';

export let map = null;
const G = {};                 // layer groups
const markers = new Map();    // key -> { marker, _key }
const rings = new Map();
const routeLines = new Map();
let baseLayer = null, labelLayer = null, hillLayer = null, graticule = null;
let hover = null;

const PAINT_ORDER = [
  'orings', 'rings', 'oroutes', 'routes', 'arcs', 'omoves', 'moves',
  'onodes', 'nodes', 'reserves', 'opositions', 'positions',
  'ounits', 'units', 'oassets', 'assets', 'convoys',
];

const Z = {
  asset: 700, oasset: 690, position: 650, oposition: 640, convoy: 600,
  unit: 400, ounit: 390, reserve: 300, node: 200, onode: 190, ringLabel: 100,
};

/* --- 9.2 Basemaps -------------------------------------------------------- */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
export const BASEMAPS = {
  imagery: { name: 'Imagery', base: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 18 },
  dark: { name: 'Dark canvas', base: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 16 },
  light: { name: 'Light canvas', base: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 16 },
  terrain: { name: 'Relief', base: `${ESRI}/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 13 },
};
const HILLSHADE = `${ESRI}/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}`;

// Failed base tiles paint the ground colour. The chart still reads with no network.
const GROUND = c => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${c}"/></svg>`)}`;
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function initMap() {
  map = L.map('map', { zoomControl: false, preferCanvas: false, worldCopyJump: false });
  map.setView(state.data?.meta?.centre || [32.4, 72.6], 6);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('Esri');

  for (const g of PAINT_ORDER) { G[g] = L.layerGroup(); }
  G.agent = L.layerGroup().addTo(map);
  G.decide = L.layerGroup().addTo(map);
  G.tools = L.layerGroup().addTo(map);
  G.missions = L.layerGroup().addTo(map);
  G.grat = L.layerGroup();

  setBasemap(state.layers?.basemap || 'imagery');
  bindMapEvents();
  return map;
}

export function groups() { return G; }

export function setBasemap(id) {
  const b = BASEMAPS[id] || BASEMAPS.imagery;
  const dark = document.documentElement.dataset.theme !== 'light';
  if (baseLayer) map.removeLayer(baseLayer);
  if (labelLayer) map.removeLayer(labelLayer);
  baseLayer = L.tileLayer(b.base, {
    maxNativeZoom: b.maxNativeZoom, maxZoom: 19, className: 'base-tiles',
    errorTileUrl: GROUND(dark ? '#1a1e26' : '#e4e7eb'), keepBuffer: 3,
  }).addTo(map);
  labelLayer = L.tileLayer(b.labels, {
    maxNativeZoom: Math.min(9, b.maxNativeZoom), maxZoom: 19, className: 'base-labels',
    pane: 'shadowPane', errorTileUrl: BLANK, opacity: 0.5,
  }).addTo(map);
  // While a new zoom's label tiles load the layer fades out and back, so a slow
  // tile server can never leave the previous zoom's names scaled across the screen.
  labelLayer.on('loading', () => labelLayer.getContainer()?.classList.add('loading'));
  labelLayer.on('load', () => labelLayer.getContainer()?.classList.remove('loading'));
  document.getElementById('map').dataset.basemap = id;
  applyHillshade();
}

export function applyHillshade() {
  const id = document.getElementById('map').dataset.basemap;
  const want = (state.layers?.hillshade ?? true) && (id === 'dark' || id === 'light');
  if (hillLayer) { map.removeLayer(hillLayer); hillLayer = null; }
  if (want) hillLayer = L.tileLayer(HILLSHADE, { maxNativeZoom: 15, maxZoom: 19, className: 'base-hill', pane: 'shadowPane', errorTileUrl: BLANK }).addTo(map);
}

/* --- 9.3 Graticule ------------------------------------------------------- */
export function setGraticule(on_) {
  G.grat.clearLayers();
  if (!on_) { map.removeLayer(G.grat); return; }
  G.grat.addTo(map);
  for (let lat = 20; lat <= 40; lat++)
    G.grat.addLayer(L.polyline([[lat, 55], [lat, 85]], { color: '#5a6675', weight: 0.6, opacity: 0.35, interactive: false }));
  for (let lng = 55; lng <= 85; lng++)
    G.grat.addLayer(L.polyline([[20, lng], [40, lng]], { color: '#5a6675', weight: 0.6, opacity: 0.35, interactive: false }));
  for (let lat = 20; lat <= 40; lat += 2)
    for (let lng = 56; lng <= 84; lng += 4)
      G.grat.addLayer(L.marker([lat, lng], {
        interactive: false,
        icon: L.divIcon({ className: 'grat-lbl', html: `${lat}°N ${lng}°E`, iconSize: [58, 12] }),
      }));
}

/* --- events -------------------------------------------------------------- */
function bindMapEvents() {
  const coords = document.getElementById('coords');
  map.on('mousemove', e => {
    const { lat, lng } = e.latlng;
    coords.textContent = `${grid(lat, lng)}   ${lat.toFixed(4)}°N ${lng.toFixed(4)}°E`;
  });
  map.on('mouseout', () => { coords.textContent = ''; });
  map.on('zoomend', () => { setZoomBand(); scheduleCollide(); });
  map.on('moveend', scheduleCollide);
  map.on('click', () => emit('map-click'));
  map.on('contextmenu', e => {
    L.DomEvent.preventDefault(e.originalEvent ?? e);
    emit('menu', { kind: null, id: null, latlng: e.latlng, point: [e.originalEvent.clientX, e.originalEvent.clientY] });
  });
  window.addEventListener('resize', scheduleCollide);
  setZoomBand();
}

// 9.7 Declutter by zoom band, before the collision pass.
function setZoomBand() {
  const z = map.getZoom();
  document.getElementById('map').dataset.zoom = z < 6 ? 'far' : z < 8 ? 'mid' : 'near';
}

// 17.7 invalidateSize is debounced and called after any layout change: a pane
// resizing must never slide the picture.
export const invalidate = debounce(() => map && map.invalidateSize({ pan: false }), 40);

/* --- 9.4 Markers ---------------------------------------------------------
   Diffed by key, never recreated. Recreating a Leaflet marker every 3 s loses
   hover, tooltips and selection, and leaks. */

// The label sits to the right, or to the left when the marker carries .left —
// assigned by longitude plus a short exception list.
const LEFT_EXCEPTIONS = new Set(['n-kar', 'n-qta', 'a-cst', 'n-pes']);
function sideOf(o, opp) {
  if (LEFT_EXCEPTIONS.has(o.id)) return true;
  return o.lng > (opp ? 79 : 73.5);
}

function icon(kind, o, opts = {}) {
  const opp = isOpp(kind) || opts.opp;
  const side = opp ? 'opp' : 'own';
  const status = opp ? 'HOSTILE' : (o.status || 'GREEN');
  const selected = state.selected && state.selected.kind === kind && state.selected.id === o.id;
  const hovering = hover && hover.kind === kind && hover.id === o.id;
  const dim = !!opts.dim;

  let inner = '', size = [18, 18], anchor = [9, 9];
  const k = kind.replace(/^o/, '');

  if (k === 'asset') {
    inner = assetSymbol(o, { side, size: 22 });
    size = [22, 22]; anchor = [11, 11];
  } else if (k === 'node') {
    const sz = o.echelon === 'theatre' ? 24 : o.echelon === 'corps' ? 22 : 20;
    inner = symbolSvg('depot', opp ? 'hostile' : 'friendly', sz);
    size = [sz, sz]; anchor = [sz / 2, sz / 2];
  } else if (k === 'unit') {
    inner = symbolSvg(typeFor(o), opp ? 'hostile' : 'friendly', 22, { echelon: o.echelon });
    size = [22, 29]; anchor = [11, 18];   // the anchor accounts for the echelon marks
  } else if (k === 'convoy') {
    const shape = { road: 'M6 0 L12 6 L6 12 L0 6 Z', rail: 'M0 0 H12 V12 H0 Z', air: 'M6 0 L12 12 H0 Z', sea: 'M6 0 A6 6 0 1 1 5.99 0 Z' }[o.mode] || 'M0 0 H12 V12 H0 Z';
    inner = `<svg class="sym cv" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="${shape}" fill="var(--st,var(--accent))" stroke="var(--sym-halo)" stroke-width="1"/></svg>`;
    size = [14, 14]; anchor = [7, 7];
  } else if (k === 'reserve') {
    inner = `<div class="rs"></div>`;
    size = [14, 14]; anchor = [7, 7];
  } else if (k === 'position') {
    inner = `<div class="pos-box"></div>`;
    size = [16, 16]; anchor = [8, 8];
  }

  const label = opts.label ?? (o.name || o.serial || '');
  const sub = opts.sub ?? '';
  const html =
    `<div class="${cls('mk', 'mk-' + k, stCls(status), opp && 'hostile',
      selected && 'is-selected', hovering && 'is-hover', dim && 'is-dim',
      sideOf(o, opp) && 'left')}">` +
      inner +
      (!opp && status !== 'GREEN' && (k === 'asset' || k === 'node') ? `<span class="st-pip"></span>` : '') +
      (selected ? `<span class="mk-sel-ring"></span>` : '') +
      (label ? `<span class="mk-lbl"><span class="n">${esc(label)}</span>${sub ? `<span class="mk-sub">${esc(sub)}</span>` : ''}${opts.chip || ''}</span>` : '') +
    `</div>`;

  return L.divIcon({ html, className: '', iconSize: size, iconAnchor: anchor });
}

// Each marker holds a _key of everything that affects its icon; setIcon is
// called only when the key changes.
function iconKey(kind, o, opts) {
  const sel = state.selected && state.selected.kind === kind && state.selected.id === o.id;
  const hov = hover && hover.kind === kind && hover.id === o.id;
  return [kind, o.id, o.status, o.name, o.echelon, o.mode, o.state, opts.dim ? 1 : 0,
    opts.label, opts.sub, opts.chip, sel ? 1 : 0, hov ? 1 : 0].join('|');
}

function upsert(group, kind, o, latlng, opts = {}) {
  const key = `${kind}:${o.id}`;
  const ik = iconKey(kind, o, opts);
  let entry = markers.get(key);
  if (!entry) {
    const m = L.marker(latlng, {
      icon: icon(kind, o, opts),
      zIndexOffset: Z[isOpp(kind) ? kind : kind] ?? 0,
      riseOnHover: true,
      keyboard: false,
    });
    // 17.6 Tooltips are functions, evaluated on open, so they read live data.
    m.bindTooltip(() => tooltip(kind, o.id), {
      className: cls('tt', isOpp(kind) && 'hostile'), direction: 'top',
      offset: [0, -(opts.tipOffset ?? 14)], opacity: 1,
    });
    m.on('click', L.DomEvent.stopPropagation);
    m.on('click', () => emit('select', { kind, id: o.id }));
    m.on('mouseover', () => setHover(kind, o.id));
    m.on('mouseout', () => setHover(null));
    m.on('contextmenu', e => {
      L.DomEvent.preventDefault(e.originalEvent ?? e);
      L.DomEvent.stopPropagation(e);
      emit('menu', { kind, id: o.id, latlng: e.latlng, point: [e.originalEvent.clientX, e.originalEvent.clientY] });
    });
    entry = { marker: m, _key: ik };
    markers.set(key, entry);
    group.addLayer(m);
  } else {
    if (entry._key !== ik) { entry.marker.setIcon(icon(kind, o, opts)); entry._key = ik; }
    const p = entry.marker.getLatLng();
    if (Math.abs(p.lat - latlng[0]) > 1e-7 || Math.abs(p.lng - latlng[1]) > 1e-7) entry.marker.setLatLng(latlng);
    if (!group.hasLayer(entry.marker)) group.addLayer(entry.marker);
  }
  entry.seen = true;
  return entry.marker;
}

/* --- 9.8 Hover cards ----------------------------------------------------- */
function tooltip(kind, id) {
  const o = byId(kind, id);
  if (!o) return '';
  const opp = isOpp(kind);
  const status = opp ? 'HOSTILE' : o.status || 'GREEN';
  const figs = [];
  const k = kind.replace(/^o/, '');

  if (k === 'asset') {
    if (!opp) figs.push(['Serviceable', `${o.serviceable}/${o.held}`, statusOfServ(o)]);
    else figs.push(['Assessed held', String(o.held), null]);
    if (o.rangeKm) figs.push(['Reach', `${num(o.rangeKm)} km`, null]);
    if (!opp && o.daysOfFire != null) figs.push(['Days of fire', days(o.daysOfFire), o.rounds?.[0]?.status]);
    if (!opp && o.ttpMin) figs.push(['Into action', `${o.ttpMin} min`, null]);
    if (opp) figs.push(['Confidence', o.confidence || '—', null]);
  } else if (k === 'node') {
    if (!opp) {
      figs.push(['Fill', pct(o.fill), o.status]);
      if (o.lowestClass) figs.push(['Lowest', classShort(o.lowestClass), o.lowestStatus]);
      figs.push(['Throughput', `${num(o.throughputPerDay)} t/d`, null]);
    } else figs.push(['Confidence', o.confidence || '—', null]);
  } else if (k === 'unit') {
    figs.push(['Strength', pct(o.strength), o.strengthStatus]);
    if (!opp) {
      figs.push(['Holds', `${days(o.sustainableDays)} d`, o.status]);
      if (o.limitingClass) figs.push(['Limiting', classShort(o.limitingClass), o.status]);
    }
  } else if (k === 'convoy') {
    figs.push(['Carrying', `${num(o.tonnes)} t`, null]);
    figs.push(['Class', classShort(o.cls), null]);
    figs.push(['Arrives in', `${days(o.etaHours)} h`, o.status]);
  } else if (k === 'reserve') {
    figs.push(['Quantity', num(o.qty), null]);
    figs.push(['State', o.state, o.status]);
    if (o.state === 'held') figs.push(['To effect', `${o.effectHours} h`, null]);
  }

  const descriptor = k === 'asset' ? (o.category || '')
    : k === 'node' ? `${o.echelon} depot`
    : k === 'unit' ? `${o.echelon} · ${o.type}`
    : k === 'convoy' ? `${o.mode} · ${o.routeName || ''}`
    : k === 'reserve' ? `war reserve · ${className(o.cls)}` : '';

  return `<div class="${stCls(status)}">` +
    `<b>${esc(o.name || o.serial)}</b>` +
    `<span class="pill">${esc(opp ? 'Assessed' : status)}</span>` +
    `<div class="tt-d">${esc(descriptor)}</div>` +
    (figs.length ? `<div class="tt-figs">${figs.map(([k2, v, s]) =>
      `<div class="${stCls(s)}"><span class="k">${esc(k2)}</span><span class="v">${esc(v)}</span></div>`).join('')}</div>` : '') +
    `<div class="tt-hint">click · select&nbsp;&nbsp;&nbsp;right-click · actions</div></div>`;
}
const statusOfServ = o => {
  const r = o.held ? o.serviceable / o.held : 0;
  return r >= 0.9 ? 'GREEN' : r >= 0.75 ? 'AMBER' : r >= 0.5 ? 'RED' : 'BLACK';
};

/* --- 15.3 hover ---------------------------------------------------------- */
export function setHover(kind, id) {
  const next = kind ? { kind, id } : null;
  if ((hover?.kind === next?.kind) && (hover?.id === next?.id)) return;
  hover = next;
  // A row under the pointer lights every marker belonging to that item —
  // all of a system's locations, its position and its ring.
  refreshIcons();
  focusRing(state.selected, hover);
}
function refreshIcons() {
  for (const [key, entry] of markers) {
    const [kind, id] = key.split(':');
    const o = byId(kind, id);
    if (!o) continue;
    const opts = entry.opts || {};
    const ik = iconKey(kind, o, opts);
    if (entry._key !== ik) { entry.marker.setIcon(icon(kind, o, opts)); entry._key = ik; }
  }
}

/* --- 9.5 Routes ---------------------------------------------------------- */
const ROUTE_COLOUR = { OPEN: '#3dbb7d', RESTRICTED: '#e6b647', CLOSED: '#e25a4c' };
const ROUTE_DASH = { MSR: '', ASR: '10 7', RAIL: '3 6', ALOC: '12 8', SLOC: '16 7', PIPE: '2 5' };

function drawRoute(group, r, opp) {
  const key = `${opp ? 'oroute' : 'route'}:${r.id}`;
  const emph = state.layers?.emphasis;
  const flow = emph === 'flow';
  const selected = state.selected?.id === r.id;
  const dim = emph === 'systems' || emph === 'reserves';

  let colour = opp ? 'var(--hostile)' : (ROUTE_COLOUR[r.status] || '#7d90a6');
  if (dim && !selected) colour = '#2c3b4d';
  let weight = flow
    ? Math.max(2, Math.min(9, 2 + (r.capacityPerDay || 0) / 700))
    : Math.max(2, Math.min(6, 2 + (r.capacityPerDay || 0) / 1000));
  if (['ALOC', 'SLOC', 'PIPE'].includes(r.cls)) weight = 1.5;
  if (selected) weight += 2.5;
  let dash = ROUTE_DASH[r.cls] ?? '';
  if (r.status !== 'OPEN' && !dash) dash = '10 7';

  let pair = routeLines.get(key);
  if (!pair) {
    // An invisible hit line carries the tooltip, the click and the menu; the
    // visual line is non-interactive so it can be styled freely.
    const hit = L.polyline(r.path, { className: 'route-hit', weight: 15, opacity: 0, interactive: true });
    const vis = L.polyline(r.path, { interactive: false });
    hit.bindTooltip(() => routeTip(opp ? 'oroute' : 'route', r.id), { className: cls('tt', opp && 'hostile'), sticky: true });
    hit.on('click', e => { L.DomEvent.stopPropagation(e); emit('select', { kind: opp ? 'oroute' : 'route', id: r.id }); });
    hit.on('mouseover', () => setHover(opp ? 'oroute' : 'route', r.id));
    hit.on('mouseout', () => setHover(null));
    hit.on('contextmenu', e => {
      L.DomEvent.preventDefault(e.originalEvent ?? e); L.DomEvent.stopPropagation(e);
      emit('menu', { kind: opp ? 'oroute' : 'route', id: r.id, latlng: e.latlng, point: [e.originalEvent.clientX, e.originalEvent.clientY] });
    });
    pair = { hit, vis };
    routeLines.set(key, pair);
  }
  pair.vis.setStyle({
    color: colour, weight, opacity: dim && !selected ? 0.5 : 0.95,
    dashArray: dash || null, lineCap: 'butt',
    className: flow && r.status === 'OPEN' && !opp ? 'route-flow' : '',
  });
  group.addLayer(pair.hit); group.addLayer(pair.vis);
  pair.seen = true;
}

function routeTip(kind, id) {
  const r = byId(kind, id);
  if (!r) return '';
  const opp = isOpp(kind);
  const s = opp ? 'HOSTILE' : statusOfRoute(r.status);
  return `<div class="${stCls(s)}"><b>${esc(r.name)}</b>` +
    `<span class="pill">${esc(opp ? 'Assessed' : r.status)}</span>` +
    `<div class="tt-d">${esc(r.cls)} · ${num(r.lengthKm)} km</div>` +
    `<div class="tt-figs">` +
      `<div><span class="k">Capacity</span><span class="v">${num(r.capacityPerDay)} t/d</span></div>` +
      (r.effectiveCapacity != null ? `<div class="${stCls(s)}"><span class="k">Effective</span><span class="v">${num(r.effectiveCapacity)} t/d</span></div>` : '') +
      (r.serials?.length ? `<div><span class="k">Serials</span><span class="v">${r.serials.length}</span></div>` : '') +
    `</div>` +
    (r.note ? `<div class="tt-d">${esc(r.note)}</div>` : '') +
    `<div class="tt-hint">click · select&nbsp;&nbsp;&nbsp;right-click · actions</div></div>`;
}

/* --- 9.6 Reach rings ----------------------------------------------------- */
const RING_CLASS = {
  'Fires': 'cov-fires', 'Air defence': 'cov-ad', 'Electronic warfare': 'cov-ew',
  'Coastal': 'cov-other', 'Aviation': 'cov-avn',
  'Strategic missile forces': 'cov-strat', 'Air bases': 'cov-base',
};

function drawRing(group, a, opp) {
  if (!a.rangeKm || a.rangeKm < 10) return;     // rings are only drawn for >= 10 km
  const key = `${opp ? 'oasset' : 'asset'}:${a.id}`;
  const klass = opp ? `cov-hostile conf-${a.confidence || 'medium'}` : (RING_CLASS[a.category] || 'cov-other');
  let entry = rings.get(key);
  if (!entry) {
    const circle = L.circle([a.lat, a.lng], { radius: a.rangeKm * 1000, interactive: false, fill: false });
    // Labelled at the northern edge, in the ring's own colour.
    const lbl = L.marker([a.lat + a.rangeKm / 111.32, a.lng], { interactive: false, zIndexOffset: Z.ringLabel });
    entry = { circle, lbl };
    rings.set(key, entry);
  }
  entry.circle.setStyle({ className: klass });
  entry.circle.setLatLng([a.lat, a.lng]);
  entry.circle.setRadius(a.rangeKm * 1000);
  entry.lbl.setLatLng([a.lat + a.rangeKm / 111.32, a.lng]);
  const colour = opp ? 'var(--hostile)' : `var(--${RING_CLASS[a.category] || 'cov-other'})`;
  entry.lbl.setIcon(L.divIcon({
    className: cls('ring-lbl', a.rangeKm < 60 && 'rk-small'),
    html: `<span style="color:${colour}">${esc(a.name.replace(/\s*\(assessed\)/, ''))} · ${num(a.rangeKm)} km${opp ? ` · assessed ${esc(a.confidence || '')}` : ''}</span>`,
    iconSize: [0, 0],
  }));
  group.addLayer(entry.circle);
  if (state.layers?.ringLabels !== false) group.addLayer(entry.lbl);
  entry.seen = true;
}

// When a system is selected its ring goes full, and every other drops back.
function focusRing(selected, hovering) {
  const sel = selected && /asset$/.test(selected.kind) ? selected : (hovering && /asset$/.test(hovering.kind) ? hovering : null);
  const pane = map?.getPane('overlayPane');
  if (!pane) return;
  pane.classList.toggle('rings-focused', !!sel);
  for (const [key, e] of rings) {
    const on_ = sel && key === `${sel.kind}:${sel.id}`;
    const el = e.circle._path;
    if (!el) continue;
    el.classList.toggle('cov-sel', !!on_);
  }
}

/* --- 12.3 syncMap: the whole picture, diffed ----------------------------- */
export function syncMap() {
  const d = state.data;
  if (!d || !map) return;
  const L_ = state.layers || {};
  const emph = L_.emphasis;
  const force = L_.force || 'own';
  const showOwn = force === 'own' || force === 'both';
  const showOpp = (force === 'opp' || force === 'both') && L_.oppMaster !== false;

  for (const e of markers.values()) e.seen = false;
  for (const e of rings.values()) e.seen = false;
  for (const e of routeLines.values()) e.seen = false;
  for (const g of PAINT_ORDER) G[g].clearLayers();

  const dimSys = emph === 'systems';
  const dimFlow = emph === 'flow';
  const dimRes = emph === 'reserves';

  // own systems
  if (showOwn) {
    for (const a of d.assets) {
      if (!L_.sys?.[a.id]) continue;
      const m = upsert(G.assets, 'asset', a, [a.lat, a.lng], {
        sub: `${a.serviceable}/${a.held} serviceable · ${a.rangeKm ? num(a.rangeKm) + ' km' : 'no reach'}`,
        tipOffset: 14,
      });
      markers.get(`asset:${a.id}`).opts = {};
      if (L_.ring?.[a.id]) drawRing(G.rings, a, false);
    }
    if (L_.log?.depots) for (const n of d.nodes)
      mark(G.nodes, 'node', n, { dim: dimSys || dimFlow, sub: `${pct(n.fill)} of objective · ${n.echelon}`,
        label: n.status === 'GREEN' ? n.name : `${n.name} · ${classShort(n.lowestClass)}` });
    if (L_.log?.routes) for (const r of d.routes) drawRoute(G.routes, r, false);
    if (L_.log?.formations) for (const u of d.units)
      mark(G.units, 'unit', u, { dim: dimSys, label: '', sub: '',
        chip: emph === 'supply' ? `<span class="unit-chip">${days(u.sustainableDays)} d</span>` : '' });
    if (L_.log?.serials) for (const c of d.convoys)
      mark(G.convoys, 'convoy', c, { dim: !dimFlow && emph && emph !== 'flow',
        label: dimFlow ? c.serial : '', sub: `${num(c.tonnes)} t ${classShort(c.cls)}` });
    if (L_.log?.reserves) for (const v of d.reserves)
      mark(G.reserves, 'reserve', v, { dim: dimSys || dimFlow,
        label: dimRes ? v.name : '', sub: `${v.state} · ${num(v.qty)}` });
  }

  // opposing — assessed, drawn in the hostile hue, never in status colours
  if (showOpp) {
    const o = d.opposing;
    for (const a of o.assets) {
      if (!L_.osys?.[a.id]) continue;
      mark(G.oassets, 'oasset', a, { sub: `assessed ${a.confidence} · ${a.rangeKm ? num(a.rangeKm) + ' km' : ''}` });
      if (L_.oring?.[a.id]) drawRing(G.orings, a, true);
    }
    if (L_.olog?.depots) for (const n of o.nodes) mark(G.onodes, 'onode', n, { sub: `assessed ${n.confidence}` });
    if (L_.olog?.routes) for (const r of o.routes) drawRoute(G.oroutes, r, true);
    if (L_.olog?.formations) for (const u of o.units) mark(G.ounits, 'ounit', u, { label: '', sub: '' });
  }

  for (const g of PAINT_ORDER) { if (!map.hasLayer(G[g])) G[g].addTo(map); }

  // drop what is no longer on
  for (const [k, e] of markers) if (!e.seen) { e.marker.remove(); markers.delete(k); }
  for (const [k, e] of rings) if (!e.seen) { e.circle.remove(); e.lbl.remove(); rings.delete(k); }
  for (const [k, e] of routeLines) if (!e.seen) { e.hit.remove(); e.vis.remove(); routeLines.delete(k); }

  focusRing(state.selected, hover);
  scheduleCollide();

  function mark(group, kind, o, opts) {
    if (o.lat == null || o.lng == null) return;
    upsert(group, kind, o, [o.lat, o.lng], opts);
    const e = markers.get(`${kind}:${o.id}`);
    if (e) e.opts = opts;
  }
}

/* --- 9.1 fitAll ---------------------------------------------------------- */
let fitted = false;
export function fitAll(force = false) {
  if (fitted && !force) return;
  const d = state.data;
  if (!d) return;
  const pts = [];
  for (const n of d.nodes) pts.push([n.lat, n.lng]);
  for (const u of d.units) pts.push([u.lat, u.lng]);
  for (const r of d.routes) for (const p of r.path) pts.push(p);
  if (!pts.length) return;
  const bounds = L.latLngBounds(pts);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  map.fitBounds(bounds, { padding: [30, 30], maxZoom: 8, animate: !reduced });
  fitted = true;
}

export function flyTo(latlng, zoom) {
  if (!map) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) map.setView(latlng, zoom ?? Math.max(map.getZoom(), 8));
  else map.flyTo(latlng, zoom ?? Math.max(map.getZoom(), 8), { duration: 0.6 });
}
export function focusOn(kind, id) {
  const o = byId(kind, id);
  if (!o) return;
  if (o.lat != null) flyTo([o.lat, o.lng]);
  else if (o.path?.length) map.fitBounds(L.latLngBounds(o.path), { padding: [60, 60] });
}

/* --- 9.7 The collision pass ---------------------------------------------
   One pass per animation frame, coalesced, not one per marker. */
const PRIORITY = { 'mk-unit': 0, 'mk-node': 1, 'mk-asset': 2, 'mk-reserve': 3, 'mk-pos': 4, 'mk-convoy': 5 };
let collidePending = false;
export function scheduleCollide() {
  if (collidePending) return;
  collidePending = true;
  requestAnimationFrame(() => { collidePending = false; collide(); });
}

function collide() {
  if (!map) return;
  const pane = map.getPane('markerPane');
  if (!pane) return;
  const items = [];

  for (const el of pane.querySelectorAll('.mk')) {
    const lbl = el.querySelector('.mk-lbl');
    if (!lbl) continue;
    lbl.classList.remove('lbl-hide');
    el.classList.remove('lbl-flip');
    let p = 6;
    for (const k of Object.keys(PRIORITY)) if (el.classList.contains(k)) { p = PRIORITY[k]; break; }
    if (el.classList.contains('is-selected')) p = -1;
    if (el.classList.contains('is-dim')) p = 9;
    items.push({ el, lbl, p, symbol: el });
  }
  for (const el of pane.querySelectorAll('.ring-lbl')) {
    const span = el.querySelector('span');
    if (!span) continue;
    el.classList.remove('lbl-hide');
    // A ring label's own container is a zero-size divIcon, so measure the span —
    // measuring the container would make every ring label invisible to the pass and
    // they would stack on top of each other at the northern edge of each ring.
    items.push({ el, lbl: el, measure: span, p: 7, symbol: null });
  }
  if (!items.length) return;
  items.sort((a, b) => a.p - b.p);

  // Every symbol box is placed first — no label may sit on another symbol.
  const taken = [];
  for (const it of items) {
    if (!it.symbol) continue;
    const r = it.symbol.getBoundingClientRect();
    if (r.width) taken.push({ x: r.left, y: r.top, w: Math.min(r.width, 30), h: r.height });
  }

  for (const it of items) {
    const r = (it.measure || it.lbl).getBoundingClientRect();
    if (!r.width || !r.height) continue;
    let box = { x: r.left, y: r.top, w: r.width, h: r.height };
    if (!hits(box, taken)) { taken.push(box); continue; }
    // flip to the other side and try again
    if (it.symbol) {
      const was = it.symbol.classList.contains('left');
      it.symbol.classList.toggle('left', !was);
      const r2 = (it.measure || it.lbl).getBoundingClientRect();
      box = { x: r2.left, y: r2.top, w: r2.width, h: r2.height };
      if (!hits(box, taken)) { taken.push(box); continue; }
      it.symbol.classList.toggle('left', was);
    }
    // both sides collide: hide it — its hover card carries the figures
    it.lbl.classList.add('lbl-hide');
  }
}
function hits(a, list) {
  for (const b of list) {
    if (a.x < b.x + b.w + 2 && a.x + a.w + 2 > b.x && a.y < b.y + b.h + 1 && a.y + a.h + 1 > b.y) return true;
  }
  return false;
}

/* --- selection ----------------------------------------------------------- */
on('select', () => { refreshIcons(); focusRing(state.selected, hover); scheduleCollide(); });
on('theme', () => {
  // Switching theme also switches the basemap: dark canvas <-> light canvas. Imagery
  // and relief keep their id, but the layer is still rebuilt so the colour a failed
  // tile paints follows the room — otherwise the light theme keeps a dark ground.
  const id = document.getElementById('map')?.dataset.basemap;
  if (id === 'dark' || id === 'light') {
    const next = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    if (state.layers) state.layers.basemap = next;
    setBasemap(next);
  } else setBasemap(id || 'imagery');
});

export { hover as currentHover };
