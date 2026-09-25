// The clock popover and the hourly replay.
import { state, emit, esc, dtg, days, setHtml, post, setHtml as _s } from './state.js';

export function clockControl(inline = false) {
  const speeds = [[1, 'Live'], [6, '6×'], [24, '1 d/min'], [96, '4 d/min']];
  const hist = state.data?.history || [];
  const idx = state.replay ?? hist.length - 1;
  const at = hist[idx];
  return `<div class="pop-sec"><span class="lbl">Clock</span>
    <div style="padding:0 12px">
      <button class="btn-sm quiet" id="btn-clock" aria-controls="clock-pop" aria-expanded="${inline}"
        style="display:flex;align-items:center;gap:6px;width:100%">
        <i class="mode-dot ${state.data ? 'busy' : ''}" style="background:var(--ok)"></i>
        <span id="live-text">${state.replay != null ? 'Replay' : 'Live'}</span>
        <span id="dtg" class="mono" style="font-size:11px">${esc(dtg(at?.t || state.data?.simTime))}</span>
        <span class="dim" style="margin-left:auto">▾</span>
      </button>
    </div>
    <div class="pop" id="clock-pop" style="${inline ? 'position:static;width:auto;box-shadow:none;border:0;background:none' : ''}">
      <div class="pop-sec"><span class="lbl">Rate</span>
        <div style="padding:0 12px"><div class="seg-group" role="radiogroup" aria-label="Clock rate">
          ${speeds.map(([v, n]) => `<button class="seg ${state.speed === v ? 'is-on' : ''}" data-speed="${v}">${esc(n)}</button>`).join('')}
        </div></div>
      </div>
      <div class="pop-sec"><span class="lbl">Replay</span>
        <div style="padding:0 12px">
          <input type="range" id="replay-range" min="0" max="${Math.max(0, hist.length - 1)}"
            value="${idx}" style="width:100%" aria-label="Replay position">
          <p class="note" style="display:block">Holdings as returned then; systems and reserves are live.</p>
          <div class="d-acts" style="margin-top:6px">
            <button class="btn-sm" data-replay="play">Play</button>
            <button class="btn-sm" data-replay="live">Back to live</button>
          </div>
        </div>
      </div>
    </div>`;
}

let playTimer = null;
export function setReplay(i) {
  const hist = state.data?.history || [];
  if (i == null || i >= hist.length - 1) {
    state.replay = null;
    document.body.classList.remove('replay');
  } else {
    state.replay = i;
    document.body.classList.add('replay');
  }
  emit('replay', state.replay);
  renderBadge();
}
export function playReplay() {
  if (playTimer) { clearInterval(playTimer); playTimer = null; return; }
  const hist = state.data?.history || [];
  let i = state.replay ?? 0;
  playTimer = setInterval(() => {
    i++;
    if (i >= hist.length - 1) { clearInterval(playTimer); playTimer = null; setReplay(null); return; }
    setReplay(i);
  }, 220);
}
export function backToLive() {
  clearInterval(playTimer); playTimer = null;
  setReplay(null);
}

function renderBadge() {
  let el = document.querySelector('.replay-badge');
  if (state.replay == null) { el?.remove(); return; }
  const hist = state.data?.history || [];
  const at = hist[state.replay];
  if (!el) {
    el = document.createElement('div');
    el.className = 'replay-badge';
    document.getElementById('map-wrap').appendChild(el);
  }
  el.innerHTML = `Replay · ${esc(dtg(at?.t))} <button class="btn-sm" data-replay="live">Back to live</button>`;
}

// During replay, holdings come from the return; systems and reserves stay live.
export function replayOverlay(data) {
  if (state.replay == null || !data) return data;
  const h = data.history?.[state.replay];
  if (!h) return data;
  const classes = data.summary.gate.classes.map(c => ({
    ...c, days: h.dos[c.cls] ?? c.days, forwardDays: h.fwd[c.cls] ?? c.forwardDays,
  }));
  return {
    ...data,
    nodes: data.nodes.map(n => h.nodeFill[n.id] != null ? { ...n, fill: h.nodeFill[n.id] } : n),
    summary: { ...data.summary, classes, gate: { ...data.summary.gate, classes } },
  };
}
