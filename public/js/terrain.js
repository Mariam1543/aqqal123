// The 3D terrain view (MapLibre). No API key: terrarium DEM and Esri imagery.

import { state, emit, esc, num, days, setHtml, cls, st as stCls, grid, distKm } from './state.js';

let ml = null, folder = null, elements = [], playing = null, clockStep = 0;

const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export async function openTerrain(kind, id) {
  const host = document.getElementById('terrain');
  if (!host) return;
  host.hidden = false;
  host.className = 'terrain no-side';
  host.innerHTML = `<div class="t-canvas"><div id="t-map"></div>
      <div class="t-acts">
        <button class="btn-sm" data-terrain-close="1">Close</button>
        <button class="btn-sm" data-terrain-side="1">Details</button>
        <button class="btn-sm" data-terrain-play="1">Play</button>
      </div>
      <div class="t-clock" id="t-clock">H-4:00</div>
    </div>
    <aside class="t-side" id="t-side"></aside>`;

  try {
    const r = await fetch(`/api/target?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`);
    folder = r.ok ? await r.json() : null;
  } catch (e) { folder = null; }
  if (!folder) { setHtml(document.getElementById('t-side'), '<div class="empty-state"><b>No scene</b><p>No target folder for that object.</p></div>'); return; }

  buildScene();
  renderSide();
}

export function closeTerrain() {
  const host = document.getElementById('terrain');
  if (host) { host.hidden = true; host.innerHTML = ''; }
  if (ml) { ml.remove(); ml = null; }
  clearInterval(playing); playing = null;
  emit('terrain', { open: false });
}
export const terrainOpen = () => !document.getElementById('terrain')?.hidden;
export function toggleTerrainSide() {
  document.getElementById('terrain')?.classList.toggle('no-side');
  setTimeout(() => ml?.resize(), 60);
}

function buildScene() {
  if (typeof maplibregl === 'undefined') {
    setHtml(document.getElementById('t-side'), '<div class="empty-state"><b>3D is not available</b><p>The terrain library did not load.</p></div>');
    return;
  }
  const s = folder.scene;
  const t = s.target;
  ml = new maplibregl.Map({
    container: 't-map',
    style: {
      version: 8,
      sources: {
        imagery: { type: 'raster', tiles: [IMAGERY], tileSize: 256, maxzoom: 18 },
        dem: { type: 'raster-dem', tiles: [DEM], tileSize: 256, encoding: 'terrarium', maxzoom: 14 },
      },
      layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }],
      terrain: { source: 'dem', exaggeration: 1.4 },
    },
    center: [t.lng, t.lat], zoom: 9.4, pitch: 62, bearing: -22,
    attributionControl: false,
  });

  ml.on('load', () => {
    ml.setTerrain({ source: 'dem', exaggeration: 1.4 });
    elements = [];

    // the target and the firing position
    addPoint('target', t.name, t.lat, t.lng, '#e2655c');
    if (s.shooter) addPoint('shooter', s.shooter.name, s.shooter.lat, s.shooter.lng, '#4d9fd6');
    if (s.path?.length === 2) addLine('path', 'Firing line', s.path, '#4d9fd6');
    if (s.scoot) addLine('scoot', `Scoot — ${s.scoot.minutes} min`, [s.scoot.from, s.scoot.to], '#3aa172');

    // engagement domes, extruded to the height they actually cover
    for (const [i, d] of (s.domes || []).entries()) addDome(`dome-${i}`, d.name, d, '#e2655c', 0.16);
    for (const [i, u] of (s.umbrella || []).entries()) addDome(`umb-${i}`, u.name, u, '#9b8bea', 0.13);
    // jamming volumes are drawn low, to the height a drone flies
    for (const [i, j] of (s.jamming || []).entries()) addDome(`jam-${i}`, j.name, j, '#d07ab8', 0.1);
    if (s.counterBattery) addDome('cb', 'Counter-battery reach', { ...s.counterBattery, altKm: 2 }, '#d09a3c', 0.08);

    renderSide();
  });
}

function circle(lat, lng, radiusKm, n = 64) {
  const coords = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    coords.push([lng + (radiusKm / (111.32 * Math.cos(lat * Math.PI / 180))) * Math.cos(a),
      lat + (radiusKm / 111.32) * Math.sin(a)]);
  }
  return coords;
}

function addDome(id, name, d, colour, opacity) {
  if (!ml.getSource(id)) {
    ml.addSource(id, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [circle(d.lat, d.lng, d.radiusKm)] }, properties: {} } });
    ml.addLayer({
      id, type: 'fill-extrusion', source: id,
      paint: {
        'fill-extrusion-color': colour,
        'fill-extrusion-height': Math.min(d.altKm ?? 20, 30) * 1000,
        'fill-extrusion-base': 0, 'fill-extrusion-opacity': opacity,
      },
    });
  }
  elements.push({ id, name, kind: 'volume', colour, lat: d.lat, lng: d.lng, on: true,
    detail: `${num(d.radiusKm)} km to ${Math.min(d.altKm ?? 20, 30)} km` });
}
function addPoint(id, name, lat, lng, colour) {
  if (!ml.getSource(id)) {
    ml.addSource(id, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} } });
    ml.addLayer({ id, type: 'circle', source: id,
      paint: { 'circle-radius': 7, 'circle-color': colour, 'circle-opacity': 0.85, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#0c1015' } });
  }
  elements.push({ id, name, kind: 'point', colour, lat, lng, on: true, detail: grid(lat, lng) });
}
function addLine(id, name, path, colour) {
  if (!ml.getSource(id)) {
    ml.addSource(id, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: path.map(p => [p[1], p[0]]) }, properties: {} } });
    ml.addLayer({ id, type: 'line', source: id,
      paint: { 'line-color': colour, 'line-width': 2.4, 'line-dasharray': [3, 2] } });
  }
  const d = distKm(path[0][0], path[0][1], path[1][0], path[1][1]);
  elements.push({ id, name, kind: 'line', colour, lat: path[0][0], lng: path[0][1], on: true, detail: `${num(d)} km` });
}

function renderSide() {
  const host = document.getElementById('t-side');
  if (!host) return;
  setHtml(host, `<div class="d-h st-HOSTILE"><span class="kind">Scene</span>
      <h3>${esc(folder.target.name.replace(/\s*\(assessed\)/, ''))}</h3>
      <div class="d-meta"><span class="pill">${esc(folder.target.confidence)}</span>
        <span class="grid">${esc(grid(folder.target.lat, folder.target.lng))}</span></div></div>
    ${elements.map(e => `<button class="t-row ${e.on ? '' : 'is-off'}" data-terrain-el="${esc(e.id)}">
      <span class="sw" style="background:${esc(e.colour)}"></span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.name.replace(/\s*\(assessed\)/, ''))}</span>
      <span class="tg">${esc(e.detail)}</span></button>`).join('')}
    ${folder.sequence?.length ? `<section class="d-b"><h4>Sequence</h4>
      ${folder.sequence.map(s => `<div class="fact"><span class="k">${esc(s.at)}</span>
        <span class="v" style="font-family:var(--sans);text-align:left">${esc(s.text)}</span></div>`).join('')}
    </section>` : ''}`);
}

// A row both selects (the camera flies to it) and switches its geometry on and off.
export function terrainElement(id) {
  const e = elements.find(x => x.id === id);
  if (!e || !ml) return;
  e.on = !e.on;
  if (ml.getLayer(id)) ml.setLayoutProperty(id, 'visibility', e.on ? 'visible' : 'none');
  if (e.on) ml.flyTo({ center: [e.lng, e.lat], zoom: 10.4, pitch: 64, duration: 900 });
  renderSide();
}

export function playSequence() {
  if (!folder?.sequence?.length) return;
  clearInterval(playing);
  clockStep = 0;
  const chip = document.getElementById('t-clock');
  playing = setInterval(() => {
    const s = folder.sequence[clockStep];
    if (!s) { clearInterval(playing); playing = null; return; }
    if (chip) chip.textContent = `${s.at} — ${s.text}`;
    clockStep++;
  }, 1600);
}
