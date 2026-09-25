// Shared state, formatters, status maths, MGRS and the event bus.
// One mutable object. No framework, no immutability.

export const state = {
  data: null,
  selected: null,        // { kind, id } | null
  side: 'assistant',
  board: null,
  layers: null,
  plan: null,
  scenario: null,
  replay: null,
  speed: 1,
  wall: false,
  workspace: 'watch',
  railOpen: false,
  failures: 0,
  intel: null,
  decisions: null,
  exchange: null,
  caseStudy: null,
  focusTarget: null,
  boardSort: {},
  openNotes: new Set(),
  guidance: [],
  missions: [],
};

/* --- 12.2 The event bus --------------------------------------------------
   Modules never import each other's DOM. Cross-module effects go through here. */
const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => bus.addEventListener(name, e => fn(e.detail, e));

/* --- storage -------------------------------------------------------------
   Every read and write inside try/catch. Storage can be unavailable (private
   windows, blocked site data) and the picture must render anyway. */
export function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem('clp.' + key);
    if (value === null) localStorage.removeItem('clp.' + key);
    else localStorage.setItem('clp.' + key, value);
  } catch (e) { /* the picture renders anyway */ }
  return value;
}
export function storeJSON(key, value) {
  try {
    if (value === undefined) { const r = localStorage.getItem('clp.' + key); return r ? JSON.parse(r) : null; }
    localStorage.setItem('clp.' + key, JSON.stringify(value));
  } catch (e) { return null; }
  return value;
}
export const session = (() => {
  try {
    let s = sessionStorage.getItem('clp.session');
    if (!s) { s = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('clp.session', s); }
    return s;
  } catch (e) { return Math.random().toString(36).slice(2, 10); }
})();

/* --- 12.6 The role header ------------------------------------------------
   The role travels on every /api request. Wrapped once, here, so no call site
   has to remember: that is how an order or a release carries who made it. */
export const getRole = () => store('role') || 'commander';
export const setRole = r => { store('role', r); emit('role', r); };
(function wrapFetch() {
  const orig = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url.startsWith('/api')) {
      const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined) || {});
      if (!headers.has('X-CLP-Role')) headers.set('X-CLP-Role', getRole());
      init = { ...init, headers };
    }
    return orig(input, init);
  };
})();

/* --- 12.3 Any mutation awaits a refresh, so the UI never optimistically lies. */
let refresher = null;
export const setRefresher = fn => { refresher = fn; };
export async function post(url, body, method = 'POST') {
  const init = { method };
  if (body !== undefined) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
  const r = await fetch(url, init);
  if (!r.ok) {
    let msg = r.status + ' ' + r.statusText;
    try { const j = await r.json(); if (j.error) msg = j.error; } catch (e) {}
    throw new Error(msg);
  }
  const out = await r.json().catch(() => ({}));
  if (refresher) await refresher();
  return out;
}

/* --- formatters ---------------------------------------------------------- */

export function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function num(v, d = 0) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function days(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  return n < 10 ? n.toFixed(1) : String(Math.round(n));
}
export function pct(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Math.round(Number(v) * 100) + '%';
}
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
// "251430Z SEP 26" — DDHHMMZ MON YY, always UTC.
export function dtg(iso, withDate = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = n => String(n).padStart(2, '0');
  const core = `${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z`;
  return withDate ? `${core} ${MONTHS[d.getUTCMonth()]} ${p(d.getUTCFullYear() % 100)}` : core;
}
export function fmtMin(m) {
  if (m == null || !Number.isFinite(Number(m))) return '—';
  const t = Math.round(Number(m));
  if (t < 60) return `${t} min`;
  const h = Math.floor(t / 60), mm = t % 60;
  if (h < 24) return mm ? `${h} h ${p2(mm)}` : `${h} h`;
  const d = Math.floor(h / 24), hh = h % 24;
  return hh ? `${d} d ${hh} h` : `${d} d`;
}
export const fmtHours = h => fmtMin(h == null ? null : h * 60);
const p2 = n => String(n).padStart(2, '0');

/* --- status maths -------------------------------------------------------- */

export function fillThresholds() {
  return state.data?.meta?.fillThresholds || { green: 0.9, amber: 0.75, red: 0.5 };
}
export function statusOfFill(f) {
  const t = fillThresholds();
  if (f >= t.green) return 'GREEN';
  if (f >= t.amber) return 'AMBER';
  if (f >= t.red) return 'RED';
  return 'BLACK';
}
export function classNorm(cls) {
  return state.data?.meta?.classes?.[cls]?.norm ?? 10;
}
export function statusOfDos(d, cls) {
  const r = d / classNorm(cls);
  if (r >= 1) return 'GREEN';
  if (r >= 0.7) return 'AMBER';
  if (r >= 0.4) return 'RED';
  return 'BLACK';
}
export const statusOfRoute = s => (s === 'OPEN' ? 'GREEN' : s === 'RESTRICTED' ? 'AMBER' : 'RED');
export const verdictStatus = v => (v === 'ADEQUATE' ? 'GREEN' : v === 'MARGINAL' ? 'AMBER' : 'RED');
const ORDER = { GREEN: 0, AMBER: 1, RED: 2, BLACK: 3 };
export function worst(...sts) {
  return sts.filter(Boolean).reduce((a, b) => (ORDER[b] > ORDER[a] ? b : a), 'GREEN');
}
export const className = cls => state.data?.meta?.classes?.[cls]?.name || cls;
export const classShort = cls => state.data?.meta?.classes?.[cls]?.short || cls;

/* --- lookups ------------------------------------------------------------- */

export function collection(kind) {
  if (kind === 'fires') return 'fires';                    // already plural
  if (kind === 'platform') return 'platforms';
  if (/^o(node|unit|route|asset)$/.test(kind)) return kind.slice(1) + 's';
  return kind + 's';
}
export const isOpp = kind => /^o(node|unit|route|asset)$/.test(kind);
export function byId(kind, id) {
  const d = state.data;
  if (!d) return null;
  const pool = isOpp(kind) ? d.opposing?.[collection(kind)] : d[collection(kind)];
  return (pool || []).find(x => x.id === id) || null;
}
export function nameOf(kind, id) {
  const o = byId(kind, id);
  return o ? (o.name || o.serial || id) : id;
}

/* --- 12.4 Idempotent rendering ------------------------------------------
   A 3-second poll that blindly rewrote innerHTML would destroy the reader's
   text selection, an open <details>, a table sort and scroll position four
   times a minute. */
// Is the reader part-way through selecting something inside this host? Rewriting
// innerHTML under them would wipe it, and the poll runs four times a minute.
function selectionInside(host) {
  try {
    const sel = document.getSelection?.();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
    const r = sel.getRangeAt(0);
    return host.contains(r.commonAncestorContainer);
  } catch (e) { return false; }
}

export function setHtml(host, html) {
  if (!host) return false;
  if (host.__html === html) return false;
  // Hold the write until the selection is released. The as-of chip still says how
  // current the picture is, so nothing on screen is claiming to be newer than it is.
  if (selectionInside(host)) { host.__pending = html; return false; }
  host.__pending = null;
  const top = host.scrollTop, left = host.scrollLeft;
  host.__html = html;
  host.innerHTML = html;
  if (top) host.scrollTop = top;
  if (left) host.scrollLeft = left;
  return true;
}

/* --- sortable tables -----------------------------------------------------
   Every table header sorts on click; numbers sort as numbers. The sort is
   remembered per board and re-applied after each redraw. */
export function sortTable(table, colIndex, dir) {
  const body = table.tBodies[0];
  if (!body) return;
  const rows = [...body.rows];
  const val = (row) => {
    const cell = row.cells[colIndex];
    if (!cell) return '';
    const raw = (cell.dataset.v ?? cell.textContent ?? '').trim();
    const n = parseFloat(raw.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) && /[0-9]/.test(raw) ? n : raw.toLowerCase();
  };
  rows.sort((a, b) => {
    const x = val(a), y = val(b);
    if (typeof x === 'number' && typeof y === 'number') return dir === 'asc' ? x - y : y - x;
    return dir === 'asc' ? String(x).localeCompare(String(y)) : String(y).localeCompare(String(x));
  });
  for (const r of rows) body.appendChild(r);
  for (const th of table.tHead?.rows[0]?.cells || []) th.removeAttribute('aria-sort');
  const th = table.tHead?.rows[0]?.cells[colIndex];
  if (th) th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
}

export function bindSort(table, key) {
  if (!table || !table.tHead) return;
  const remembered = state.boardSort[key];
  [...table.tHead.rows[0].cells].forEach((th, i) => {
    th.dataset.sort = '';
    th.tabIndex = 0;
    th.addEventListener('click', () => {
      const cur = state.boardSort[key];
      const dir = cur && cur.col === i && cur.dir === 'desc' ? 'asc' : 'desc';
      state.boardSort[key] = { col: i, dir };
      sortTable(table, i, dir);
    });
  });
  if (remembered) sortTable(table, remembered.col, remembered.dir);
}

/* --- 9.3 MGRS ------------------------------------------------------------
   A complete WGS84 → UTM → MGRS conversion. Military staff read grid, not
   decimal degrees, so every point on this screen has one. */
const BAND = 'CDEFGHJKLMNPQRSTUVWX';
const COL_SET = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROW_SET = ['ABCDEFGHJKLMNPQRSTUV', 'FGHJKLMNPQRSTUVABCDE'];

export function toMGRS(lat, lng, precision = 4) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '—';
  if (lat < -80 || lat > 84) return 'outside the grid';
  const rad = Math.PI / 180;
  let zone = Math.floor((lng + 180) / 6) + 1;
  // The two standard exceptions.
  if (lat >= 56 && lat < 64 && lng >= 3 && lng < 12) zone = 32;
  if (lat >= 72 && lat < 84 && lng >= 0 && lng < 42) zone = [31, 33, 35, 37][Math.floor((lng + 3) / 12)] || zone;
  const band = BAND[Math.floor((Math.max(-80, Math.min(83.9, lat)) + 80) / 8)];

  const a = 6378137, f = 1 / 298.257223563;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2), k0 = 0.9996;
  const lon0 = (zone - 1) * 6 - 180 + 3;
  const phi = lat * rad, lam = lng * rad, lam0 = lon0 * rad;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lam - lam0);
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));

  let easting = k0 * N * (A + (1 - T + C) * A ** 3 / 6
    + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  let northing = k0 * (M + N * Math.tan(phi) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
    + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720));
  if (lat < 0) northing += 10000000;

  // The 100 km square: the column set repeats every three zones.
  const colLetters = COL_SET[(zone - 1) % 3];
  const col = colLetters[Math.floor(easting / 100000) - 1];
  // The row set alternates between odd and even zones by a 500 km offset.
  const rowLetters = ROW_SET[(zone - 1) % 2];
  const row = rowLetters[Math.floor(northing / 100000) % 20];
  if (!col || !row) return '—';

  const p = Math.max(1, Math.min(5, precision));
  const div = 10 ** (5 - p);
  const e = String(Math.floor((easting % 100000) / div)).padStart(p, '0');
  const n = String(Math.floor((northing % 100000) / div)).padStart(p, '0');
  return `${zone}${band} ${col}${row} ${e} ${n}`;
}
export const grid = (lat, lng) => toMGRS(lat, lng, 4);

/* --- geometry ------------------------------------------------------------ */

export function distKm(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function bearing(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const y = Math.sin((lng2 - lng1) * rad) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lng2 - lng1) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/* --- small helpers used by every renderer -------------------------------- */

export const cls = (...xs) => xs.filter(Boolean).join(' ');
export const st = s => (s ? `st-${s}` : '');
export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function throttle(fn, ms) {
  let last = 0, timer = null;
  return (...a) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...a); }
    else if (!timer) timer = setTimeout(() => { timer = null; last = Date.now(); fn(...a); }, ms - (now - last));
  };
}
