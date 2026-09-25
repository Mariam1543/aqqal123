// check-plan: the plan assessor must answer, and its answer must follow from
// the plan it was given.

import { app } from '../server/index.js';

let fails = 0;
const ok = (c, m) => { if (!c) { console.error('  FAIL', m); fails++; } };
const section = s => console.log('\n' + s);

const srv = app.listen(0);
await new Promise(r => srv.once('listening', r));
const base = `http://127.0.0.1:${srv.address().port}`;
const post = async (path, body) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const snap = await (await fetch(base + '/api/clp')).json();
const units = snap.units.map(u => u.id);

section('an empty plan still returns an assessment');
let r = await post('/api/plan/assess', {});
ok(r.status === 200, `empty plan returned ${r.status}`);
ok(r.json?.verdict, 'no verdict for an empty plan');
ok(r.json.risks.some(x => /no phases/i.test(x.text)), 'an empty plan did not flag its missing phases');
ok(r.json.risks.some(x => /no formation/i.test(x.text)), 'an empty plan did not flag its missing formations');
console.log(`  verdict ${r.json.verdict.toLowerCase()}, ${r.json.risks.length} risks raised`);

section('the requirement scales with the plan');
const small = await post('/api/plan/assess', { name: 'Small', phases: [{ name: 'A', type: 'move', days: 2 }], assigned: units.slice(0, 1) });
const big = await post('/api/plan/assess', { name: 'Big', phases: [{ name: 'A', type: 'move', days: 20 }], assigned: units });
ok(small.json.totalDays === 2 && big.json.totalDays === 20, 'totalDays does not follow the phases');
const smallReq = small.json.requirement.find(x => x.cls === 'PGM').requiredDays;
const bigReq = big.json.requirement.find(x => x.cls === 'PGM').requiredDays;
ok(bigReq > smallReq, `a bigger plan did not raise the requirement (${smallReq} vs ${bigReq})`);
ok(big.json.lift.demandPerDay > small.json.lift.demandPerDay, 'a bigger force did not demand more lift');
console.log(`  2 d / 1 formation needs ${smallReq.toFixed(1)} d; 20 d / ${units.length} formations needs ${bigReq.toFixed(1)} d`);

section('a plan the command cannot carry is judged inadequate');
ok(big.json.verdict === 'INADEQUATE', `a 20-day theatre-wide plan was judged ${big.json.verdict}`);
ok(big.json.risks.some(x => x.st === 'RED'), 'no red risk on a plan that cannot be carried');
const shortfalls = big.json.requirement.filter(x => x.shortfall > 0);
ok(shortfalls.length > 0, 'no class reported a shortfall');
console.log(`  ${shortfalls.length} classes short: ${shortfalls.map(x => x.short).join(', ')}`);

section('the annex says the same thing as the figures');
ok(big.json.annex.lines.length === big.json.requirement.length, 'the annex does not cover every class');
for (const req of big.json.requirement) {
  const line = big.json.annex.lines.find(l => l.startsWith(req.name));
  ok(line, `the annex has no line for ${req.name}`);
  if (line) ok(line.includes(req.status.toLowerCase()), `the annex disagrees with the status for ${req.name}`);
}
ok(big.json.annex.limiting.includes(snap.meta.classes[snap.summary.gate.limitingClass].name),
  'the annex names a different limiting class from the picture');
console.log(`  ${big.json.annex.lines.length} lines, each agreeing with its row`);

section('readiness and decisions follow the assignment');
ok(big.json.readiness.length === units.length, 'readiness does not cover every assigned formation');
ok(small.json.readiness.length === 1, 'readiness covered formations that were not assigned');
ok(big.json.decisions.every(d => d.byDay >= 1 && d.byDay <= big.json.totalDays), 'a decision falls outside the plan');
console.log(`  ${big.json.readiness.length} formations, ${big.json.decisions.length} decisions inside the plan's span`);

section('a closed route is carried into the risks');
ok(big.json.risks.some(x => /closed|restricted/i.test(x.text)), 'the closed route did not reach the plan risks');
console.log('  route status reaches the plan');

section('comparing plans');
r = await post('/api/plan/compare', { plans: [{ name: 'A', phases: [{ name: 'x', type: 'move', days: 3 }], assigned: units.slice(0, 2) }, { name: 'B', phases: [{ name: 'y', type: 'move', days: 9 }], assigned: units }] });
ok(r.status === 200 && r.json.plans?.length === 2, 'compare did not return both plans');
ok(r.json.plans[0].assessment.totalDays === 3 && r.json.plans[1].assessment.totalDays === 9, 'compare mixed the plans up');
console.log('  two plans compared, each keeping its own figures');

section('the assessor does not throw on rubbish');
for (const body of [{ phases: 'not an array' }, { assigned: 'nope' }, { phases: [{ days: 'x' }] },
  { phases: [{ name: null, type: null, days: null }], assigned: ['no-such-unit'] }, { name: 123 }]) {
  const rr = await post('/api/plan/assess', body);
  ok(rr.status === 200, `rubbish plan returned ${rr.status}`);
  ok(rr.json?.verdict, 'rubbish plan returned no verdict');
  const s = JSON.stringify(rr.json);
  ok(!/\bNaN\b/.test(s), `rubbish plan leaked NaN: ${JSON.stringify(body)}`);
  ok(!/\bundefined\b/.test(s), `rubbish plan leaked undefined: ${JSON.stringify(body)}`);
}
console.log('  5 malformed plans, each answered without throwing or leaking NaN');

srv.close();
console.log(fails ? `\ncheck-plan: ${fails} FAILED` : '\ncheck-plan: passed');
process.exit(fails ? 1 : 0);
