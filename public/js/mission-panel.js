// The mission console pane.
import { state, emit, esc, num, days, pct, dtg, setHtml, cls, st as stCls, post, grid, distKm } from './state.js';

export function renderMissionPanel() {
  const host = document.getElementById('mission-body');
  if (!host) return;
  const list = state.data?.missions || [];
  if (!list.length) {
    setHtml(host, `<div class="empty-state"><b>No missions</b>
      <p>Nothing is airborne and nothing is loaded.</p></div>`);
    return;
  }
  const m = list.find(x => x.id === state.missionId) || list[0];
  state.missionId = m.id;
  const left = m.endurance - m.elapsed;
  const total = m.route[m.route.length - 1].minutes || 1;
  const nowMin = (m.elapsed / m.endurance) * total;

  setHtml(host, `
    <div class="d-b" style="padding-bottom:10px">
      <div class="chip-row">${list.map(x =>
        `<button class="chip ${x.id === m.id ? 'is-on' : ''}" data-mission-pick="${esc(x.id)}">${esc(x.name)}</button>`).join('')}</div>
    </div>
    <div class="d-h ${stCls(m.state === 'airborne' ? 'AMBER' : 'GREEN')}">
      <span class="kind">Mission</span><h3>${esc(m.name)}</h3>
      <div class="d-meta"><span class="pill">${esc(m.state)}</span>
        <span class="reason">${esc(m.callsign)} · ${esc(m.phase)} over ${esc(m.target.name.replace(/\s*\(assessed\)/, ''))}</span>
        <span class="grid">${esc(grid(m.target.lat, m.target.lng))}</span></div>
    </div>
    <div class="kpis">
      <div class="kpi ${stCls(left < 2 ? 'RED' : 'GREEN')}"><span class="k">Endurance left</span>
        <span class="v">${left.toFixed(1)}<span class="unit">h</span></span><span class="n">of ${m.endurance} h</span></div>
      <div class="kpi"><span class="k">Sensor</span><span class="v" style="font-size:19px">${esc(m.sensor)}</span></div>
      <div class="kpi"><span class="k">Leg</span><span class="v">${m.leg + 1}<span class="unit">/${m.route.length}</span></span></div>
      <div class="kpi ${stCls(m.detections.some(d => d.status === 'new') ? 'AMBER' : 'GREEN')}">
        <span class="k">Detections</span><span class="v">${m.detections.length}</span>
        <span class="n">${m.detections.filter(d => d.status === 'new').length} to review</span></div>
    </div>
    <section class="d-b"><h4>Phases</h4>
      <div class="phase-bar">
        ${m.route.slice(0, -1).map((w, i) => {
          const span = (m.route[i + 1].minutes - w.minutes) / total;
          return `<i class="${i === m.leg ? 'is-on' : ''}" style="flex:${span}">${span > 0.14 ? esc(w.phase) : ''}</i>`;
        }).join('')}
        <span class="now" style="left:${Math.min(100, (nowMin / total) * 100).toFixed(1)}%"></span>
      </div>
    </section>
    <section class="d-b"><h4>What the camera sees</h4>
      <p style="font-size:12.5px;color:var(--ink-2);line-height:1.55">${esc(cameraLine(m))}</p>
    </section>
    <section class="d-b"><h4>Detections</h4>
      <div class="det-grid">${m.detections.length ? m.detections.map(d =>
        `<button class="det-chip ${stCls(d.conf > 0.7 ? 'RED' : 'AMBER')}" data-obs="${esc(d.id)}">
          <input type="checkbox" ${d.status !== 'new' ? 'checked' : ''} aria-label="${esc(d.label)}">
          <span class="n">${esc(d.label)}<span class="c">${pct(d.conf)} · ${esc(d.status)}</span></span>
        </button>`).join('') : '<span class="mute" style="font-size:12.5px">Nothing reported.</span>'}</div>
      <p class="note">Detections are machine calls awaiting review. Nothing here is confirmed.</p>
    </section>
    <section class="d-b"><h4>Route</h4>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Waypoint</th><th>Phase</th>
        <th class="num">At</th><th class="num">Grid</th></tr></thead><tbody>
        ${m.route.map((w, i) => `<tr class="${i === m.leg ? 'st-AMBER' : ''}">
          <td>${esc(w.name)}</td><td>${esc(w.phase)}</td>
          <td class="num">${w.minutes} min</td><td class="num">${esc(grid(w.lat, w.lng))}</td></tr>`).join('')}
      </tbody></table></div>
    </section>
    <section class="d-b"><div class="d-acts">
      ${m.state === 'ready' ? `<button class="btn btn-sm primary" data-mission-act="launch:${esc(m.id)}">Release</button>` : ''}
      ${m.state === 'airborne' ? `<button class="btn btn-sm" data-mission-act="advance:${esc(m.id)}">Skip ahead</button>` : ''}
      <button class="btn btn-sm" data-feed-open="${esc(m.id)}">Feed</button>
      <button class="btn btn-sm" data-mission-act="analyse:${esc(m.id)}">Analyse</button>
      <button class="btn btn-sm" data-mission-act="engage:${esc(m.id)}">Engage</button>
      ${m.state === 'airborne' ? `<button class="btn btn-sm danger" data-mission-act="abort:${esc(m.id)}">Abort</button>` : ''}
    </div></section>`);
}

function cameraLine(m) {
  const d = m.detections[0];
  if (m.state !== 'airborne') return `${m.name} is ${m.state}. The sensor is not returning.`;
  if (!d) return `Clear ground under the sensor. Nothing has been called at ${m.sensor === 'IR' ? 'infra-red' : 'electro-optical'}.`;
  return `${m.sensor === 'IR' ? 'Infra-red' : 'Electro-optical'} over ${m.target.name.replace(/\s*\(assessed\)/, '')}: ${d.label.toLowerCase()}, called at ${Math.round(d.conf * 100)} per cent, with ${m.detections.length - 1} other object${m.detections.length === 2 ? '' : 's'} in frame.`;
}

export async function missionAct(action, id) {
  await post(`/api/missions/${encodeURIComponent(id)}/${action}`, {});
  renderMissionPanel();
}
export async function reviewObservation(id, status = 'reviewed') {
  await post(`/api/observations/${encodeURIComponent(id)}/review`, { status });
  renderMissionPanel();
}
