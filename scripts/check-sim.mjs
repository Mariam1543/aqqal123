// check-sim: the model's own arithmetic must hold, whatever the tick.
import { Sim, worst, statusOfDos, statusOfFill } from '../server/sim.js';
import { courses, strikeOption, targetFolder, exchange, intel, decisions, ribbon, watch, LADDER } from '../server/decide.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('  FAIL', msg); fails++; } };
const section = s => console.log('\n' + s);

const sim = new Sim();

section('the snapshot');
let snap = sim.snapshot();
const REQUIRED = ['meta', 'simTime', 'tick', 'posture', 'scenarios', 'selectedScenario', 'nodes', 'units',
  'routes', 'convoys', 'platforms', 'assets', 'fires', 'reserves', 'workshops', 'opposing', 'standoff',
  'air', 'engineeringPicture', 'medical', 'movement', 'engineering', 'personnel', 'fieldServices',
  'hostNation', 'demands', 'retrograde', 'history', 'events', 'missions', 'clock', 'summary'];
for (const k of REQUIRED) ok(snap[k] !== undefined, `/api/clp is missing "${k}"`);
const SUMMARY = ['classes', 'forwardClasses', 'echelons', 'gate', 'scenarioMatrix', 'issues', 'potential',
  'projection', 'forwardProjection', 'water', 'reporting', 'readiness', 'watchlist', 'functions', 'counts', 'liftBonus'];
for (const k of SUMMARY) ok(snap.summary[k] !== undefined, `summary is missing "${k}"`);
console.log(`  ${REQUIRED.length} top-level keys, ${SUMMARY.length} summary keys`);

section('endurance is set by the class that runs out first');
for (const r of snap.summary.scenarioMatrix) {
  const least = Math.min(...r.classes.map(c => c.days));
  ok(Math.abs(r.sustainableDays - least) < 1e-6, `${r.name}: sustainableDays ${r.sustainableDays} is not the minimum class ${least}`);
  const limiting = r.classes.find(c => c.cls === r.limitingClass);
  ok(limiting && Math.abs(limiting.days - r.sustainableDays) < 1e-6,
    `${r.name}: limitingClass ${r.limitingClass} is not the class the endurance comes from`);
  ok(['ADEQUATE', 'MARGINAL', 'INADEQUATE'].includes(r.verdict), `${r.name}: bad verdict ${r.verdict}`);
  const expect = r.sustainableDays >= r.requiredDays ? 'ADEQUATE'
    : r.sustainableDays >= r.requiredDays * 0.75 ? 'MARGINAL' : 'INADEQUATE';
  ok(r.verdict === expect, `${r.name}: verdict ${r.verdict} disagrees with ${r.sustainableDays.toFixed(1)}/${r.requiredDays}`);
  ok(r.forwardDays <= r.sustainableDays + 1e-6, `${r.name}: forward holding exceeds command holding`);
}
console.log(`  ${snap.summary.scenarioMatrix.length} postures, each internally consistent`);

section('the ladder has tension');
const verdicts = snap.summary.scenarioMatrix.map(r => r.verdict);
ok(new Set(verdicts).size > 1, 'every posture returns the same verdict — the ladder teaches nothing');
ok(verdicts.includes('INADEQUATE'), 'no posture is inadequate — nothing needs a decision');
console.log('  ' + snap.summary.scenarioMatrix.map(r => `${r.name}: ${r.verdict.toLowerCase()}`).join(', '));

section('no figure is NaN, undefined or negative where it cannot be');
(function walk(o, path = '') {
  if (o == null) return;
  if (typeof o === 'number') {
    ok(Number.isFinite(o), `${path} is ${o}`);
    return;
  }
  if (Array.isArray(o)) return o.forEach((v, i) => walk(v, `${path}[${i}]`));
  if (typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
})(snap);
for (const n of snap.nodes) ok(n.fill >= 0, `${n.name}: negative fill`);
for (const a of snap.assets) ok(a.serviceable <= a.held, `${a.name}: more serviceable than held`);
for (const r of snap.routes) ok(r.effectiveCapacity <= r.capacityPerDay, `${r.name}: effective capacity above rated`);
console.log('  every number finite; serviceability and capacity within bounds');

section('status maths');
ok(worst('GREEN', 'RED', 'AMBER') === 'RED', 'worst() did not pick RED');
ok(worst('GREEN', 'BLACK') === 'BLACK', 'worst() did not pick BLACK');
ok(worst() === 'GREEN', 'worst() of nothing is not GREEN');
ok(statusOfFill(0.95) === 'GREEN' && statusOfFill(0.8) === 'AMBER' && statusOfFill(0.6) === 'RED' && statusOfFill(0.2) === 'BLACK',
  'statusOfFill thresholds are wrong');
console.log('  worst() and statusOfFill hold');

section('the estimate');
for (const sit of ['raid', 'massing', 'airfield', 'probe', 'interdict']) {
  const co = courses(snap, { rung: 3, situation: sit });
  ok(co.courses.length >= 4, `${sit}: too few courses`);
  ok(co.courses.every((c, i) => i === 0 || c.total <= co.courses[i - 1].total), `${sit}: courses are not ranked`);
  ok(co.courses.every(c => c.rank === co.courses.indexOf(c) + 1), `${sit}: ranks do not match order`);
  ok(co.recommendation.courseId === co.courses[0].id, `${sit}: the recommendation is not the leading course`);
  ok(co.courses.filter(c => c.hard).every(c => c.warnings?.length), `${sit}: a hard course carries no warnings`);
  ok(co.courses.every(c => c.escalationProb >= 0 && c.escalationProb <= 1), `${sit}: bad escalation probability`);
}
console.log('  5 situations, each ranked with the recommendation leading');

section('a strike option names a system that actually reaches');
let checked = 0;
for (const a of snap.opposing.assets) {
  const o = strikeOption(snap, { kind: 'oasset', id: a.id, rung: 3 });
  ok(o, `no strike option for ${a.name}`);
  if (!o?.optimal) continue;
  checked++;
  ok(o.optimal.marginKm >= 0, `${a.name}: the named system does not reach it (${o.optimal.marginKm} km)`);
  // the lowest release authority that reaches it
  const RANK = { 'Formation commander': 0, 'Corps commander': 1, 'Air defence commander': 1, 'Naval component': 2, 'Air component': 2, 'National authority': 3 };
  const better = o.alternatives.filter(x => (RANK[x.release] ?? 9) < (RANK[o.optimal.release] ?? 9));
  ok(better.length === 0, `${a.name}: chose ${o.optimal.release} when ${better[0]?.release} also reaches`);
}
console.log(`  ${checked} targets, each matched to a reaching system at the lowest authority`);

section('the other endpoints answer');
for (const [name, fn] of [['exchange', () => exchange(snap, { rung: 3 })], ['intel', () => intel(snap, 48)],
  ['decisions', () => decisions(snap)], ['ribbon', () => ribbon(snap)], ['watch', () => watch(snap)],
  ['targetFolder', () => targetFolder(snap, 'oasset', 'oa-pin')]]) {
  let r;
  try { r = fn(); } catch (e) { ok(false, `${name} threw: ${e.message}`); continue; }
  ok(r != null, `${name} returned nothing`);
}
ok(LADDER.length >= 5 && LADDER.every(r => r.rung && r.name && r.band), 'the ladder is malformed');
console.log('  exchange, intel, decisions, ribbon, watch and the target folder all return');

section('the simulation stays sane over 400 ticks');
for (let i = 0; i < 400; i++) sim.tick();
snap = sim.snapshot();
for (const n of snap.nodes) {
  ok(n.fill >= 0 && n.fill < 2, `${n.name}: fill ran to ${n.fill}`);
  for (const c of n.classes) ok(c.held >= 0, `${n.name}/${c.cls}: negative stock`);
}
for (const u of snap.units) for (const c of u.classes) ok(c.days >= 0, `${u.name}/${c.cls}: negative days`);
for (const c of snap.convoys) ok(c.progress >= 0 && c.progress <= 1, `${c.serial}: progress out of range`);
for (const r of snap.summary.scenarioMatrix) ok(Number.isFinite(r.sustainableDays), `${r.name}: endurance went non-finite`);
ok(snap.history.length > 0 && snap.history.length <= 240, `history length is ${snap.history.length}`);
ok(snap.events.length > 0, 'nothing was logged over 400 ticks');
console.log(`  tick ${snap.tick}: stock, days and progress all in bounds; ${snap.events.length} events logged`);

console.log(fails ? `\ncheck-sim: ${fails} FAILED` : '\ncheck-sim: passed');
process.exit(fails ? 1 : 0);
