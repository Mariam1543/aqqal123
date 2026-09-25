// Measure, range, and drawing a plan's reach.
import { state, emit, on, esc, num, grid, distKm, bearing } from './state.js';
import { map, groups } from './map.js';
import { newPlan, editPlan, renderPlan, assess } from './plan.js';

let active = null;
let points = [];

export function setTool(tool) {
  if (active === tool) return clearTool();
  active = tool;
  points = [];
  document.getElementById('map')?.classList.toggle('is-tool', !!tool);
  for (const b of document.querySelectorAll('#tools [data-tool]'))
    b.classList.toggle('is-on', b.dataset.tool === tool);
  emit('tool', tool);
}
export function clearTool() {
  active = null; points = [];
  document.getElementById('map')?.classList.remove('is-tool');
  for (const b of document.querySelectorAll('#tools [data-tool]')) b.classList.remove('is-on');
  emit('tool', null);
}
export const activeTool = () => active;

export function clearDrawings() {
  groups().tools?.clearLayers();
  points = [];
}

export function initTools() {
  if (!map) return;
  map.on('click', e => {
    if (!active) return;
    points.push([e.latlng.lat, e.latlng.lng]);
    draw();
  });
  map.on('dblclick', () => { if (active === 'plan') finishPlan(); });
}

function draw() {
  const g = groups().tools;
  if (!g) return;
  g.clearLayers();
  const label = (latlng, text) => g.addLayer(L.marker(latlng, {
    interactive: false, zIndexOffset: 1200,
    icon: L.divIcon({ className: 'tool-lbl', html: `<span>${esc(text)}</span>`, iconSize: [0, 0] }),
  }));

  if (active === 'measure' && points.length >= 1) {
    if (points.length >= 2) {
      g.addLayer(L.polyline(points, { className: 'tool-line', interactive: false }));
      let total = 0;
      for (let i = 1; i < points.length; i++) total += distKm(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
      const last = points[points.length - 1];
      const brg = bearing(points[points.length - 2][0], points[points.length - 2][1], last[0], last[1]);
      label(last, `${num(total, 1)} km · ${Math.round(brg)}°`);
    }
    for (const p of points) g.addLayer(L.circleMarker(p, { radius: 3, color: 'var(--accent)', fillOpacity: 1, interactive: false }));
    label(points[0], grid(points[0][0], points[0][1]));
  }

  if (active === 'range' && points.length) {
    const c = points[points.length - 1];
    for (const r of [25, 50, 100, 200]) {
      g.addLayer(L.circle(c, { radius: r * 1000, className: 'tool-ring', interactive: false, fill: r === 25 }));
      label([c[0] + r / 111.32, c[1]], `${r} km`);
    }
    label(c, grid(c[0], c[1]));
  }

  if (active === 'plan' && points.length) {
    if (points.length >= 3) g.addLayer(L.polygon(points, { className: 'plan-obj', interactive: false }));
    else g.addLayer(L.polyline(points, { className: 'plan-axis', interactive: false }));
    for (const p of points) g.addLayer(L.circleMarker(p, { radius: 3, color: 'var(--accent)', fillOpacity: 1, interactive: false }));
    label(points[0], `Objective — ${points.length} point${points.length === 1 ? '' : 's'}, Enter closes`);
  }
}

export function finishPlan() {
  if (active !== 'plan' || points.length < 3) return;
  if (!state.plan) state.plan = newPlan();
  editPlan(p => { p.objective = points.slice(); });
  clearTool();
  emit('side', 'pane-plan');
  emit('plan-drawn');
}
