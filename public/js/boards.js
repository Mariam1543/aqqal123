// The deep boards. Composed from four primitives only: a KPI strip, panels,
// tables (always inside .scroll-x) and charts.

import {
  state, emit, esc, num, days, pct, dtg, setHtml, cls, st as stCls, bindSort,
  byId, classShort, className, statusOfRoute, verdictStatus, post, fmtMin, distKm,
} from './state.js';
import {
  barChart, scenarioChart, burndownChart, dofChart, timelineChart, groupedBars,
  deltaBars, gaugeBig, magazineChart, ladderChart, ringSvg, sparkline, legendRow,
} from './charts.js';

export const OWN_BOARDS = [
  ['assets', 'Systems'], ['sustainability', 'Sustainability'], ['standoff', 'Non-contact'],
  ['air', 'Air'], ['ladder', 'Escalation ladder'], ['intel', 'Indicators'],
  ['decisions', 'Decisions'], ['reserves', 'Reserves'], ['movement', 'Movement'],
  ['engineering', 'Engineering'],
];
export const OPP_BOARDS = [
  ['osystems', 'Their systems'], ['oreach', 'Our locations in their reach'],
  ['ostandoff', 'Their non-contact'], ['oair', 'Their air'],
  ['osustainability', 'Their sustainment'], ['ologistics', 'Their logistics'],
];

export const boardsFor = force => (force === 'opp' ? OPP_BOARDS : OWN_BOARDS);
export const isOppBoard = id => OPP_BOARDS.some(([k]) => k === id);

/* --- primitives ---------------------------------------------------------- */
const kpis = cells => `<div class="kpis">${cells.filter(Boolean).map(c =>
  `<div class="kpi ${stCls(c.st)}"${c.select ? ` data-select="${esc(c.select)}"` : ''}>
    <span class="k">${esc(c.label)}</span>
    <span class="v">${esc(c.value)}${c.unit ? `<span class="unit">${esc(c.unit)}</span>` : ''}</span>
    ${c.spark ? c.spark : ''}
    ${c.note ? `<span class="n">${esc(c.note)}</span>` : ''}
    ${c.trend ? `<span class="trend ${c.trend.good ? 'good' : c.trend.bad ? 'bad' : 'flat'}">${c.trend.dir} ${esc(c.trend.text)}</span>` : ''}
  </div>`).join('')}</div>`;

const panel = (title, body, opts = {}) => `<section class="panel" aria-label="${esc(title)}">
  <div class="panel-h"><b>${esc(title)}</b>${opts.right ? `<span class="r">${esc(opts.right)}</span>` : ''}
    ${opts.sub ? `<span class="sub note">${esc(opts.sub)}</span>` : ''}</div>
  <div class="panel-b ${opts.flush ? 'flush' : ''}">${body}${opts.note ? `<p class="note">${esc(opts.note)}</p>` : ''}</div>
</section>`;

function table(head, rows, key) {
  return `<div class="scroll-x"><table class="tbl" data-sort-key="${esc(key || '')}">
    <thead><tr>${head.map(h => `<th${h.num ? ' class="num"' : ''}>${esc(h.t ?? h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr class="${stCls(r.st)}"${r.select ? ` data-select="${esc(r.select)}" data-hover="${esc(r.select)}"` : ''}>
      ${r.cells.map(c => `<td class="${c.num ? 'num' : ''} ${c.st ? 'st-fig ' + stCls(c.st) : ''}"${c.v != null ? ` data-v="${esc(c.v)}"` : ''}>
        ${esc(c.t)}${c.sub ? `<span class="sub">${esc(c.sub)}</span>` : ''}</td>`).join('')}
    </tr>`).join('')}</tbody></table></div>`;
}

/* --- the boards ---------------------------------------------------------- */

export function renderBoard() {
  const host = document.getElementById('board-body');
  const titleEl = document.getElementById('board-title');
  const nav = document.getElementById('board-nav');
  const panelEl = document.getElementById('board');
  if (!host || !state.data) return;
  const id = state.board;
  panelEl.hidden = !id;
  if (!id) return;

  const force = state.layers?.force || 'own';
  const list = boardsFor(isOppBoard(id) ? 'opp' : 'own');
  const def = list.find(([k]) => k === id);
  titleEl.textContent = def ? def[1] : id;
  setHtml(nav, list.map(([k, n]) =>
    `<button class="${k === id ? 'is-on' : ''}" data-board="${esc(k)}">${esc(n)}</button>`).join(''));

  const fn = BOARDS[id];
  setHtml(host, fn ? fn(state.data) : `<p class="mute">No board.</p>`);

  // Sorting is remembered per board and re-applied after each redraw.
  for (const t of host.querySelectorAll('table.tbl')) bindSort(t, `${id}:${t.dataset.sortKey}`);
}

const BOARDS = {};

/* 1. Systems */
BOARDS.assets = d => {
  const a = d.assets;
  const bad = a.filter(x => x.status === 'RED' || x.status === 'BLACK');
  return kpis([
    { label: 'Systems held', value: String(a.length), note: `${new Set(a.map(x => x.category)).size} categories` },
    { label: 'Below three quarters', value: String(bad.length), st: bad.length ? 'RED' : 'GREEN', note: 'serviceable or rounds' },
    { label: 'Longest reach', value: num(Math.max(...a.map(x => x.rangeKm))), unit: 'km' },
    { label: 'Guided days of fire', value: days(d.standoff.summary.guidedDaysOfFire), unit: 'd', st: 'AMBER' },
  ]) +
  panel('Every system', table(
    ['System', 'Category', { t: 'Held', num: 1 }, { t: 'Svc', num: 1 }, { t: 'Reach', num: 1 }, { t: 'To action', num: 1 }, { t: 'Days of fire', num: 1 }],
    a.map(x => ({
      st: x.status, select: `asset:${x.id}`,
      cells: [
        { t: x.name }, { t: x.category },
        { t: num(x.held), num: 1, v: x.held }, { t: `${x.serviceable}`, num: 1, v: x.serviceable, st: x.status },
        { t: x.rangeKm ? num(x.rangeKm) : '—', num: 1, v: x.rangeKm },
        { t: x.ttpMin ? fmtMin(x.ttpMin) : '—', num: 1, v: x.ttpMin },
        { t: x.daysOfFire != null ? days(x.daysOfFire) : '—', num: 1, v: x.daysOfFire ?? -1, st: x.status },
      ],
    })), 'assets'), { flush: true, right: `${a.length} systems` }) +
  `<div class="grid-2">
    ${panel('Fleets', barChart(d.platforms.map(p => ({
      name: p.name, value: p.serviceability * 100, target: 90, st: p.status,
      display: `${p.serviceable}/${p.held}`,
    })), { label: 'Serviceability by fleet', labelW: 180 }), { note: 'The tick is the 90 per cent objective.' })}
    ${panel('Days of fire by nature', dofChart(d.fires), { note: 'A holding shorter than its replenishment lead cannot be replaced before it runs out.' })}
  </div>`;
};

/* 2. Sustainability */
BOARDS.sustainability = d => {
  const g = d.summary.gate;
  const ex = state.exchange;
  return kpis([
    { label: 'Command holding', value: days(g.sustainableDays), unit: 'd', st: verdictStatus(g.verdict), note: `${g.requiredDays} d required` },
    { label: 'Forward holding', value: days(g.forwardDays), unit: 'd', st: verdictStatus(g.forwardVerdict), note: 'where it is consumed' },
    { label: 'Limiting class', value: classShort(g.limitingClass), note: `${d.meta.classes[g.limitingClass]?.lead} d to replace` },
    { label: 'Verdict', value: g.verdict.toLowerCase(), st: verdictStatus(g.verdict), note: g.name.toLowerCase() },
  ]) +
  panel('Against every posture', scenarioChart(d.summary.scenarioMatrix), {
    note: 'The dashed rule is what each posture requires. The bar pair is command holding and forward holding.',
  }) +
  panel('By class', table(
    ['Class', { t: 'Command', num: 1 }, { t: 'Forward', num: 1 }, { t: 'Norm', num: 1 }, { t: 'Lead', num: 1 }, { t: 'Verdict', num: 0 }],
    g.classes.map(c => ({
      st: c.forwardStatus,
      cells: [
        { t: c.name }, { t: days(c.days), num: 1, v: c.days, st: c.status },
        { t: days(c.forwardDays), num: 1, v: c.forwardDays, st: c.forwardStatus },
        { t: `${c.norm} d`, num: 1, v: c.norm }, { t: `${c.lead} d`, num: 1, v: c.lead },
        // The verdict judges the class against its norm, which is a command-level
        // figure. Judging the forward holding against it would mark every row
        // inadequate — a column of red that says nothing about which class to act on.
        { t: c.days >= c.norm ? 'adequate' : c.days >= c.norm * 0.7 ? 'marginal' : 'inadequate',
          st: c.status },
      ],
    })), 'sust'), { flush: true }) +
  `<div class="grid-2">
    ${panel('Burn-down', burndownChart(d.summary.projection), { note: 'Share of today’s holding remaining across the horizon, one line per class.' })}
    ${panel('What a release would buy', groupedBars(d.summary.potential), { note: 'The violet is what releasing every held reserve of that class would add.' })}
  </div>` +
  // The exchange block: their most likely answer run against a copy of the picture.
  panel('The exchange', ex
    ? `${deltaBars(ex.rows)}<p class="note">${esc(ex.note)}</p>
       <div style="margin-top:10px"><button class="btn btn-sm" data-exchange="off">Back to the live picture</button></div>`
    : `<p class="mute" style="font-size:12.5px;margin-bottom:10px">Run their most likely answer at the current rung against a copy of the picture, five days forward.</p>
       <button class="btn btn-sm primary" data-exchange="3">Run the exchange</button>`,
    { right: ex ? 'a copy, not the picture' : '' });
};

/* 3. Non-contact */
BOARDS.standoff = d => {
  const s = d.standoff;
  return kpis([
    { label: 'Our longest reach', value: num(s.summary.ourLongest), unit: 'km', note: `${s.summary.ourSystems} systems` },
    { label: 'Their longest', value: num(s.summary.theirLongest), unit: 'km', st: 'AMBER', note: `${s.summary.theirSystems} assessed` },
    { label: 'Our locations exposed', value: String(s.summary.locationsExposed), st: 'AMBER', note: `${s.summary.locationsExposedRed} inside three or more` },
    { label: 'Guided days of fire', value: days(s.summary.guidedDaysOfFire), unit: 'd', st: 'AMBER' },
  ]) +
  panel('Our systems', table(
    ['System', 'Category', { t: 'Reach', num: 1 }, { t: 'Svc', num: 1 }, { t: 'Days of fire', num: 1 }, { t: 'Reaches', num: 1 }, 'Release'],
    s.own.map(o => ({
      st: o.status, select: `asset:${o.id}`,
      cells: [
        { t: o.name }, { t: o.category }, { t: num(o.rangeKm), num: 1, v: o.rangeKm },
        { t: `${o.serviceable}/${o.held}`, num: 1, v: o.serviceable },
        { t: o.daysOfFire != null ? days(o.daysOfFire) : '—', num: 1, v: o.daysOfFire ?? -1, st: o.status },
        { t: String(o.reaches), num: 1, v: o.reaches, st: o.reaches ? 'GREEN' : null },
        { t: o.release },
      ],
    })), 'so-own'), { flush: true, note: '"Reaches" counts assessed targets inside the system’s range from its present position.' }) +
  panel('Their systems', table(
    ['System', 'Category', { t: 'Reach', num: 1 }, { t: 'Held', num: 1 }, { t: 'Exposes', num: 1 }, 'Confidence'],
    s.theirs.map(o => ({
      st: 'HOSTILE', select: `oasset:${o.id}`,
      cells: [
        { t: o.name.replace(/\s*\(assessed\)/, '') }, { t: o.category },
        { t: num(o.rangeKm), num: 1, v: o.rangeKm }, { t: num(o.held), num: 1, v: o.held },
        { t: String(o.exposes), num: 1, v: o.exposes, st: o.exposes > 2 ? 'RED' : 'AMBER', sub: o.exposesNames.slice(0, 2).join(', ') },
        { t: o.confidence },
      ],
    })), 'so-theirs'), { flush: true }) +
  panel('Magazine depth', magazineChart(s.own), { note: 'The diamond is when a replacement would land. Past the bar the magazine is dry.' });
};

/* 4. Air */
BOARDS.air = d => {
  const a = d.air;
  return kpis([
    { label: 'Sorties a day', value: num(a.sortiesPerDay), note: `${a.bases.length} bases` },
    { label: 'Theirs', value: num(a.theirSortiesPerDay), st: 'AMBER', note: 'assessed' },
    { label: 'Ratio', value: a.ratio.toFixed(2), st: a.ratio >= 1 ? 'GREEN' : 'AMBER', note: 'ours to theirs' },
    { label: 'Interceptor days', value: a.interceptorDays != null ? days(a.interceptorDays) : '—', unit: 'd', st: 'AMBER', note: num(a.interceptorsHeld) + ' held' },
  ]) +
  panel('Our bases', table(
    ['Base', { t: 'Aircraft', num: 1 }, { t: 'Svc', num: 1 }, { t: 'Sorties/d', num: 1 }, { t: 'Guided', num: 1 }, { t: 'Days of fire', num: 1 }],
    a.bases.map(b => ({
      st: b.status, select: `asset:${b.id}`,
      cells: [
        { t: b.name }, { t: num(b.aircraft), num: 1, v: b.aircraft },
        { t: String(b.serviceable), num: 1, v: b.serviceable, st: b.status },
        { t: num(b.sortiesPerDay), num: 1, v: b.sortiesPerDay },
        { t: num(b.pgm), num: 1, v: b.pgm },
        { t: b.daysOfFire != null ? days(b.daysOfFire) : '—', num: 1, v: b.daysOfFire ?? -1, st: b.status },
      ],
    })), 'air'), { flush: true }) +
  `<div class="grid-2">
    ${panel('Sortie generation', barChart(a.bases.map(b => ({ name: b.name, value: b.sortiesPerDay, st: b.status })), { labelW: 170 }))}
    ${panel('Interceptor magazine', gaugeBig(
      Math.min(1, (a.interceptorDays || 0) / 12), days(a.interceptorDays), 'Interceptors', 'days at the current rate', 'AMBER', 150),
      { note: 'Air defence spends its magazine faster than anything else on the picture.' })}
  </div>`;
};

/* 5. Escalation ladder */
BOARDS.ladder = d => {
  const E = state.decideLadder || { ladder: [], rung: 3 };
  return kpis([
    { label: 'Where we are', value: 'R' + (E.rung || 3), st: 'AMBER', note: E.rungName || '' },
    { label: 'Rungs below the threshold', value: String((E.ladder || []).filter(r => r.band === 'below threshold').length) },
    { label: 'Their answer at this rung', value: pct((E.ladder || []).find(r => r.rung === E.rung)?.likelihood || 0), st: 'AMBER' },
    { label: 'Courses open', value: String(E.courses?.length || 0), note: 'from the estimate' },
  ]) +
  panel('The ladder', ladderChart(E), {
    note: 'Likelihood is the staff assessment of where an exchange settles, not a measurement.',
  }) +
  (E.ladder?.length ? panel('Rung by rung', table(
    ['Rung', 'Name', 'Band', { t: 'Likelihood', num: 1 }, 'What it is'],
    E.ladder.map(r => ({
      st: r.band === 'strategic' ? 'RED' : r.rung === E.rung ? 'AMBER' : 'GREEN',
      cells: [
        { t: 'R' + r.rung, num: 1, v: r.rung }, { t: r.name }, { t: r.band },
        { t: pct(r.likelihood), num: 1, v: r.likelihood },
        { t: r.note },
      ],
    })), 'ladder'), { flush: true })
    : panel('The ladder', `<p class="mute">Open Decide and ask for courses of action; the ladder is part of the estimate.</p>
      <button class="btn btn-sm primary" data-decide-run="1">Run the estimate</button>`));
};

/* 6. Indicators */
BOARDS.intel = d => {
  const i = state.intel;
  if (!i) return panel('Indicators', `<p class="mute">Reading the last 48 hours…</p>`);
  return kpis([
    { label: 'Observations', value: String(i.summary.observations), note: 'last 48 hours' },
    { label: 'Of concern', value: String(i.summary.red), st: i.summary.red ? 'RED' : 'GREEN' },
    { label: 'Leading course', value: i.summary.leading ? 'R' + i.summary.leading.rung : '—', st: 'AMBER',
      note: i.summary.leading ? i.summary.leading.name : '' },
    { label: 'Collection tasks', value: String(i.tasks.length), note: 'open' },
  ]) +
  panel('What has been seen', table(
    ['When', 'Kind', 'Observation', { t: 'Confidence', num: 1 }],
    i.rows.map(r => ({
      st: r.status,
      cells: [
        { t: dtg(r.at, false), num: 1, v: r.at }, { t: r.kind }, { t: r.text },
        { t: pct(r.confidence), num: 1, v: r.confidence, st: r.status },
      ],
    })), 'intel'), { flush: true, note: 'Machine and human reports alike. Nothing here is confirmed.' }) +
  panel('Their courses', table(
    ['Their course', { t: 'Likelihood', num: 1 }, { t: 'Rung', num: 1 }, { t: 'Indicators', num: 1 }, 'Warning', 'What it costs us'],
    i.hypotheses.map(h => ({
      st: h.likelihood > 0.3 ? 'RED' : h.likelihood > 0.15 ? 'AMBER' : 'GREEN',
      cells: [
        { t: h.name }, { t: pct(h.likelihood), num: 1, v: h.likelihood },
        { t: 'R' + h.rung, num: 1, v: h.rung },
        { t: `${h.indicatorsSeen}/${h.indicatorsTotal}`, num: 1, v: h.indicatorsSeen },
        { t: h.warning }, { t: h.costsUs },
      ],
    })), 'hyp'), { flush: true }) +
  panel('Collection tasks', table(
    ['Task', 'By', 'Asset', 'Answers'],
    i.tasks.map(t => ({
      st: 'AMBER',
      cells: [{ t: t.name }, { t: t.by }, { t: t.asset }, { t: (i.hypotheses.find(h => h.id === t.answers) || {}).name || '—' }],
    })), 'tasks'), { flush: true });
};

/* 7. Decisions */
BOARDS.decisions = d => {
  const rows = state.decisions || [];
  return kpis([
    { label: 'Decisions outstanding', value: String(rows.length), st: rows.some(r => r.late) ? 'RED' : 'AMBER' },
    { label: 'Inside six hours', value: String(rows.filter(r => r.late).length), st: 'RED' },
    { label: 'Commander’s', value: String(rows.filter(r => /commander/i.test(r.owner)).length) },
    { label: 'Next', value: rows[0] ? `${Math.round(rows[0].hoursLeft)} h` : '—', st: rows[0]?.status },
  ]) +
  panel('What has to be decided, and by when', table(
    ['Decision', 'By', { t: 'Hours left', num: 1 }, 'Owner', 'Why now'],
    rows.map(r => ({
      st: r.status,
      cells: [
        { t: r.name }, { t: dtg(r.by, false), num: 1, v: r.by },
        { t: String(Math.round(r.hoursLeft)), num: 1, v: r.hoursLeft, st: r.status },
        { t: r.owner }, { t: r.why },
      ],
    })), 'dec'), { flush: true, note: 'A decision with less time left than its effect takes to land has already been made by default.' });
};

/* 8. Reserves */
BOARDS.reserves = d => {
  const r = d.reserves;
  const held = r.filter(x => x.state === 'held');
  return kpis([
    { label: 'Held', value: String(held.length), note: `of ${r.length}` },
    { label: 'Moving', value: String(d.summary.counts.reservesMoving), st: 'AMBER' },
    { label: 'Delivered', value: String(d.summary.counts.reservesDelivered), st: 'GREEN' },
    { label: 'Fastest to effect', value: held.length ? String(Math.min(...held.map(x => x.effectHours))) : '—', unit: 'h' },
  ]) +
  panel('Every reserve', table(
    ['Reserve', 'Class', { t: 'Quantity', num: 1 }, 'State', { t: 'To effect', num: 1 }, { t: 'Returns', num: 1 }, 'Authority', ''],
    r.map(x => ({
      st: x.status, select: `reserve:${x.id}`,
      cells: [
        { t: x.name, sub: `${x.atName} → ${x.toName}` }, { t: classShort(x.cls) },
        { t: num(x.qty), num: 1, v: x.qty }, { t: x.state, st: x.status },
        { t: x.state === 'held' ? `${x.effectHours} h` : '—', num: 1, v: x.effectHours },
        { t: `${x.returnsDays} d`, num: 1, v: x.returnsDays },
        { t: x.authority },
        { t: '' },
      ],
    })), 'res'), { flush: true }) +
  panel('What a release would buy', groupedBars(d.summary.potential), {
    note: 'A released reserve is not replaced for weeks. Releasing it is a decision about the month, not the day.',
  }) +
  panel('Release', `<div class="d-acts">${held.map(x =>
    `<button class="btn btn-sm" data-reserve-release="${esc(x.id)}">Release ${esc(x.name.toLowerCase())}</button>`).join('') ||
    '<span class="mute">Every reserve has been released.</span>'}</div>`);
};

/* 9. Movement */
BOARDS.movement = d => {
  const m = d.movement;
  return kpis([
    { label: 'Lift a day', value: num(m.liftPerDay), unit: 't' },
    { label: 'Committed', value: pct(m.utilisation), st: m.status, note: num(m.committed) + ' t' },
    { label: 'Lost to closure', value: num(d.summary.liftBonus.lostToClosure), unit: 't', st: 'RED' },
    { label: 'Recoverable', value: num(d.summary.liftBonus.recoverable), unit: 't', st: 'AMBER', note: `${d.summary.liftBonus.tasks} engineer tasks` },
  ]) +
  panel('Routes', table(
    ['Route', 'Class', 'Status', { t: 'Capacity', num: 1 }, { t: 'Effective', num: 1 }, { t: 'Length', num: 1 }, { t: 'Serials', num: 1 }],
    d.routes.map(r => ({
      st: statusOfRoute(r.status), select: `route:${r.id}`,
      cells: [
        { t: r.name, sub: r.note || '' }, { t: r.cls },
        { t: r.status, st: statusOfRoute(r.status) },
        { t: num(r.capacityPerDay), num: 1, v: r.capacityPerDay },
        { t: num(r.effectiveCapacity), num: 1, v: r.effectiveCapacity, st: statusOfRoute(r.status) },
        { t: num(r.lengthKm), num: 1, v: r.lengthKm },
        { t: String(r.serials.length), num: 1, v: r.serials.length },
      ],
    })), 'routes'), { flush: true, note: 'Effective capacity is what a restricted route actually passes, not what it is rated at.' }) +
  panel('Serials in motion', table(
    ['Serial', 'Mode', 'Class', { t: 'Tonnes', num: 1 }, 'Route', { t: 'Progress', num: 1 }, { t: 'Arrives in', num: 1 }],
    d.convoys.map(c => ({
      st: c.status, select: `convoy:${c.id}`,
      cells: [
        { t: c.serial }, { t: c.mode }, { t: classShort(c.cls) },
        { t: num(c.tonnes), num: 1, v: c.tonnes }, { t: c.routeName },
        { t: pct(c.progress), num: 1, v: c.progress },
        { t: `${days(c.etaHours)} h`, num: 1, v: c.etaHours, st: c.status },
      ],
    })), 'serials'), { flush: true }) +
  panel('Capacity by route', barChart(d.routes.map(r => ({
    name: r.name, value: r.effectiveCapacity, target: r.capacityPerDay, st: statusOfRoute(r.status),
  })), { labelW: 170 }), { note: 'The tick is the rated capacity; the bar is what it passes today.' });
};

/* 10. Engineering */
BOARDS.engineering = d => {
  const e = d.engineering;
  const p = d.engineeringPicture;
  return kpis([
    { label: 'Tasks outstanding', value: String(e.tasks.length), st: e.tasks.length ? 'AMBER' : 'GREEN' },
    { label: 'Routes under repair', value: String(p.routesUnderRepair), st: 'AMBER' },
    { label: 'Bridging held', value: String(p.bridgingHeld), note: `${p.bridgingCommitted} committed` },
    { label: 'Lift recoverable', value: num(d.summary.liftBonus.recoverable), unit: 't/d', st: 'AMBER' },
  ]) +
  panel('Tasks', table(
    [{ t: 'Priority', num: 1 }, 'Task', { t: 'Days', num: 1 }, 'Effect', 'Status', ''],
    e.tasks.map(t => ({
      st: t.status,
      cells: [
        { t: String(t.priority), num: 1, v: t.priority }, { t: t.name },
        { t: days(t.daysToComplete), num: 1, v: t.daysToComplete },
        { t: t.effect }, { t: t.started ? 'in hand' : 'not started', st: t.status },
        { t: '' },
      ],
    })), 'engr'), { flush: true }) +
  panel('Complete a task', `<div class="d-acts">${e.tasks.map(t =>
    `<button class="btn btn-sm" data-engr-complete="${esc(t.id)}">${esc(t.name)}</button>`).join('') ||
    '<span class="mute">Nothing outstanding.</span>'}</div>`,
    { note: 'Completing a task reopens the route it serves.' }) +
  panel('Workshops', table(
    ['Workshop', { t: 'Capacity/wk', num: 1 }, { t: 'In work', num: 1 }, { t: 'Awaiting', num: 1 }, { t: 'Throughput', num: 1 }],
    d.workshops.map(w => ({
      st: w.status,
      cells: [
        { t: w.name }, { t: num(w.capacityPerWeek), num: 1, v: w.capacityPerWeek },
        { t: num(w.inWork), num: 1, v: w.inWork },
        { t: num(w.awaiting), num: 1, v: w.awaiting, st: w.awaiting > w.capacityPerWeek ? 'RED' : 'AMBER' },
        { t: pct(w.throughput), num: 1, v: w.throughput, st: w.status },
      ],
    })), 'ws'), { flush: true, note: 'Forward repair is where equipment waits longest, and it is the hardest to reinforce.' });
};

/* --- assessed boards ----------------------------------------------------- */

BOARDS.osystems = d => {
  const o = d.opposing;
  return kpis([
    { label: 'Systems assessed', value: String(o.assets.length), st: 'AMBER' },
    { label: 'Longest reach', value: num(o.summary.longestReachKm), unit: 'km', st: 'AMBER' },
    { label: 'Confidence', value: o.meta.confidence, note: `as of ${o.meta.asOfHours} h ago` },
    { label: 'Formations', value: String(o.units.length) },
  ]) +
  panel('Their systems', table(
    ['System', 'Category', { t: 'Held', num: 1 }, { t: 'Reach', num: 1 }, 'Confidence', 'Control'],
    o.assets.map(a => ({
      st: 'HOSTILE', select: `oasset:${a.id}`,
      cells: [
        { t: a.name.replace(/\s*\(assessed\)/, '') }, { t: a.category },
        { t: num(a.held), num: 1, v: a.held },
        { t: a.rangeKm ? num(a.rangeKm) : '—', num: 1, v: a.rangeKm },
        { t: a.confidence }, { t: a.control || '—' },
      ],
    })), 'osys'), { flush: true, note: 'An assessment is a snapshot, not a return. Assessed things do not tick.' });
};

BOARDS.oreach = d => {
  const ex = d.standoff.exposure;
  return kpis([
    { label: 'Locations exposed', value: String(ex.length), st: 'AMBER' },
    { label: 'Inside three or more', value: String(ex.filter(e => e.status === 'RED').length), st: 'RED' },
    { label: 'Deepest', value: ex.length ? num(Math.max(...ex.map(e => e.depthKm))) : '—', unit: 'km', st: 'RED' },
    { label: 'Stock at risk', value: ex.length ? `${Math.round(ex.reduce((s, e) => s + e.holds, 0) / ex.length)}%` : '—', note: 'average fill of the exposed' },
  ]) +
  panel('Our locations in their reach', table(
    ['Location', { t: 'Systems', num: 1 }, { t: 'Depth', num: 1 }, { t: 'Holds', num: 1 }, 'Which systems'],
    ex.map(e => ({
      st: e.status, select: `node:${e.id}`,
      cells: [
        { t: e.name }, { t: String(e.systems), num: 1, v: e.systems, st: e.status },
        { t: num(e.depthKm), num: 1, v: e.depthKm },
        { t: e.holds + '%', num: 1, v: e.holds },
        { t: e.by.map(b => b.name.replace(/\s*\(assessed\)/, '')).join(', ') },
      ],
    })), 'oreach'), { flush: true }) +
  panel('Exposure', barChart(ex.map(e => ({ name: e.name, value: e.systems, st: e.status, display: `${e.systems} systems` })), { labelW: 180 }));
};

BOARDS.ostandoff = d => BOARDS.standoff(d);
BOARDS.oair = d => {
  const o = d.opposing.assets.filter(a => a.category === 'Air bases');
  return kpis([
    { label: 'Bases assessed', value: String(o.length), st: 'AMBER' },
    { label: 'Their sorties a day', value: num(d.air.theirSortiesPerDay), st: 'AMBER' },
    { label: 'Ours', value: num(d.air.sortiesPerDay) },
    { label: 'Ratio', value: d.air.ratio.toFixed(2), st: d.air.ratio >= 1 ? 'GREEN' : 'AMBER' },
  ]) +
  panel('Their bases', table(
    ['Base', { t: 'Aircraft', num: 1 }, { t: 'Sorties/d', num: 1 }, { t: 'Reach', num: 1 }, 'Confidence'],
    o.map(a => ({
      st: 'HOSTILE', select: `oasset:${a.id}`,
      cells: [
        { t: a.name.replace(/\s*\(assessed\)/, '') }, { t: num(a.held), num: 1, v: a.held },
        { t: num(a.sorties || 0), num: 1, v: a.sorties },
        { t: num(a.rangeKm), num: 1, v: a.rangeKm }, { t: a.confidence },
      ],
    })), 'oair'), { flush: true });
};
BOARDS.osustainability = d => {
  const s = d.opposing.summary;
  return kpis([
    { label: 'Their endurance', value: String(s.sustainmentDays), unit: 'd', st: 'AMBER', note: 'assessed' },
    { label: 'Verdict', value: s.sustainmentVerdict.toLowerCase(), st: verdictStatus(s.sustainmentVerdict) },
    { label: 'Depots assessed', value: String(s.depots) },
    { label: 'Confidence', value: s.confidence },
  ]) +
  panel('Assessed depots', table(
    ['Depot', 'Kind', 'Echelon', 'Confidence'],
    d.opposing.nodes.map(n => ({
      st: 'HOSTILE', select: `onode:${n.id}`,
      cells: [{ t: n.name.replace(/\s*\(assessed\)/, '') }, { t: n.kind }, { t: n.echelon }, { t: n.confidence }],
    })), 'onodes'), { flush: true,
    note: 'Their holdings are estimates. We do not see their returns, so this figure carries a confidence and not a status.' });
};
BOARDS.ologistics = d => {
  const o = d.opposing;
  return kpis([
    { label: 'Depots', value: String(o.nodes.length), st: 'AMBER' },
    { label: 'Routes', value: String(o.routes.length) },
    { label: 'Formations', value: String(o.units.length) },
    { label: 'Confidence', value: o.meta.confidence },
  ]) +
  panel('Their routes', table(
    ['Route', 'Class', { t: 'Capacity', num: 1 }, { t: 'Length', num: 1 }, 'Status'],
    o.routes.map(r => ({
      st: 'HOSTILE', select: `oroute:${r.id}`,
      cells: [
        { t: r.name.replace(/\s*\(assessed\)/, '') }, { t: r.cls },
        { t: num(r.capacityPerDay), num: 1, v: r.capacityPerDay },
        { t: num(r.lengthKm), num: 1, v: r.lengthKm }, { t: r.status },
      ],
    })), 'oroutes'), { flush: true }) +
  panel('Their formations', table(
    ['Formation', 'Type', 'Echelon', { t: 'Strength', num: 1 }, 'Confidence'],
    o.units.map(u => ({
      st: 'HOSTILE', select: `ounit:${u.id}`,
      cells: [
        { t: u.name.replace(/\s*\(assessed\)/, '') }, { t: u.type }, { t: u.echelon },
        { t: pct(u.strength), num: 1, v: u.strength }, { t: u.confidence },
      ],
    })), 'ounits'), { flush: true });
};

export function openBoard(id) {
  state.board = id || null;
  emit('board-open', id);
  renderBoard();
}
