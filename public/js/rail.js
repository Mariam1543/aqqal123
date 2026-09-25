// The status rail (left drawer). Four blocks; the opposing rail replaces it
// entirely when the force switch is on Opposing.

import {
  state, emit, esc, num, days, pct, dtg, setHtml, cls, st as stCls,
  classShort, className, verdictStatus, statusOfDos, store,
} from './state.js';

export function renderRail() {
  const host = document.getElementById('rail');
  if (!host || !state.data) return;
  const force = state.layers?.force || 'own';
  const html = force === 'opp' ? assessmentRail() : ownRail(force === 'both');
  setHtml(host, html);
  host.setAttribute('aria-hidden', String(!document.body.classList.contains('rail-open')));
}

function ownRail(withOpposing) {
  const d = state.data;
  const s = d.summary;
  return (state.replay != null
    ? `<div class="replay-banner">Holdings as returned then; systems and reserves are live.</div>` : '') +
    (withOpposing ? opposingBlock() : '') +
    ladderBlock(s) + systemsBlock(d) + holdingsBlock(s) + reservesBlock(d);
}

/* --- 1. Sustainability — the ladder -------------------------------------- */
function ladderBlock(s) {
  const matrix = s.scenarioMatrix || [];
  const sel = state.data.selectedScenario;
  const current = matrix.find(r => r.id === sel);
  const hist = state.data.history || [];
  // a 24-hour delta on the measured row
  const then = hist.length > 24 ? hist[hist.length - 25] : hist[0];
  let delta = null;
  if (then && current) {
    const was = Math.min(...Object.values(then.dos));
    delta = current.sustainableDays - was;
  }

  return `<section class="blk">
    <div class="blk-h"><h2>Sustainability</h2><small>days held against required</small></div>
    ${matrix.map(r => {
      const stv = verdictStatus(r.verdict);
      const isSel = r.id === sel;
      return `<button class="ladder-row ${stCls(stv)} ${isSel ? 'is-sel' : ''}" data-scenario="${esc(r.id)}">
        <span class="fig">${days(r.sustainableDays)}<small>d</small></span>
        <span>
          <span class="nm">${esc(r.name)}${isSel ? ' · measured' : ''}${isSel && delta != null
            ? `<span class="delta ${delta >= 0 ? 'st-txt st-GREEN' : 'st-txt st-RED'}">${delta >= 0 ? '+' : ''}${days(Math.abs(delta))} d / 24 h</span>` : ''}</span>
          <span class="sl">${esc(r.verdict.toLowerCase())} · requirement ${r.requiredDays} d · ${days(r.forwardDays)} d forward · ${esc(classShort(r.limitingClass))} limits</span>
        </span>
      </button>`;
    }).join('')}
    <div class="ladder-row current st-GREEN" aria-disabled="true">
      <span class="fig">${days(s.gate.sustainableDays)}<small>d</small></span>
      <span><span class="nm">Current posture</span>
      <span class="sl">${esc(state.data.posture)} · as the command stands now</span></span>
    </div>
    <p class="note">Endurance is set by the class that runs out first, not by the average. A command figure that reads adequate can hide a forward figure that does not.</p>
  </section>`;
}

/* --- 2. Systems ---------------------------------------------------------- */
function systemsBlock(d) {
  const L = state.layers || {};
  const shown = d.assets.filter(a => L.sys?.[a.id]);
  const list = shown.length ? shown : d.assets;
  const byCat = new Map();
  for (const a of list) {
    if (!byCat.has(a.category)) byCat.set(a.category, []);
    byCat.get(a.category).push(a);
  }
  return `<section class="blk">
    <div class="blk-h"><h2>Systems</h2><small>${shown.length ? 'shown on the map' : 'all held'}</small></div>
    <div class="sys-head"><span>System</span><span>Svc/held</span><span>Reach</span><span>To action</span></div>
    ${[...byCat.entries()].map(([cat, items]) =>
      `<div class="sys-cat">${esc(cat)}</div>` +
      items.map(a => `<button class="sys-row ${stCls(a.status)}" data-select="asset:${esc(a.id)}" data-hover="asset:${esc(a.id)}">
        <span class="nm">${esc(a.name)}</span>
        <span class="v">${a.serviceable}/${a.held}</span>
        <span class="v">${a.rangeKm ? num(a.rangeKm) : '—'}</span>
        <span class="v">${a.ttpMin ? fmtTtp(a.ttpMin) : '—'}</span>
      </button>`).join('')).join('')}
  </section>`;
}
const fmtTtp = m => (m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`);

/* --- 3. Holdings — the classes that decide a fight ----------------------- */
const DECIDING = ['III', 'V', 'PGM', 'IX', 'I'];
function holdingsBlock(s) {
  const rows = DECIDING.map(c => s.classes.find(x => x.cls === c)).filter(Boolean);
  return `<section class="blk">
    <div class="blk-h"><h2>Holdings</h2><small>against the norm</small></div>
    ${rows.map(c => {
      // The bar is scaled to 1.5x the norm, so the norm sits at 66.7%.
      const scale = c.norm * 1.5;
      const w = Math.min(100, (c.days / scale) * 100);
      const fwd = Math.min(100, (c.forwardDays / scale) * 100);
      return `<button class="gauge ${stCls(c.status)}" data-board="sustainability" data-select-class="${esc(c.cls)}">
        <span class="g-n">${esc(c.short)}</span>
        <span class="meter"><i style="width:${w.toFixed(1)}%"></i><b style="left:66.7%"></b><em style="left:${fwd.toFixed(1)}%"></em></span>
        <span class="g-v">${days(c.days)}<span class="g-s">fwd ${days(c.forwardDays)}</span></span>
      </button>`;
    }).join('')}
    <p class="note">The bar is scaled to one and a half times the norm; the tick is the norm and the notch is the forward figure.</p>
  </section>`;
}

/* --- 4. Reserves --------------------------------------------------------- */
function reservesBlock(d) {
  const held = d.reserves.filter(r => r.state === 'held');
  const fastest = held.slice().sort((a, b) => a.effectHours - b.effectHours)[0];
  const returns = d.reserves.filter(r => r.state !== 'held');
  return `<section class="blk">
    <div class="blk-h"><h2>Reserves</h2><small>${held.length} held</small></div>
    <div class="res-row">${d.reserves.map(r =>
      `<button class="res-sq ${r.state}" data-select="reserve:${esc(r.id)}" title="${esc(r.name)} — ${esc(r.state)}" aria-label="${esc(r.name)}"></button>`).join('')}</div>
    <dl class="kv">
      <dt>Fastest to effect</dt><dd>${fastest ? fastest.effectHours + ' h' : '—'}</dd>
      <dt>Returns in</dt><dd>${returns.length} of ${d.reserves.length}</dd>
      <dt>Released</dt><dd>${d.summary.counts.reservesMoving + d.summary.counts.reservesDelivered}</dd>
    </dl>
    <p class="note">A reserve counts as held until it is in effect, not when it is ordered. A released reserve is not replaced for weeks.</p>
  </section>`;
}

/* --- Opposing forces block (force = Both) -------------------------------- */
function opposingBlock() {
  const o = state.data.opposing;
  const s = o.summary;
  return `<section class="blk hostile-blk">
    <div class="blk-h"><h2>Opposing forces</h2><small>assessed · ${esc(s.confidence)}</small></div>
    <dl class="kv">
      <dt>Strike corps</dt><dd>${s.strikeCorps}</dd>
      <dt>Fastest armour</dt><dd>${s.fastestArmourHours} h</dd>
      <dt>Longest reach</dt><dd>${num(s.longestReachKm)} km</dd>
      <dt>Formations</dt><dd>${s.formations}</dd>
      <dt>Systems</dt><dd>${s.systems}</dd>
    </dl>
    <p class="note">An assessment is a snapshot, not a return. Assessed things do not tick.</p>
  </section>`;
}

/* --- The assessment rail (force = Opposing) ------------------------------ */
function assessmentRail() {
  const d = state.data;
  const o = d.opposing;
  const s = o.summary;
  const exposure = d.standoff.exposure;
  const byCat = new Map();
  for (const a of o.assets) {
    if (!byCat.has(a.category)) byCat.set(a.category, []);
    byCat.get(a.category).push(a);
  }
  return `<section class="blk hostile-blk">
      <div class="blk-h"><h2>Assessment</h2><small>as of ${s.asOfHours} h ago</small></div>
      <dl class="kv">
        <dt>Strike corps</dt><dd>${esc(s.strikeCorpsName.replace(/\s*\(assessed\)/, ''))}</dd>
        <dt>Fastest armour to effect</dt><dd>${s.fastestArmourHours} h</dd>
        <dt>Longest reach</dt><dd>${num(s.longestReachKm)} km</dd>
      </dl>
      <p class="note">${esc(o.meta.note)}</p>
    </section>
    <section class="blk">
      <div class="blk-h"><h2>Formations</h2><small>${o.units.length} assessed</small></div>
      ${o.units.map(u => `<button class="sys-row st-HOSTILE" data-select="ounit:${esc(u.id)}" data-hover="ounit:${esc(u.id)}">
        <span class="nm">${esc(u.name.replace(/\s*\(assessed\)/, ''))}</span>
        <span class="v">${pct(u.strength)}</span><span class="v">${esc(u.echelon)}</span><span class="v">${esc(u.confidence)}</span>
      </button>`).join('')}
    </section>
    <section class="blk">
      <div class="blk-h"><h2>Systems</h2><small>${o.assets.length} assessed</small></div>
      <div class="sys-head"><span>System</span><span>Held</span><span>Reach</span><span>Conf</span></div>
      ${[...byCat.entries()].map(([cat, items]) => `<div class="sys-cat">${esc(cat)}</div>` +
        items.map(a => `<button class="sys-row st-HOSTILE" data-select="oasset:${esc(a.id)}" data-hover="oasset:${esc(a.id)}">
          <span class="nm">${esc(a.name.replace(/\s*\(assessed\)/, ''))}</span>
          <span class="v">${a.held}</span><span class="v">${a.rangeKm ? num(a.rangeKm) : '—'}</span>
          <span class="v">${esc(a.confidence)}</span></button>`).join('')).join('')}
    </section>
    <section class="blk">
      <div class="blk-h"><h2>Our locations in their reach</h2><small>${exposure.length}</small></div>
      ${exposure.map(e => `<button class="sys-row ${stCls(e.status)}" data-select="node:${esc(e.id)}" data-hover="node:${esc(e.id)}">
        <span class="nm">${esc(e.name)}</span><span class="v">${e.systems}</span>
        <span class="v">${num(e.depthKm)}km</span><span class="v">${e.holds}%</span>
      </button>`).join('')}
      <p class="note">What their systems can reach today, not what they intend.</p>
    </section>
    <section class="blk">
      <div class="blk-h"><h2>Their sustainment</h2><small>assessed</small></div>
      <dl class="kv">
        <dt>Endurance</dt><dd>${s.sustainmentDays} d</dd>
        <dt>Verdict</dt><dd>${esc(s.sustainmentVerdict.toLowerCase())}</dd>
        <dt>Depots assessed</dt><dd>${s.depots}</dd>
      </dl>
    </section>`;
}

export function toggleRail(force) {
  const open = force ?? !document.body.classList.contains('rail-open');
  document.body.classList.toggle('rail-open', open);
  document.getElementById('rail')?.setAttribute('aria-hidden', String(!open));
  const btn = document.getElementById('btn-rail');
  if (btn) btn.setAttribute('aria-expanded', String(open));
  state.railOpen = open;
  store('railOpen', open ? '1' : '0');
  emit('rail', open);
}
