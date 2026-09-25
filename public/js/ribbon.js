// The situation ribbon — wall only.
import { state, esc, num, days, setHtml, cls, st as stCls } from './state.js';

let last = null, lastFetch = 0, lastRec = null;

export async function refreshRibbon(force = false) {
  if (!document.body.classList.contains('wall') && !force) return;
  const now = Date.now();
  if (!force && now - lastFetch < 9000) return;   // at most every 9 s
  lastFetch = now;
  try {
    const r = await fetch('/api/ribbon');
    last = await r.json();
    render();
  } catch (e) { /* the wall keeps the last figures */ }
}

function render() {
  const host = document.getElementById('ribbon');
  if (!host || !last) return;
  const r = last;
  const changed = lastRec && lastRec !== r.recommendation.name;
  lastRec = r.recommendation.name;

  setHtml(host, `
    <div class="rib ${stCls(r.rungStatus)}">
      <span class="rung-chip">R${r.rung}</span><span class="tx">${esc(r.rungName)}</span>
    </div>
    <div class="rib flex"><span class="tx">${esc(r.moment)}</span></div>
    <div class="rib ${stCls(r.forwardStatus)} drop-1">
      <span class="lbl">Forward</span><span class="v">${days(r.forwardDays)} d</span>
      <span class="tx">${esc(r.postureName)}</span>
    </div>
    ${r.exposed ? `<div class="rib ${stCls(r.exposed.status)}">
      <span class="lbl">Most exposed</span><span class="tx">${esc(r.exposed.name)}</span>
      <span class="exp-bar"><i style="width:${Math.min(100, r.exposed.systems * 30)}%"></i></span>
    </div>` : ''}
    <div class="rib ${changed ? 'pulse' : ''} st-ACCENT">
      <span class="lbl">Recommends</span><span class="tx">${esc(r.recommendation.name)}</span>
      <span class="v">${r.recommendation.total}</span>
    </div>
    <div class="rib push">
      <div class="seg-group" role="radiogroup" aria-label="Workspace">
        <button class="seg" data-ws="watch">Watch</button>
        <button class="seg" data-ws="plan">Plan</button>
        <button class="seg" data-ws="agent">Agent</button>
      </div>
    </div>`);
}
