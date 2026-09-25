// Drone missions drawn on the map.
import { state, emit, esc, num } from './state.js';
import { groups } from './map.js';

export function syncMissions() {
  const g = groups().missions;
  if (!g || !state.data) return;
  g.clearLayers();
  // Mission geometry belongs to the Mission pane, the same way Decide's belongs to
  // Decide. Without this the map is not empty at load, which it must be.
  if (state.side !== 'mission') return;
  for (const m of state.data.missions || []) {
    if (m.state === 'aborted') continue;
    const path = m.route.map(w => [w.lat, w.lng]);
    g.addLayer(L.polyline(path, {
      color: 'var(--det)', weight: 1.4, opacity: 0.7, dashArray: '6 5', interactive: false,
    }));
    for (const w of m.route) {
      g.addLayer(L.circleMarker([w.lat, w.lng], {
        radius: 2.5, color: 'var(--det)', fillOpacity: 1, weight: 1, interactive: false,
      }));
    }
    // where it is now
    const leg = m.route[Math.min(m.leg, m.route.length - 1)];
    if (m.state === 'airborne' && leg) {
      g.addLayer(L.marker([leg.lat, leg.lng], {
        zIndexOffset: 800,
        icon: L.divIcon({
          className: '', iconSize: [16, 16], iconAnchor: [8, 8],
          html: `<div class="mk mk-asset st-AMBER"><svg class="sym" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M2 8 H14 M8 4 V12 M5 4 H11" stroke="var(--det)" stroke-width="1.6" fill="none" stroke-linecap="round"/>
            </svg><span class="mk-lbl"><span class="n">${esc(m.name)}</span>
            <span class="mk-sub">${esc(m.phase)} · ${(m.endurance - m.elapsed).toFixed(1)} h left</span></span></div>`,
        }),
      }).on('click', () => emit('mission-focus', m.id)));
    }
    // the target
    if (m.target) {
      g.addLayer(L.circleMarker([m.target.lat, m.target.lng], {
        radius: 6, color: 'var(--hostile)', fillOpacity: 0.15, weight: 1.4, interactive: false,
      }));
    }
    // detections
    for (const d of m.detections || []) {
      g.addLayer(L.circleMarker([d.lat, d.lng], {
        radius: 3, color: 'var(--det)', fillColor: 'var(--det)',
        fillOpacity: d.status === 'new' ? 0.9 : 0.3, weight: 1, interactive: false,
      }));
    }
  }
}
export function clearMissions() { groups().missions?.clearLayers(); }
