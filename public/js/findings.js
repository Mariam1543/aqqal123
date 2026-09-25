// The findings strip, and resolving a finding to the thing it is about.
import { state, emit, esc, setHtml, byId, st as stCls } from './state.js';

export function renderFindings() {
  const host = document.getElementById('findings');
  if (!host || !state.data) return;
  const rows = state.data.summary.watchlist || [];
  setHtml(host, rows.map(f => `<button class="finding ${stCls(f.status)}"
    data-select="${esc(f.kind)}:${esc(f.id)}">
    <span class="lbl">${esc(f.kind)} · ${esc(f.status)}</span>
    <b>${esc(f.name)}</b><p>${esc(f.text)}</p></button>`).join(''));
}

// A finding names a thing; this is how the screen gets there.
export function resolveFinding(f) {
  if (!f) return null;
  if (f.select) {
    const [kind, id] = f.select.split(':');
    return byId(kind, id) ? { kind, id } : null;
  }
  if (f.kind && f.id && byId(f.kind, f.id)) return { kind: f.kind, id: f.id };
  return null;
}
