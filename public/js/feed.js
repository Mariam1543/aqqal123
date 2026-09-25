// The simulated sensor feed window.
import { state, emit, esc, num, dtg, grid, setHtml, distKm, bearing } from './state.js';

let fmap = null, tiles = null, mode = 'EO', missionId = null, zoom = 15;

export function openFeed(id) {
  missionId = id || state.missionId || state.data?.missions?.[0]?.id;
  const host = document.getElementById('feed');
  if (!host) return;
  host.hidden = false;
  render();
  emit('feed', { open: true, missionId });
}
export function closeFeed() {
  const host = document.getElementById('feed');
  if (host) host.hidden = true;
  if (fmap) { fmap.remove(); fmap = null; tiles = null; }
}
export const isFeedOpen = () => !document.getElementById('feed')?.hidden;
export function setSensor(m) { mode = m; render(); }
export function zoomFeed(d) { zoom = Math.max(11, Math.min(18, zoom + d)); render(); }

function mission() { return (state.data?.missions || []).find(m => m.id === missionId) || state.data?.missions?.[0]; }

function render() {
  const host = document.getElementById('feed');
  const m = mission();
  if (!host || host.hidden || !m) return;
  const t = m.target;
  const leg = m.route[Math.min(m.leg, m.route.length - 1)];
  const slant = distKm(leg.lat, leg.lng, t.lat, t.lng);
  const brg = bearing(leg.lat, leg.lng, t.lat, t.lng);

  if (!host.querySelector('.feed-view')) {
    host.innerHTML = `<div class="feed-h">
        <b>${esc(m.name)}</b><span class="s">simulated · imagery basemap</span>
        <span class="sp">
          <button class="btn-sm quiet" data-feed-sensor="EO">EO</button>
          <button class="btn-sm quiet" data-feed-sensor="IR">IR</button>
          <button class="btn-sm quiet" data-feed-zoom="1" aria-label="Zoom in">+</button>
          <button class="btn-sm quiet" data-feed-zoom="-1" aria-label="Zoom out">−</button>
          <button class="btn-sm quiet" data-feed-close="1" aria-label="Close">×</button>
        </span></div>
      <div class="feed-view">
        <div class="fv-map" id="fv-map"></div>
        <div class="fv-scan"></div><div class="fv-cross"></div>
        <div class="fv-hud"><div class="l"></div><div class="r"></div><div class="b"></div></div>
      </div>`;
    fmap = L.map('fv-map', { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, keyboard: false });
    tiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 18 }).addTo(fmap);
  }
  host.querySelector('.feed-h b').textContent = m.name;
  for (const b of host.querySelectorAll('[data-feed-sensor]')) b.classList.toggle('is-on', b.dataset.feedSensor === mode);
  host.querySelector('.fv-map').classList.toggle('ir', mode === 'IR');
  if (fmap) { fmap.setView([t.lat, t.lng], zoom); setTimeout(() => fmap.invalidateSize(), 20); }

  host.querySelector('.fv-hud .l').innerHTML = [
    esc(m.callsign), `${mode} · FOV 4.2°`,
    `ALT ${num(4200 + m.leg * 180)} m`, `GS ${num(148)} kt`,
    `HDG ${Math.round(brg).toString().padStart(3, '0')}`,
    `SLANT ${num(slant, 1)} km`, esc(m.phase), `LEG ${m.leg + 1}/${m.route.length}`,
    `LINK ${m.state === 'airborne' ? 'GOOD' : 'IDLE'}`,
  ].join('<br>');
  host.querySelector('.fv-hud .r').innerHTML = [
    esc(dtg(state.data.simTime, false)), esc(grid(t.lat, t.lng)),
    `${t.lat.toFixed(4)} ${t.lng.toFixed(4)}`,
    `DET ${m.detections.length}`,
    `END ${(m.endurance - m.elapsed).toFixed(1)} h`,
    m.state === 'airborne' ? 'REC' : 'STBY',
  ].join('<br>');
  host.querySelector('.fv-hud .b').textContent = cameraLine(m);

  // the target box and the detection boxes, placed from the feed map's projection
  for (const el of host.querySelectorAll('.fv-box')) el.remove();
  const view = host.querySelector('.feed-view');
  const place = (lat, lng, label, isTarget) => {
    if (!fmap) return;
    const p = fmap.latLngToContainerPoint([lat, lng]);
    const r = view.getBoundingClientRect();
    if (p.x < 10 || p.y < 14 || p.x > r.width - 10 || p.y > r.height - 10) return;
    const box = document.createElement('div');
    box.className = `fv-box ${isTarget ? 'target' : ''}`;
    const s = isTarget ? 34 : 18;
    box.style.cssText = `left:${p.x - s / 2}px;top:${p.y - s / 2}px;width:${s}px;height:${s}px`;
    box.innerHTML = `<span>${esc(label)}</span>`;
    view.appendChild(box);
  };
  place(t.lat, t.lng, t.name.replace(/\s*\(assessed\)/, ''), true);
  for (const d of m.detections) place(d.lat, d.lng, `${Math.round(d.conf * 100)}%`, false);
}

function cameraLine(m) {
  const d = m.detections[0];
  return d ? `What the camera sees: ${d.label.toLowerCase()}, ${Math.round(d.conf * 100)} per cent.`
    : 'What the camera sees: clear ground, nothing called.';
}
export { render as renderFeed };
