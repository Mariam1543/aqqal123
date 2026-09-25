// The server. Serves public/ statically and the JSON API the picture consumes.
// The front end owns no data; everything on screen comes from here.

import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Sim } from './sim.js';
import {
  courses, strikeOption, targetFolder, hypotheses, exchange, intel,
  decisions, ribbon, watch, situations, LADDER,
} from './decide.js';
import { plan as agentPlan } from './agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4300;

const sim = new Sim();
setInterval(() => sim.tick(), 3000).unref?.();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.text({ type: ['text/*', 'application/octet-stream'], limit: '8mb' }));

// The role travels on every request; an order carries who made it.
app.use('/api', (req, res, next) => {
  req.role = req.get('X-CLP-Role') || 'commander';
  res.set('Cache-Control', 'no-store');
  next();
});

const snap = () => sim.snapshot();

// --- the picture ----------------------------------------------------------
app.get('/api/clp', (_req, res) => res.json(snap()));

app.get('/api/roles', (_req, res) => res.json([
  { id: 'commander', name: 'Commander', note: 'Decides. Sees every release and every warning.' },
  { id: 'cos', name: 'Chief of staff', note: 'Runs the estimate; cannot release national means.' },
  { id: 'log', name: 'Logistics staff', note: 'Owns the sustainment picture and the movement plan.' },
  { id: 'ops', name: 'Operations staff', note: 'Owns the plan and the targets.' },
  { id: 'watch', name: 'Watchkeeper', note: 'Reads only. Can acknowledge, not order.' },
]));

// --- mutations ------------------------------------------------------------
function ok(res, extra = {}) { res.json({ ok: true, simTime: new Date(sim.simTime).toISOString(), ...extra }); }

app.post('/api/scenario', (req, res) => {
  const id = req.body?.id;
  if (!sim.constructor && !id) return res.status(400).json({ error: 'id required' });
  const found = snap().scenarios.find(s => s.id === id);
  if (!found) return res.status(404).json({ error: 'no such posture' });
  sim.selectedScenario = id;
  sim.posture = found.name;
  sim.log('ORDER', `Measured posture set to ${found.name}. (${req.role})`);
  ok(res, { selectedScenario: id });
});

app.post('/api/speed', (req, res) => {
  const sp = Number(req.body?.speed);
  if (![1, 6, 24, 96].includes(sp)) return res.status(400).json({ error: 'speed must be 1, 6, 24 or 96' });
  sim.speed = sp;
  ok(res, { speed: sp });
});

app.post('/api/reset', (req, res) => { sim.reset(); ok(res); });

app.post('/api/routes/:id/status', (req, res) => {
  const r = sim.routes.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'no such route' });
  const st = req.body?.status;
  if (!['OPEN', 'RESTRICTED', 'CLOSED'].includes(st)) return res.status(400).json({ error: 'bad status' });
  r.status = st;
  sim.log('ORDER', `${r.name} set to ${st.toLowerCase()}. (${req.role})`);
  ok(res);
});

app.post('/api/reserves/:id/release', (req, res) => {
  const v = sim.reserves.find(x => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'no such reserve' });
  if (v.state !== 'held') return res.status(409).json({ error: 'already released' });
  v.state = 'moving'; v.progress = 0;
  sim.log('ORDER', `${v.name} released. (${req.role})`);
  ok(res);
});
app.post('/api/reserves/:id/recall', (req, res) => {
  const v = sim.reserves.find(x => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'no such reserve' });
  if (v.state === 'delivered') return res.status(409).json({ error: 'already delivered' });
  v.state = 'held'; v.progress = 0;
  sim.log('ORDER', `${v.name} recalled. (${req.role})`);
  ok(res);
});

app.post('/api/engineering/:id/complete', (req, res) => {
  const t = sim.engineering().tasks.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'no such task' });
  sim.works.push(t.id);
  if (t.route) { const r = sim.routes.find(x => x.id === t.route); if (r) r.status = 'OPEN'; }
  sim.log('ORDER', `Engineer task complete: ${t.name}. ${t.effect} (${req.role})`);
  ok(res);
});
app.get('/api/works', (_req, res) => res.json(sim.engineering()));
app.post('/api/works', (req, res) => { sim.log('ORDER', `Engineer task raised: ${req.body?.name || 'unnamed'}. (${req.role})`); ok(res); });

// --- the estimate ---------------------------------------------------------
app.get('/api/intel', (req, res) => res.json(intel(snap(), Number(req.query.hours) || 48)));
app.get('/api/decisions', (_req, res) => res.json(decisions(snap())));
app.get('/api/hypotheses', (req, res) => res.json(hypotheses(snap(), Number(req.query.rung) || 3)));
app.get('/api/situations', (_req, res) => res.json({ situations: situations(), ladder: LADDER }));
app.post('/api/exchange', (req, res) => res.json(exchange(snap(), {
  rung: Number(req.body?.rung) || 3, horizonDays: Number(req.body?.horizonDays) || 5,
})));
app.post('/api/decide', (req, res) => res.json(courses(snap(), {
  rung: Number(req.body?.rung) || 3,
  situation: req.body?.situation || 'raid',
  target: req.body?.target || null,
})));
app.post('/api/strike', (req, res) => {
  const o = strikeOption(snap(), { kind: req.body?.kind, id: req.body?.id, rung: Number(req.body?.rung) || 3 });
  if (!o) return res.status(404).json({ error: 'no such target' });
  res.json(o);
});
app.get('/api/target', (req, res) => {
  const f = targetFolder(snap(), req.query.kind, req.query.id);
  if (!f) return res.status(404).json({ error: 'no such target' });
  res.json(f);
});

app.post('/api/intent', (req, res) => {
  sim.intent = {
    courses: req.body?.courses || [], rung: req.body?.rung || 3,
    situation: req.body?.situation || 'raid', target: req.body?.target || null,
    by: req.role, at: new Date(sim.simTime).toISOString(),
  };
  sim.log('ORDER', `Commander's course set: ${(req.body?.courses || []).join(', ') || 'none'}. (${req.role})`);
  ok(res, { intent: sim.intent });
});
app.delete('/api/intent', (req, res) => { sim.intent = null; sim.log('ORDER', `Commander's course cleared. (${req.role})`); ok(res); });

// --- the plan -------------------------------------------------------------
app.post('/api/plan/assess', (req, res) => res.json(assessPlan(snap(), req.body || {})));
app.post('/api/plan/compare', (req, res) => {
  const s = snap();
  const plans = Array.isArray(req.body?.plans) ? req.body.plans : [];
  res.json({ plans: plans.map(p => ({ name: p.name || 'Untitled', assessment: assessPlan(s, p) })) });
});
app.post('/api/whatif', (req, res) => res.json(exchange(snap(), {
  rung: Number(req.body?.rung) || 3, horizonDays: Number(req.body?.horizonDays) || 5,
})));

// --- the wall and the brief ----------------------------------------------
app.get('/api/ribbon', (_req, res) => res.json(ribbon(snap())));
app.get('/api/agent/watch', (_req, res) => res.json({ findings: watch(snap()) }));
app.get('/api/agent/status', (_req, res) => res.json({ mode: 'idle', label: 'Standing by', speech: false }));
app.get('/api/case', (_req, res) => res.json(caseStudy(snap())));

// --- the agent ------------------------------------------------------------
app.post('/api/agent', (req, res) => {
  const messages = req.body?.messages || [];
  const last = messages.filter(m => m.role === 'user').pop();
  const frames = agentPlan(snap(), last?.content || '', req.body?.context || {});
  // No explicit Connection header: Node manages keep-alive for a chunked response,
  // and setting it by hand makes the socket close in a way the browser reports as an
  // aborted request even though every frame arrived.
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  let i = 0;
  const send = f => res.write(`data: ${JSON.stringify(f)}\n\n`);
  const timer = setInterval(() => {
    if (i >= frames.length) {
      clearInterval(timer);
      send({ type: 'done' });
      return res.end();
    }
    send(frames[i++]);
  }, 18);
  // The disconnect signal is on the RESPONSE. On the request, 'close' fires as soon as
  // the body has been read, which is before a single frame has gone out.
  res.on('close', () => clearInterval(timer));
});

app.post('/api/agent/act', (req, res) => {
  const id = String(req.body?.id || '');
  const [verb, a, b] = id.split(':');
  if (verb === 'release') {
    const v = sim.reserves.find(x => x.id === a);
    if (v && v.state === 'held') { v.state = 'moving'; v.progress = 0; sim.log('ORDER', `${v.name} released on the agent's proposal. (${req.role})`); }
  } else if (verb === 'strike') {
    sim.log('ORDER', `Engagement ordered against ${b || a}. (${req.role})`);
  } else {
    sim.log('ORDER', `Action applied: ${id}. (${req.role})`);
  }
  // What was on screen, and for how long, travels with the approval.
  ok(res, { applied: id, record: req.body?.record || null });
});

const guidance = [];
app.post('/api/guidance', (req, res) => {
  const name = req.get('X-File-Name') || 'guidance.txt';
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || '');
  const g = { id: `g-${guidance.length + 1}`, name, chars: body.length, at: new Date(sim.simTime).toISOString(), lines: body.split('\n').filter(Boolean).slice(0, 40) };
  guidance.push(g);
  sim.log('INFO', `Guidance uploaded: ${name}. Decision cards will be checked against it.`);
  res.json({ ok: true, guidance: g });
});
app.delete('/api/guidance/:id', (req, res) => {
  const i = guidance.findIndex(g => g.id === req.params.id);
  if (i >= 0) guidance.splice(i, 1);
  ok(res);
});
app.get('/api/guidance', (_req, res) => res.json({ guidance }));

// --- missions -------------------------------------------------------------
const mission = id => sim.missions.find(m => m.id === id);
app.post('/api/missions/:id/launch', (req, res) => {
  const m = mission(req.params.id); if (!m) return res.status(404).json({ error: 'no such mission' });
  m.state = 'airborne'; m.elapsed = 0; m.phase = 'launch'; m.leg = 0;
  sim.log('ORDER', `${m.name} released. (${req.role})`); ok(res);
});
app.post('/api/missions/:id/advance', (req, res) => {
  const m = mission(req.params.id); if (!m) return res.status(404).json({ error: 'no such mission' });
  m.elapsed = Math.min(m.endurance, m.elapsed + (Number(req.body?.hours) || 0.6));
  ok(res);
});
app.post('/api/missions/:id/abort', (req, res) => {
  const m = mission(req.params.id); if (!m) return res.status(404).json({ error: 'no such mission' });
  m.state = 'aborted'; m.phase = 'recovery';
  sim.log('ORDER', `${m.name} aborted. (${req.role})`); ok(res);
});
app.post('/api/missions/:id/analyse', (req, res) => {
  const m = mission(req.params.id); if (!m) return res.status(404).json({ error: 'no such mission' });
  for (const d of m.detections) if (d.status === 'new') d.status = 'reviewed';
  sim.log('ANALYSIS', `${m.name}: ${m.detections.length} detections reviewed. (${req.role})`); ok(res);
});
app.post('/api/missions/:id/engage', (req, res) => {
  const m = mission(req.params.id); if (!m) return res.status(404).json({ error: 'no such mission' });
  sim.log('ORDER', `${m.name} engaged ${m.target.name}. (${req.role})`); ok(res);
});
app.delete('/api/missions', (req, res) => {
  if (req.query.all === '1') sim.missions = [];
  else sim.missions = sim.missions.filter(m => m.state === 'airborne');
  ok(res);
});

app.post('/api/observations/:id/review', (req, res) => {
  for (const m of sim.missions) {
    const d = m.detections.find(x => x.id === req.params.id);
    if (d) { d.status = req.body?.status || 'reviewed'; d.by = req.body?.by || req.role; }
  }
  ok(res);
});
app.post('/api/tasks/:id/complete', (req, res) => { sim.log('ANALYSIS', `Collection task complete: ${req.params.id}. (${req.role})`); ok(res); });
app.post('/api/strikes/:id/release', (req, res) => { sim.log('ORDER', `Strike released: ${req.params.id}. (${req.role})`); ok(res); });
app.post('/api/strikes/:id/resolve', (req, res) => { sim.log('ANALYSIS', `Strike assessed: ${req.params.id}. (${req.role})`); ok(res); });

// --- voice ----------------------------------------------------------------
app.get('/api/voice/status', (_req, res) => res.json({ available: false, note: 'No speech model is configured for this deployment.' }));
app.post('/api/voice', (_req, res) => res.status(503).json({ error: 'no speech model configured' }));

// --- products -------------------------------------------------------------
app.get('/api/product/brief', (_req, res) => res.json(productBrief(snap())));
app.get('/api/product/folder', (req, res) => {
  const f = targetFolder(snap(), req.query.kind || 'oasset', req.query.id || 'oa-pin');
  if (!f) return res.status(404).json({ error: 'no such target' });
  res.json({ kind: 'folder', marking: snap().meta.classification, partner: null, folder: f, generated: new Date(sim.simTime).toISOString() });
});

// --- helpers --------------------------------------------------------------

function assessPlan(s, p) {
  const phases = Array.isArray(p.phases) ? p.phases : [];
  const assigned = Array.isArray(p.assigned) ? p.assigned : [];
  const units = s.units.filter(u => assigned.includes(u.id));
  const totalDays = phases.reduce((a, ph) => a + (Number(ph.days) || 0), 0) || 1;
  const gate = s.summary.gate;

  // What the assigned force needs, against what the command holds.
  const requirement = gate.classes.map(c => {
    const share = units.length ? units.length / s.units.length : 0.25;
    const need = totalDays * share;
    const have = c.days;
    return {
      cls: c.cls, name: c.name, short: c.short,
      requiredDays: need, heldDays: have, norm: c.norm,
      status: have >= need ? 'GREEN' : have >= need * 0.75 ? 'AMBER' : 'RED',
      shortfall: Math.max(0, need - have),
    };
  });

  const lift = s.movement.liftPerDay;
  const demandPerDay = units.reduce((a, u) => a + u.estab, 0) * 0.06;
  const readiness = units.map(u => ({
    id: u.id, name: u.name, strength: u.strength, days: u.sustainableDays,
    status: u.status, distanceKm: null,
    readyAtH: u.sustainableDays >= totalDays ? 'yes' : 'no',
  }));

  const risks = [];
  for (const r of requirement) if (r.status === 'RED')
    risks.push({ st: 'RED', text: `${r.name} does not carry the plan: ${r.heldDays.toFixed(1)} days held against ${r.requiredDays.toFixed(1)} required.`, figure: `${r.shortfall.toFixed(1)} d short` });
  if (demandPerDay > lift * 0.6)
    risks.push({ st: 'AMBER', text: 'The assigned force demands more than 60 per cent of theatre lift.', figure: `${Math.round(demandPerDay).toLocaleString('en')} t/d` });
  for (const rt of s.routes.filter(x => x.status !== 'OPEN'))
    risks.push({ st: rt.statusColour, text: `${rt.name} is ${rt.status.toLowerCase()} and supports this axis.`, figure: `-${Math.round(rt.capacityPerDay - rt.effectiveCapacity).toLocaleString('en')} t/d` });
  if (!phases.length) risks.push({ st: 'AMBER', text: 'No phases have been set; the requirement is assumed over one day.', figure: '1 d' });
  if (!units.length) risks.push({ st: 'AMBER', text: 'No formation is assigned; the requirement is a quarter of the command.', figure: '25%' });

  const verdict = risks.some(r => r.st === 'RED') ? 'INADEQUATE'
    : risks.length ? 'MARGINAL' : 'ADEQUATE';

  return {
    name: p.name || 'Untitled plan',
    mission: p.mission || '',
    totalDays, phases, assigned: units.map(u => ({ id: u.id, name: u.name, strength: u.strength, echelon: u.echelon })),
    requirement, readiness, risks, verdict,
    lift: { perDay: lift, demandPerDay, utilisation: lift ? demandPerDay / lift : 0 },
    decisions: [
      { name: 'Release the guided reserve', byDay: Math.max(1, Math.round(totalDays * 0.25)), owner: 'Theatre commander' },
      { name: 'Confirm the axis', byDay: Math.max(1, Math.round(totalDays * 0.1)), owner: 'Corps commander' },
      { name: 'Commit the reserve formation', byDay: Math.max(1, Math.round(totalDays * 0.6)), owner: 'Theatre commander' },
    ],
    annex: {
      title: 'Sustainment annex',
      lines: requirement.map(r => `${r.name}: ${r.heldDays.toFixed(1)} d held, ${r.requiredDays.toFixed(1)} d required — ${r.status.toLowerCase()}.`),
      lift: `Theatre lift is ${Math.round(lift).toLocaleString('en')} t/day; this plan demands ${Math.round(demandPerDay).toLocaleString('en')} t/day.`,
      limiting: `${gate.classes.find(c => c.cls === gate.limitingClass)?.name} is the limiting class at ${gate.sustainableDays.toFixed(1)} days.`,
    },
  };
}

function productBrief(s) {
  const g = s.summary.gate;
  return {
    kind: 'brief',
    marking: s.meta.classification,
    title: 'Decision brief — sustainment',
    command: s.meta.command,
    generated: new Date(sim.simTime).toISOString(),
    sections: [
      { heading: 'The picture', body: `The command holds ${g.sustainableDays.toFixed(1)} days at ${g.name.toLowerCase()} against ${g.requiredDays} required — ${g.verdict.toLowerCase()}. Forward it holds ${g.forwardDays.toFixed(1)} days.` },
      { heading: 'What limits it', body: `${s.meta.classes[g.limitingClass]?.name} at ${g.classes.find(c => c.cls === g.limitingClass)?.days.toFixed(1)} days, with a ${s.meta.classes[g.limitingClass]?.lead}-day replacement lead.` },
      { heading: 'Exposure', body: `${s.standoff.exposure.length} of our locations sit inside assessed reach; ${s.standoff.exposure.filter(e => e.status === 'RED').length} inside three or more systems.` },
      { heading: 'Decisions', body: decisions(s).slice(0, 3).map(d => `${d.name} — by ${new Date(d.by).toISOString().slice(11, 16)}Z, ${d.owner.toLowerCase()}.`).join(' ') },
    ],
    table: {
      head: ['Posture', 'Required', 'Held', 'Forward', 'Verdict'],
      rows: s.summary.scenarioMatrix.map(r => [r.name, r.requiredDays + ' d', r.sustainableDays.toFixed(1) + ' d', r.forwardDays.toFixed(1) + ' d', r.verdict]),
    },
  };
}

function caseStudy(s) {
  return {
    title: 'May 2025 — the week the eastern axis closed',
    note: 'A worked example. The figures are the picture as it stood, replayed step by step.',
    steps: [
      { id: 1, at: '2025-05-06T04:00:00Z', title: 'A quiet picture', text: 'Both forward depots above 80 per cent. The eastern axis is open. Nothing on the screen is red.', select: null, board: null, force: 'own' },
      { id: 2, at: '2025-05-07T21:40:00Z', title: 'The bridge goes', text: 'A single culvert failure closes the Gujrat Axis. Lift falls by 1 800 tonnes a day and nothing else changes — yet.', select: 'route:r-gjr', board: 'movement', force: 'own' },
      { id: 3, at: '2025-05-09T06:00:00Z', title: 'The forward depot starts to draw down', text: 'Gujrat is now fed only from the north. Fill falls four points a day. The command figure has not moved.', select: 'node:n-gjr', board: 'sustainability', force: 'own' },
      { id: 4, at: '2025-05-10T14:20:00Z', title: 'Their fires move west', text: 'The assessed Pinaka Group displaces 14 km. Jhelum and Gujrat are now both inside its reach.', select: 'oasset:oa-pin', board: null, force: 'both' },
      { id: 5, at: '2025-05-11T09:00:00Z', title: 'The decision that was not taken', text: 'The reserve was not released, because the command figure still read adequate. The forward figure had been inadequate for three days.', select: 'reserve:v-01', board: 'sustainability', force: 'own' },
      { id: 6, at: '2025-05-12T18:00:00Z', title: 'What it cost', text: '9 Infantry Division fell to six days of fuel and the counter-attack option lapsed. The stock existed the whole time; it was 340 km away.', select: 'unit:u-9inf', board: 'ladder', force: 'own' },
    ],
    lesson: 'A command figure that reads adequate can hide a forward figure that does not. The picture shows both for that reason.',
  };
}

// --- static ---------------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public'), {
  extensions: ['html'],
  setHeaders: r => r.set('Cache-Control', 'no-cache'),
}));
app.use((req, res) => res.status(404).json({ error: 'not found', path: req.path }));

export { app, sim };

if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  app.listen(PORT, () => console.log(`CLP on http://localhost:${PORT}`));
}
