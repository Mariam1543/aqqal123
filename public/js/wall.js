// Wall mode: board cycling and the ticker.
import { state, emit, esc, setHtml, cls, st as stCls } from './state.js';
import { openBoard } from './boards.js';

const CYCLE = ['assets', 'sustainability', 'standoff', 'ladder', 'reserves'];
const PERIOD = 20000;
let timer = null, started = 0, raf = null, paused = false;

export function startWall() {
  stopWall();
  let i = Math.max(0, CYCLE.indexOf(state.board));
  openBoard(CYCLE[i]);
  started = Date.now();
  timer = setInterval(() => {
    if (paused || document.hidden) { started = Date.now(); return; }
    i = (i + 1) % CYCLE.length;
    openBoard(CYCLE[i]);
    started = Date.now();
  }, PERIOD);
  tickProgress();
  const board = document.getElementById('board');
  board.addEventListener('mouseenter', pause);
  board.addEventListener('mouseleave', resume);
  refreshTicker(true);
}
export function stopWall() {
  clearInterval(timer); timer = null;
  cancelAnimationFrame(raf);
  const bar = document.getElementById('wall-progress');
  if (bar) bar.hidden = true;
}
const pause = () => { paused = true; };
const resume = () => { paused = false; started = Date.now(); };

// Choosing a board by hand restarts the cycle from there.
export function restartCycleAt(id) {
  if (!document.body.classList.contains('wall')) return;
  const i = CYCLE.indexOf(id);
  if (i < 0) return;
  started = Date.now();
}

function tickProgress() {
  const bar = document.getElementById('wall-progress');
  if (!bar) return;
  bar.hidden = !document.body.classList.contains('wall');
  if (!bar.hidden) {
    const f = Math.min(1, (Date.now() - started) / PERIOD);
    bar.style.width = (f * 100).toFixed(1) + '%';
  }
  raf = requestAnimationFrame(tickProgress);
}

let tickTimer = null;
export async function refreshTicker(force) {
  if (!document.body.classList.contains('wall') && !force) return;
  try {
    const r = await fetch('/api/agent/watch');
    const { findings } = await r.json();
    const host = document.getElementById('tick-run');
    if (!host) return;
    const items = findings.map(f =>
      `<span class="tick-item ${stCls(f.severity)}">${esc(f.title)} — ${esc(f.action)}</span>`).join('');
    // duplicated for a seamless loop
    setHtml(host, items + items);
    const chars = findings.reduce((s, f) => s + f.title.length + f.action.length, 0);
    host.style.animationDuration = Math.max(24, chars / 6) + 's';
  } catch (e) { /* the ticker keeps running on the last set */ }
  clearTimeout(tickTimer);
  tickTimer = setTimeout(() => refreshTicker(), 20000);
}

export function renderFindings() {
  const host = document.getElementById('findings');
  if (!host || !state.data) return;
  const rows = (state.data.summary.watchlist || []).map(f =>
    `<button class="finding ${stCls(f.status)}" data-select="${esc(f.kind)}:${esc(f.id)}">
      <span class="lbl">${esc(f.kind)} · ${esc(f.status)}</span>
      <b>${esc(f.name)}</b><p>${esc(f.text)}</p></button>`).join('');
  setHtml(host, rows);
}
