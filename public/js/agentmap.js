// The agent's own map layer. Two rules keep it readable: at most ten labels,
// and the map carries WHERE while the card carries HOW MUCH.

import { state, emit, on, esc, num } from './state.js';
import { groups, flyTo } from './map.js';

const LABEL_CAP = 10;

// Every trailing figure clause is stripped from a label (up to four of them),
// and a label that only repeats the marker's own name is dropped.
export function cleanLabel(label, ownName) {
  if (!label) return '';
  let s = String(label);
  for (let i = 0; i < 4; i++) {
    const next = s.replace(/\s*[·,—-]\s*[^·,—-]*\d[^·,—-]*$/, '');
    if (next === s) break;
    s = next;
  }
  s = s.trim();
  if (ownName && s.toLowerCase() === String(ownName).toLowerCase()) return '';
  return s;
}

export function drawScene(scene, groupName = 'agent') {
  const G = groups();
  const layer = G[groupName];
  if (!layer) return;
  layer.clearLayers();
  if (!scene) return;
  let labels = 0;

  const addLabel = (latlng, text, hostile) => {
    if (!text || labels >= LABEL_CAP) return;
    labels++;
    layer.addLayer(L.marker(latlng, {
      interactive: false, zIndexOffset: 1200,
      icon: L.divIcon({ className: `agent-lbl ${hostile ? 'hostile' : ''}`, html: `<span>${esc(text)}</span>`, iconSize: [0, 0] }),
    }));
  };

  for (const p of scene.points || []) {
    const hostile = !!p.hostile;
    layer.addLayer(L.circleMarker([p.lat, p.lng], {
      radius: p.kind === 'target' ? 7 : 5,
      color: hostile ? 'var(--hostile)' : 'var(--accent)',
      fillColor: hostile ? 'var(--hostile)' : 'var(--accent)',
      fillOpacity: p.kind === 'target' ? 0.25 : 0.6, weight: 1.6, interactive: false,
    }));
    addLabel([p.lat, p.lng], cleanLabel(p.label), hostile);
  }
  for (const l of scene.lines || []) {
    if (!l.path?.length) continue;
    layer.addLayer(L.polyline(l.path, {
      className: l.kind === 'firing-line' ? 'fire-line' : 'tool-line', interactive: false,
    }));
    if (l.label) {
      const mid = l.path[Math.floor(l.path.length / 2)];
      addLabel(mid, cleanLabel(l.label), false);
    }
  }
  for (const r of scene.rings || []) {
    layer.addLayer(L.circle([r.lat, r.lng], {
      radius: (r.radiusKm || 0) * 1000, interactive: false, fill: false,
      className: r.hostile ? 'cov-hostile conf-medium' : 'cov-fires',
    }));
    addLabel([r.lat + (r.radiusKm || 0) / 111.32, r.lng], cleanLabel(r.label), r.hostile);
  }
  for (const a of scene.arcs || []) {
    layer.addLayer(L.polygon(a.path, { className: 'threat-arc', interactive: false }));
  }

  // The camera moves only if nothing else was drawn in that answer.
  if (scene.fit !== false) {
    const pts = [
      ...(scene.points || []).map(p => [p.lat, p.lng]),
      ...(scene.lines || []).flatMap(l => l.path || []),
    ];
    if (pts.length > 1) {
      const b = L.latLngBounds(pts);
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const m = layer._map;
      if (m) m.fitBounds(b, { padding: [80, 80], maxZoom: 10, animate: !reduced });
    } else if (pts.length === 1) flyTo(pts[0]);
  }
}

export function clearAgentLayer() {
  const G = groups();
  G.agent?.clearLayers();
}
