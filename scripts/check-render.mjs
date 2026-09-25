// check-render: run the REAL ES modules against a live snapshot under a minimal
// DOM stub, so any render-time error or leaked undefined / NaN surfaces here
// rather than in the browser.

import { installDom, registry } from './dom-stub.mjs';
const { } = installDom();

import { Sim } from '../server/sim.js';
import { courses, strikeOption, intel, decisions, exchange, targetFolder, LADDER } from '../server/decide.js';
import { plan as agentPlan } from '../server/agent.js';

const state_ = await import('../public/js/state.js');
const { state } = state_;
const charts = await import('../public/js/charts.js');
const symbols = await import('../public/js/symbols.js');
const rail = await import('../public/js/rail.js');
const detail = await import('../public/js/detail.js');
const boards = await import('../public/js/boards.js');
const decide = await import('../public/js/decide.js');
const planMod = await import('../public/js/plan.js');
const assistant = await import('../public/js/assistant.js');
const missionPanel = await import('../public/js/mission-panel.js');

let fails = 0;
const ok = (c, m) => { if (!c) { console.error('  FAIL', m); fails++; } };
const section = s => console.log('\n' + s);

const sim = new Sim();
for (let i = 0; i < 12; i++) sim.tick();
const snap = sim.snapshot();
state.data = snap;
state.layers = { force: 'own', emphasis: null, collapsed: false, sys: {}, ring: {}, osys: {}, oring: {},
  log: { depots: true, routes: true, formations: true, serials: true, reserves: true },
  olog: { depots: true, routes: true, formations: true }, oppMaster: true, basemap: 'imagery',
  hillshade: true, graticule: false, ringLabels: true };
for (const a of snap.assets) state.layers.sys[a.id] = true;

// Anything that reaches the reader must not carry these.
const LEAK = /\b(undefined|NaN|\[object Object\])\b/;
function check(name, html) {
  ok(typeof html === 'string', `${name} did not return a string`);
  if (typeof html !== 'string') return;
  const m = LEAK.exec(html);
  ok(!m, `${name} leaked "${m?.[0]}" — ${context(html, m?.index)}`);
  ok(html.length > 0, `${name} rendered nothing`);
  return html;
}
const context = (h, i) => (i == null ? '' : JSON.stringify(h.slice(Math.max(0, i - 70), i + 40)));
const read = id => registry.get(id)?.innerHTML ?? '';

section('the rail, in every force mode');
for (const force of ['own', 'opp', 'both']) {
  state.layers.force = force;
  rail.renderRail();
  check(`rail (${force})`, read('rail'));
}
state.layers.force = 'own';
console.log('  own, opposing and both render');

section('every detail renderer');
const kinds = [
  ['asset', snap.assets], ['node', snap.nodes], ['unit', snap.units], ['route', snap.routes],
  ['convoy', snap.convoys], ['reserve', snap.reserves], ['fires', snap.fires], ['platform', snap.platforms],
  ['oasset', snap.opposing.assets], ['onode', snap.opposing.nodes],
  ['ounit', snap.opposing.units], ['oroute', snap.opposing.routes],
];
let rendered = 0;
for (const [kind, pool] of kinds) {
  ok(pool.length > 0, `no ${kind} to render`);
  for (const o of pool) {
    state.selected = { kind, id: o.id };
    detail.renderDetail();
    check(`detail ${kind}:${o.id}`, read('detail'));
    rendered++;
  }
}
// the empty state
state.selected = null;
detail.renderDetail();
ok(read('detail').includes('Nothing selected'), 'the empty state did not render');
console.log(`  ${kinds.length} kinds, ${rendered} objects, plus the empty state`);

section('the assessed pass strips the own-side affordances');
for (const [kind, pool] of [['oasset', snap.opposing.assets], ['onode', snap.opposing.nodes], ['ounit', snap.opposing.units]]) {
  state.selected = { kind, id: pool[0].id };
  detail.renderDetail();
  const h = read('detail');
  ok(h.includes('assessed-banner'), `${kind}: no assessed banner`);
  ok(!/data-reserve-|data-route-status|data-assign=/.test(h), `${kind}: an own-side affordance survived`);
  ok(!/class="d-b fleet"|class="d-b fedby"|class="d-b supports"/.test(h), `${kind}: an own-side block survived`);
  if (kind !== 'ounit') ok(h.includes('data-strike'), `${kind}: no strike bar`);
}
state.selected = null;
console.log('  banner added, release / route / assign / fleet / fed-by all stripped');

section('every board, in both force modes');
state.intel = intel(snap, 48);
state.decisions = decisions(snap);
state.exchange = exchange(snap, { rung: 3 });
const co = courses(snap, { rung: 3, situation: 'raid' });
state.decideLadder = { ladder: co.ladder, rung: co.rung, rungName: co.rungName, courses: co.courses };
for (const [list, force] of [[boards.OWN_BOARDS, 'own'], [boards.OPP_BOARDS, 'opp']]) {
  state.layers.force = force;
  for (const [id] of list) {
    state.board = id;
    boards.renderBoard();
    check(`board ${id}`, read('board-body'));
  }
}
state.board = null; state.layers.force = 'own';
console.log(`  ${boards.OWN_BOARDS.length} own and ${boards.OPP_BOARDS.length} assessed boards`);

section('the boards survive missing side-data');
state.intel = null; state.decisions = null; state.exchange = null; state.decideLadder = null;
for (const id of ['intel', 'decisions', 'ladder', 'sustainability']) {
  state.board = id;
  boards.renderBoard();
  check(`board ${id} (no side-data)`, read('board-body'));
}
state.board = null;
console.log('  intel, decisions, ladder and sustainability render before their data arrives');

section('Decide');
decide.renderOptions();
check('decide (resting)', read('options'));
ok(read('options').includes('No decision on the table'), 'the resting state did not render');
state.estimate = co;
state.chosenCourse = co.courses[0].id;
decide.renderOptions();
check('decide (estimate)', read('options'));
for (const c of co.courses) {
  state.chosenCourse = c.id;
  decide.renderOptions();
  check(`decide course ${c.id}`, read('options'));
}
state.estimate = null;
for (const a of snap.opposing.assets) {
  state.strikeOption = strikeOption(snap, { kind: 'oasset', id: a.id, rung: 3 });
  decide.renderOptions();
  check(`strike option ${a.id}`, read('options'));
}
state.strikeOption = null;
console.log(`  resting, the estimate, ${co.courses.length} courses and ${snap.opposing.assets.length} strike options`);

section('Plan');
planMod.renderPlan();
ok(read('plan').includes('No plan drawn'), 'the empty plan state did not render');
state.plan = planMod.newPlan({ name: 'Test plan', mission: 'A mission' });
state.plan.assigned = [snap.units[0].id, snap.units[1].id];
const assessRes = await (await fetch('http://x/', {}).catch(() => null), Promise.resolve(null));
// assess() goes over the network; call the server's assessor directly instead
const { app } = await import('../server/index.js');
state.planAssessment = await new Promise(res => {
  const srv = app.listen(0, async () => {
    const port = srv.address().port;
    const r = await fetch(`http://127.0.0.1:${port}/api/plan/assess`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.plan) });
    res(await r.json());
    srv.close();
  });
});
planMod.renderPlan();
check('plan (assessed)', read('plan'));
state.plan.phases = [];
planMod.renderPlan();
check('plan (no phases)', read('plan'));
state.plan = null; state.planAssessment = null;
console.log('  empty, assessed, and with no phases');

section('the mission console');
missionPanel.renderMissionPanel();
check('mission panel', read('mission-body'));
const noMissions = { ...snap, missions: [] };
state.data = noMissions;
missionPanel.renderMissionPanel();
ok(read('mission-body').includes('No missions'), 'the no-missions state did not render');
state.data = snap;
console.log('  with missions and without');

section('the agent card family, every kind the server can send');
const questions = ['courses of action', 'how long do we last', 'what is exposed', 'strike the pinaka group',
  'what will they do next', 'release the reserve', 'the routes', 'the depots', 'the mission', 'the exchange', 'anything else'];
let cards = 0;
for (const q of questions) {
  const frames = agentPlan(snap, q, {});
  const card = frames.find(f => f.type === 'card');
  ok(card, `"${q}" produced no card`);
  if (!card) continue;
  cards++;
  const text = frames.filter(f => f.type === 'text').map(f => f.delta).join('');
  check(`agent text "${q}"`, text);
  // render the card through the real card renderer
  const html = assistant.md(text);
  check(`agent markdown "${q}"`, html);
  const json = JSON.stringify(card.card);
  ok(!LEAK.test(json.replace(/"(undefined|NaN)"/g, '')), `card for "${q}" carries undefined/NaN`);
}
console.log(`  ${cards} cards, each with text that renders`);

section('the markdown is safe');
const nasty = '<img src=x onerror=alert(1)> **bold** `code` <script>alert(2)</script>';
const out = assistant.md(nasty);
ok(!out.includes('<img'), 'markdown let an <img> through');
ok(!out.includes('<script'), 'markdown let a <script> through');
ok(out.includes('<strong>bold</strong>'), 'markdown did not render bold');
ok(out.includes('<code>code</code>'), 'markdown did not render code');
console.log('  html escaped first, structure applied after');

section('every chart, on real data');
const chartCalls = {
  sparkline: () => charts.sparkline(snap.history.map(h => h.dos.PGM), 'AMBER'),
  ringSvg: () => charts.ringSvg(snap.nodes[0].fill, snap.nodes[0].status, '62%', 'fill'),
  nodeRingSvg: () => charts.nodeRingSvg(snap.nodes[0].fill, snap.nodes[0].status),
  barChart: () => charts.barChart(snap.nodes.map(n => ({ name: n.name, value: n.fill * 100, target: 90, st: n.status }))),
  scenarioChart: () => charts.scenarioChart(snap.summary.scenarioMatrix),
  burndownChart: () => charts.burndownChart(snap.summary.projection),
  dofChart: () => charts.dofChart(snap.fires),
  timelineChart: () => charts.timelineChart({ history: snap.history.map(h => h.dos.III), projection: [3, 2, 1], norm: 10 }),
  groupedBars: () => charts.groupedBars(snap.summary.potential),
  deltaBars: () => charts.deltaBars(exchange(snap, { rung: 3 }).rows),
  gaugeBig: () => charts.gaugeBig(0.5, '11.5', 'held', 'days', 'AMBER'),
  magazineChart: () => charts.magazineChart(snap.standoff.own),
  ganttChart: () => charts.ganttChart({ phases: [{ name: 'Prepare', type: 'prepare', days: 2 }] }),
  ladderChart: () => charts.ladderChart({ ladder: LADDER, rung: 3, courseRung: 4 }),
};
for (const [name, fn] of Object.entries(chartCalls)) {
  let h; try { h = fn(); } catch (e) { ok(false, `${name} threw: ${e.message}`); continue; }
  check(`chart ${name}`, h);
  ok(h.includes('role="img"'), `${name} has no role="img"`);
  ok(h.includes('aria-label'), `${name} has no aria-label`);
}
// and on empty input, which is what they get before the first poll
for (const [name, fn] of Object.entries({
  barChart: () => charts.barChart([]), scenarioChart: () => charts.scenarioChart([]),
  burndownChart: () => charts.burndownChart([]), dofChart: () => charts.dofChart([]),
  groupedBars: () => charts.groupedBars([]), deltaBars: () => charts.deltaBars([]),
  magazineChart: () => charts.magazineChart([]), ganttChart: () => charts.ganttChart({ phases: [] }),
  ladderChart: () => charts.ladderChart({}), sparkline: () => charts.sparkline([]),
})) {
  let h; try { h = fn(); } catch (e) { ok(false, `${name} threw on empty input: ${e.message}`); continue; }
  ok(typeof h === 'string', `${name} did not return a string on empty input`);
  ok(!LEAK.test(h), `${name} leaked on empty input`);
}
console.log(`  ${Object.keys(chartCalls).length} charts on real data and on empty input`);

section('the symbol set');
for (const t of symbols.GLYPH_KEYS) {
  for (const aff of ['friendly', 'hostile', 'neutral', 'unknown', 'suspect']) {
    const svg = symbols.symbolSvg(t, aff, 22);
    check(`symbol ${t}/${aff}`, svg);
    ok(svg.includes('sym-halo'), `${t}/${aff}: no halo`);
  }
}
for (const e of ['squad', 'company', 'brigade', 'corps', 'army']) {
  const svg = symbols.symbolSvg('infantry', 'friendly', 22, { echelon: e });
  ok(svg.includes('viewBox="0 -7'), `${e}: the viewBox did not grow upward for the echelon marks`);
}
console.log(`  ${symbols.GLYPH_KEYS.length} glyphs x 5 affiliations, echelon marks grow the viewBox`);

section('formatters');
ok(state_.days(5.34) === '5.3' && state_.days(11.6) === '12', 'days() is wrong');
ok(state_.dtg('2026-09-25T14:30:00Z') === '251430Z SEP 26', 'dtg() is wrong');
ok(state_.dtg(null) === '—' && state_.num(null) === '—' && state_.days(null) === '—', 'formatters do not handle null');
ok(state_.esc('<b>&"') === '&lt;b&gt;&amp;&quot;', 'esc() is wrong');
ok(state_.toMGRS(32.4, 72.6).startsWith('43S'), 'MGRS zone is wrong');
ok(state_.toMGRS(NaN, 0) === '—', 'MGRS did not handle NaN');
ok(state_.fmtMin(45) === '45 min' && state_.fmtMin(3300) === '2 d 7 h', 'fmtMin is wrong');
ok(state_.worst('GREEN', 'RED') === 'RED', 'worst() is wrong');
console.log('  days, dtg, esc, MGRS, fmtMin and worst all hold, including on null');

console.log(fails ? `\ncheck-render: ${fails} FAILED` : '\ncheck-render: passed');
process.exit(fails ? 1 : 0);
