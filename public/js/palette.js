// The command palette. The index is rebuilt on every open from the current picture.
import { state, emit, esc, num, days, setHtml, byId, classShort } from './state.js';
import { OWN_BOARDS, OPP_BOARDS } from './boards.js';
import { PRESETS } from './layers.js';

let index = [], filtered = [], cursor = 0;

export function buildIndex() {
  const d = state.data;
  const out = [];
  if (d) {
    for (const a of d.assets) out.push({ kind: 'System', label: a.name, sub: `${a.category} · ${a.rangeKm ? num(a.rangeKm) + ' km' : 'no reach'}`, act: { select: `asset:${a.id}` } });
    for (const n of d.nodes) out.push({ kind: 'Depot', label: n.name, sub: `${n.echelon} · ${Math.round(n.fill * 100)}%`, act: { select: `node:${n.id}` } });
    for (const u of d.units) out.push({ kind: 'Formation', label: u.name, sub: `${u.echelon} · ${days(u.sustainableDays)} d`, act: { select: `unit:${u.id}` } });
    for (const r of d.routes) out.push({ kind: 'Route', label: r.name, sub: `${r.cls} · ${r.status.toLowerCase()}`, act: { select: `route:${r.id}` } });
    for (const v of d.reserves) {
      out.push({ kind: 'Reserve', label: v.name, sub: `${v.state} · ${num(v.qty)}`, act: { select: `reserve:${v.id}` } });
      if (v.state === 'held') out.push({ kind: 'Action', label: `Release ${v.name.toLowerCase()}`, sub: `${v.effectHours} h to effect`, act: { release: v.id } });
    }
    for (const f of d.fires) out.push({ kind: 'Munition', label: f.name, sub: `${days(f.days)} d of fire`, act: { select: `fires:${f.id}` } });
    for (const a of d.opposing.assets) out.push({ kind: 'Assessed', label: a.name.replace(/\s*\(assessed\)/, ''), sub: `${a.category} · ${a.confidence}`, act: { select: `oasset:${a.id}` } });
    for (const u of d.opposing.units) out.push({ kind: 'Assessed', label: u.name.replace(/\s*\(assessed\)/, ''), sub: `${u.echelon} · ${u.confidence}`, act: { select: `ounit:${u.id}` } });
    for (const n of d.opposing.nodes) out.push({ kind: 'Assessed', label: n.name.replace(/\s*\(assessed\)/, ''), sub: `${n.kind} · ${n.confidence}`, act: { select: `onode:${n.id}` } });
    for (const s of d.scenarios) out.push({ kind: 'Posture', label: s.name, sub: `${s.requiredDays} d required`, act: { scenario: s.id } });
  }
  for (const [k, n] of OWN_BOARDS) out.push({ kind: 'Board', label: n, sub: 'own', act: { board: k } });
  for (const [k, n] of OPP_BOARDS) out.push({ kind: 'Board', label: n, sub: 'assessed', act: { board: k } });
  for (const p of Object.keys(PRESETS)) out.push({ kind: 'Preset', label: p, sub: 'layers', act: { preset: p } });
  out.push(
    { kind: 'Force', label: 'Own forces', sub: 'key 1', act: { force: 'own' } },
    { kind: 'Force', label: 'Opposing', sub: 'key 2', act: { force: 'opp' } },
    { kind: 'Force', label: 'Both', sub: 'key 3', act: { force: 'both' } },
    { kind: 'Tool', label: 'Measure', sub: 'key M', act: { tool: 'measure' } },
    { kind: 'Tool', label: 'Range', sub: 'key R', act: { tool: 'range' } },
    { kind: 'Screen', label: 'Wall mode', sub: 'key W', act: { wall: true } },
    { kind: 'Screen', label: 'Status panel', sub: 'key S', act: { rail: true } },
    { kind: 'Screen', label: 'The brief', sub: 'guided', act: { brief: true } },
    { kind: 'Screen', label: 'Case study', sub: 'May 2025', act: { case: true } },
    { kind: 'Screen', label: 'Introduction', sub: 'what this is', act: { intro: true } },
  );
  index = out;
}

export function openPalette() {
  buildIndex();
  const host = document.getElementById('palette');
  host.hidden = false;
  host.innerHTML = `<div class="ov" role="dialog" aria-label="Find">
    <input id="pal-input" placeholder="Find a system, depot, board, posture or action" autocomplete="off" aria-label="Find">
    <div class="pal-list" id="pal-list"></div></div>`;
  const input = document.getElementById('pal-input');
  input.addEventListener('input', () => { cursor = 0; run(input.value); });
  host.addEventListener('pointerdown', e => { if (e.target === host) closePalette(); });
  run('');
  input.focus();
}
export function closePalette() {
  const host = document.getElementById('palette');
  if (host) { host.hidden = true; host.innerHTML = ''; }
}
export const isPaletteOpen = () => !document.getElementById('palette')?.hidden;

// Matching is AND over whitespace-separated words against label + sub + kind.
function run(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  filtered = index.filter(r => {
    const hay = `${r.label} ${r.sub} ${r.kind}`.toLowerCase();
    return words.every(w => hay.includes(w));
  }).slice(0, 14);
  paint();
}
function paint() {
  const list = document.getElementById('pal-list');
  if (!list) return;
  setHtml(list, filtered.length ? filtered.map((r, i) =>
    `<button class="pal-row ${i === cursor ? 'is-on' : ''}" data-pal="${i}">
      <span class="k">${esc(r.kind)}</span><span>${esc(r.label)}</span><span class="s">${esc(r.sub)}</span>
    </button>`).join('') : `<div class="pal-empty">Nothing matches.</div>`);
}

export function paletteKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closePalette(); return true; }
  if (e.key === 'ArrowDown') { e.preventDefault(); cursor = Math.min(filtered.length - 1, cursor + 1); paint(); return true; }
  if (e.key === 'ArrowUp') { e.preventDefault(); cursor = Math.max(0, cursor - 1); paint(); return true; }
  if (e.key === 'Enter') { e.preventDefault(); runRow(cursor); return true; }
  return false;
}
export function runRow(i) {
  const r = filtered[i];
  if (!r) return;
  closePalette();
  emit('palette-run', r.act);
}
