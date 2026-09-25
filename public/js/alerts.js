// The alerts queue.
import { state, emit, esc, dtg, setHtml, store, cls } from './state.js';

const LEVELS = { ORDER: 'Decision', DELIVERY: 'Delivered', ANALYSIS: 'Analysis', INFO: 'Picture' };

export function unreadCount() {
  const acked = Number(store('ackedAt') || 0);
  return (state.data?.events || []).filter(e => new Date(e.t).getTime() > acked).length;
}

export function renderAlerts() {
  const btnCount = document.getElementById('alerts-count');
  const n = unreadCount();
  if (btnCount) { btnCount.textContent = String(n); btnCount.hidden = n === 0; }
  const pop = document.getElementById('alerts-pop');
  if (!pop || pop.hidden) return;
  const acked = Number(store('ackedAt') || 0);
  const rows = (state.data?.events || []).slice(0, 40);
  setHtml(pop, `<div class="pop-h"><span class="lbl">Alerts</span>
      <button class="btn-sm quiet" data-ack-all="1">Acknowledge all</button></div>
    ${rows.length ? rows.map(e => {
      const isNew = new Date(e.t).getTime() > acked;
      return `<div class="alert-row ${isNew ? 'is-new' : ''}">
        <span class="t">${esc(dtg(e.t, false))}</span>
        <span class="lv ${esc(e.level)}">${esc(LEVELS[e.level] || e.level)}</span>
        <span class="tx">${esc(e.text)}</span></div>`;
    }).join('') : `<div class="alert-row"><span class="tx mute">Nothing logged.</span></div>`}`);
}

export function ackAll() {
  store('ackedAt', String(Date.now()));
  renderAlerts();
}
export function toggleAlerts(force) {
  const pop = document.getElementById('alerts-pop');
  const btn = document.getElementById('btn-alerts');
  const open = force ?? pop.hidden;
  pop.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) renderAlerts();
}
