// The estimate. Courses of action, the escalation ladder, strike options, target folders.
// Everything here is generated from the live picture so an answer can never disagree with it.

import { distKm } from './sim.js';
import { META } from './seed.js';

export const LADDER = [
  { rung: 1, name: 'Posture and signalling',   band: 'below threshold', likelihood: 0.34, note: 'Movement, readiness, declaratory statements. Nothing crosses.' },
  { rung: 2, name: 'Non-kinetic pressure',     band: 'below threshold', likelihood: 0.26, note: 'Electronic and cyber effect, interdiction of shipping, economic measures.' },
  { rung: 3, name: 'Shallow standoff fires',   band: 'conventional',    likelihood: 0.19, note: 'Guided fires against military targets within 40 km of the line.' },
  { rung: 4, name: 'Deep fires',               band: 'conventional',    likelihood: 0.11, note: 'High-value systems and depots in operational depth.' },
  { rung: 5, name: 'Air campaign',             band: 'conventional',    likelihood: 0.06, note: 'Sustained air operations against bases and command nodes.' },
  { rung: 6, name: 'Ground offensive',         band: 'conventional',    likelihood: 0.03, note: 'Formations cross in strength on one or both axes.' },
  { rung: 7, name: 'Strategic exchange',       band: 'strategic',       likelihood: 0.01, note: 'Beyond the conventional threshold.' },
];

const SITUATIONS = [
  { id: 'raid',     name: 'Standoff raid on a forward depot',   rung: 3, lead: 'A guided raid has struck a forward depot; no crossing.' },
  { id: 'massing',  name: 'Assessed massing on the eastern axis', rung: 2, lead: 'Their strike corps is assessed to be closing on the eastern axis.' },
  { id: 'airfield', name: 'Strike on one of our air bases',      rung: 4, lead: 'An air base has been struck; sortie generation is degraded.' },
  { id: 'probe',    name: 'Probing action across the line',      rung: 2, lead: 'Company-strength probes on two crossings overnight.' },
  { id: 'interdict', name: 'Interdiction of a main supply route', rung: 3, lead: 'A main supply route has been interdicted in depth.' },
];

const TYPES = {
  Restraint:      { st: 'GREEN',   effect: 0.30, cost: 0.15, risk: 0.20 },
  Demonstrative:  { st: 'ACCENT',  effect: 0.48, cost: 0.30, risk: 0.34 },
  Proportionate:  { st: 'AMBER',   effect: 0.70, cost: 0.52, risk: 0.55 },
  Punitive:       { st: 'RED',     effect: 0.82, cost: 0.74, risk: 0.76 },
  Escalatory:     { st: 'HOSTILE', effect: 0.90, cost: 0.92, risk: 0.94 },
};

export function situations() { return SITUATIONS; }

// Their likely answers at a rung, with what each would cost us.
export function hypotheses(snap, rung = 3) {
  const opp = snap.opposing;
  const exposure = snap.standoff.exposure;
  const base = [
    { id: 'h-1', name: 'Counter-battery against our firing positions', rung: Math.max(3, rung), likelihood: 0.38,
      indicators: ['Counter-battery radar emissions increase', 'Their rocket groups displace forward', 'Artillery survey activity'],
      costsUs: 'Two firing positions suppressed for 6–12 hours; no loss of stock.',
      warning: '2–6 h' },
    { id: 'h-2', name: 'Guided strike on a forward depot', rung: Math.max(3, rung), likelihood: 0.27,
      indicators: ['Reconnaissance over our forward depots', 'Launcher movement inside 90 km', 'Emitter discipline tightens'],
      costsUs: exposure.length ? `${exposure[0].name}: ${exposure[0].holds}% of objective at risk.` : 'A forward depot at risk.',
      warning: '1–4 h' },
    { id: 'h-3', name: 'Interdiction of the eastern axis', rung: Math.max(2, rung - 1), likelihood: 0.18,
      indicators: ['Air activity along the axis', 'Loitering munitions released', 'Bridge reconnaissance'],
      costsUs: 'Gujrat Axis closed for 24–48 h; 1 800 t/day lost forward.',
      warning: '3–8 h' },
    { id: 'h-4', name: 'Strike corps moves to its assembly areas', rung: Math.max(4, rung), likelihood: 0.11,
      indicators: ['Rail loading at Jalandhar', 'Bridging brought forward', 'Corps signals move'],
      costsUs: `Decision on our reserve within ${opp.summary.fastestArmourHours} h.`,
      warning: '18–30 h' },
    { id: 'h-5', name: 'No military answer; diplomatic response only', rung: 1, likelihood: 0.06,
      indicators: ['No change in readiness', 'Statement within 6 h', 'Force posture unchanged'],
      costsUs: 'Nothing directly; the initiative stays with them.',
      warning: '—' },
  ];
  const total = base.reduce((s, h) => s + h.likelihood, 0);
  return base.map(h => ({ ...h, likelihood: h.likelihood / total, confidence: opp.meta.confidence }));
}

// The courses of action for a situation at a rung.
export function courses(snap, { rung = 3, situation = 'raid', target = null } = {}) {
  const sit = SITUATIONS.find(s => s.id === situation) || SITUATIONS[0];
  const gate = snap.summary.gate;
  const so = snap.standoff;
  const guided = snap.summary.gate.classes.find(c => c.cls === 'PGM');
  const exposure = so.exposure;

  const defs = [
    {
      id: 'coa-hold', name: 'Hold and harden', type: 'Restraint', rung: 1,
      statement: 'Make no kinetic answer. Disperse forward stock, harden what cannot move, and raise the readiness of air defence over the depots that carry the guided munitions.',
      means: 'No fires. Engineer effort and movement only.',
      cost: 'Two days of engineer effort; no munitions expended.',
      buys: 'Removes the target that the raid was aimed at. Keeps the initiative in their hands.',
      effectNote: 'Reduces exposed forward stock by roughly two thirds within 36 hours.',
      execution: [
        { phase: 'Immediate', text: 'Disperse guided stock at the two most exposed forward depots.' },
        { phase: 'H+12', text: 'Raise Kestrel AD Regiment to immediate readiness over Sargodh.' },
        { phase: 'H+36', text: 'Complete hardened shelter at Gujrat; resume normal issue.' },
      ],
      roe: 'Defensive fires only, on positive identification, inside our own airspace.',
      escalationProb: 0.06, strategicProb: 0.005,
    },
    {
      id: 'coa-demo', name: 'Demonstrative fires', type: 'Demonstrative', rung: 2,
      statement: 'Fire a limited, observed, declared engagement against an empty assessed dispersal area inside their territory. Say what was struck and why before they do.',
      means: `Shahin Battery A, ${Math.min(12, Math.round((guided?.days || 8)))} rounds guided.`,
      cost: '12 guided rounds; roughly a day and a half of the guided holding at the measured posture.',
      buys: 'Demonstrates reach and will without casualties. Leaves them a way down.',
      effectNote: 'No material effect intended. The message is the effect.',
      execution: [
        { phase: 'H-2', text: 'Confirm the area is empty by unmanned reconnaissance.' },
        { phase: 'H', text: 'Engage with 12 rounds, observed.' },
        { phase: 'H+1', text: 'Public statement naming the target and the reason.' },
      ],
      roe: 'One engagement only. No target within 5 km of a populated place.',
      escalationProb: 0.14, strategicProb: 0.01,
    },
    {
      id: 'coa-prop', name: 'Proportionate counter-battery', type: 'Proportionate', rung: 3,
      statement: 'Engage the group assessed to have fired, and only that group, with guided fires. Match the weight of the raid; do not exceed it.',
      means: `Shahin Batteries A and B, 28–36 rounds guided against ${target ? target : 'the assessed Pinaka Group'}.`,
      cost: `32 guided rounds — ${((32 / 12) * 1).toFixed(1)} days of the guided holding. Leaves ${((guided?.days || 11.5) - 2.7).toFixed(1)} days.`,
      buys: 'Removes the system that struck us and answers at the same rung.',
      effectNote: 'Assessed 60–70 per cent of the group rendered ineffective for 5–10 days.',
      execution: [
        { phase: 'H-4', text: 'Confirm the firing group by unmanned reconnaissance and emitter fix.' },
        { phase: 'H-1', text: 'Kestrel AD to immediate readiness; expect counter-battery.' },
        { phase: 'H', text: 'Engage; scoot both batteries within 8 minutes.' },
        { phase: 'H+2', text: 'Battle damage assessment; decide on a second engagement.' },
      ],
      roe: 'Military target, positively identified, outside 3 km of a populated place. One engagement, then reassess.',
      escalationProb: 0.31, strategicProb: 0.02,
      hard: false,
    },
    {
      id: 'coa-deep', name: 'Deep strike on the launch base', type: 'Punitive', rung: 4,
      statement: 'Strike the base that generated the raid, not the launcher that fired it. Accept that this moves the exchange into operational depth.',
      means: 'Nasr Missile Group, 8 rounds, against an assessed air base at 320 km.',
      cost: '8 strategic-release rounds; 2 days of that holding. Requires national release.',
      buys: 'Degrades their ability to repeat for 2–3 weeks.',
      effectNote: 'Assessed one runway and two hardened shelters out for 14–20 days.',
      execution: [
        { phase: 'H-24', text: 'Seek national release; assemble the target folder.' },
        { phase: 'H-6', text: 'Suppress their long-range air defence corridor with electronic effect.' },
        { phase: 'H', text: 'Engage; 8 rounds, two aim points.' },
        { phase: 'H+4', text: 'Expect an answer at rung 4 or above; reserves to notice to move.' },
      ],
      roe: 'National release required. No target inside 8 km of a populated place.',
      escalationProb: 0.58, strategicProb: 0.07,
      hard: true,
      warnings: [
        { code: 'ESC-4', text: 'Moves the exchange into operational depth; assessed 58 per cent chance of a rung-4 or higher answer.', figure: '58%' },
        { code: 'SUS-PGM', text: `Guided holding falls below the norm at the measured posture.`, figure: `${((guided?.days || 11.5) - 2).toFixed(1)} d` },
        { code: 'REL-NAT', text: 'Requires national release; the decision is not the theatre commander’s.', figure: 'National' },
      ],
    },
    {
      id: 'coa-esc', name: 'Counter-force against the strike corps', type: 'Escalatory', rung: 5,
      statement: 'Engage the assessed strike corps in its assembly areas before it can move, accepting a general air campaign as the consequence.',
      means: 'Air component, two days of sorties; Babur Flight held at readiness.',
      cost: 'Roughly 90 guided rounds and 110 sorties over 48 hours. Guided holding will not support a second week.',
      buys: 'Delays their offensive option by 10–14 days if it succeeds.',
      effectNote: 'Assessed 30–40 per cent attrition of the leading brigade; the corps is not destroyed.',
      execution: [
        { phase: 'H-48', text: 'National release; mobilise the air component; disperse our own bases.' },
        { phase: 'H', text: 'Open with suppression of their long-range air defence.' },
        { phase: 'H+24', text: 'Sustained engagement of assembly areas.' },
        { phase: 'H+48', text: 'Reassess; the guided magazine will be the constraint, not the targets.' },
      ],
      roe: 'National release. General air campaign rules apply.',
      escalationProb: 0.79, strategicProb: 0.19,
      hard: true,
      warnings: [
        { code: 'ESC-5', text: 'Assessed 79 per cent chance of a general air campaign in answer.', figure: '79%' },
        { code: 'ESC-STRAT', text: 'Assessed 19 per cent chance the exchange passes the strategic threshold.', figure: '19%' },
        { code: 'SUS-PGM', text: 'Guided munitions do not support a second week at this rate.', figure: `${(guided?.days || 11.5).toFixed(1)} d held` },
        { code: 'SUS-FWD', text: `Forward holding is already ${gate.forwardVerdict.toLowerCase()} at the measured posture.`, figure: `${gate.forwardDays.toFixed(1)} d` },
      ],
    },
  ];

  const scored = defs.map(d => {
    const t = TYPES[d.type];
    // Effect is discounted by whether we can actually sustain it.
    const sustainPenalty = d.rung >= 4 && gate.verdict !== 'ADEQUATE' ? 0.12 : 0;
    const effect = Math.round((t.effect - sustainPenalty) * 100);
    const costScore = Math.round(t.cost * 100);
    const risk = Math.round(t.risk * 100);
    // One figure: effect earned, less what it costs and risks, and a bonus for answering at
    // the rung the situation actually sits on — under-answering cedes the initiative,
    // over-answering buys the next rung.
    const rungFit = Math.max(0, 16 - Math.abs(d.rung - sit.rung) * 8);
    const total = Math.round(effect * 0.5 + (100 - costScore) * 0.2 + (100 - risk) * 0.3 + rungFit);
    return {
      ...d,
      typeStatus: t.st,
      rungName: (LADDER.find(l => l.rung === d.rung) || {}).name,
      scores: { effect, cost: costScore, risk },
      total,
      held: d.rung >= 4,
      verdict: d.rung >= 4 && gate.verdict !== 'ADEQUATE' ? 'not sustainable beyond one week'
        : d.rung >= 3 ? 'sustainable' : 'no sustainment cost',
      targets: d.rung >= 3 ? targetsFor(snap, d.rung, target) : [],
      consequences: consequencesFor(snap, d),
      after: afterFor(d),
      grounding: grounding(snap, sit),
    };
  }).sort((a, b) => b.total - a.total).map((c, i) => ({ ...c, rank: i + 1 }));

  const staffPick = scored[0];
  return {
    situation: sit,
    situations: SITUATIONS,
    rung, rungName: (LADDER.find(l => l.rung === rung) || {}).name,
    ladder: LADDER,
    line: `${sit.lead} Measured against ${gate.name.toLowerCase()}: ${gate.sustainableDays.toFixed(1)} days held against ${gate.requiredDays} required, ${gate.verdict.toLowerCase()}. ${exposure.length} of our locations sit inside their reach.`,
    recommendation: {
      courseId: staffPick.id, by: 'staff', name: staffPick.name, total: staffPick.total,
      why: staffPick.rung === sit.rung
        ? `${staffPick.name} answers at the rung the situation sits on, and its cost is one the guided holding will carry more than once.`
        : staffPick.rung < sit.rung
          ? `${staffPick.name} answers below the rung the situation sits on. It cedes the initiative, but it is the only course the guided holding sustains.`
          : `${staffPick.name} answers above the rung the situation sits on. It buys the next rung as well as this one; the cost is that the exchange does not return to where it started.`,
      note: 'The staff recommendation is a reading of the picture, not an order. The commander decides.',
    },
    courses: scored,
    hypotheses: hypotheses(snap, rung),
    threat: threatForecast(snap),
  };
}

function targetsFor(snap, rung, focus) {
  const opp = snap.opposing;
  const pool = rung >= 4 ? opp.assets : opp.assets.filter(a => a.rangeKm <= 120);
  return pool.slice(0, 6).map(a => {
    const shooter = bestShooter(snap, a);
    return {
      kind: 'oasset', id: a.id, name: a.name, category: a.category,
      confidence: a.confidence, lat: a.lat, lng: a.lng,
      rangeKm: a.rangeKm,
      inReachOf: shooter ? shooter.name : null,
      reachMarginKm: shooter ? Math.round(shooter.rangeKm - distKm(shooter.lat, shooter.lng, a.lat, a.lng)) : null,
      focus: focus === a.id,
    };
  });
}

// The right system is the one that reaches the target at the lowest release authority, and
// among those, the tightest fit. Ranging a 700 km strategic missile onto a 75 km rocket group
// is reach, not a recommendation — it spends a national release on a corps commander's target.
const RELEASE_RANK = {
  'Formation commander': 0, 'Corps commander': 1, 'Air defence commander': 1,
  'Naval component': 2, 'Air component': 2, 'National authority': 3,
};

// One candidate pool, used by both the recommendation and the alternatives list. If these two
// ever disagree, the option names a system the alternatives say was the wrong choice.
export function shooterCandidates(snap, target) {
  return snap.assets
    .filter(a => a.rangeKm >= 10 && a.serviceable > 0)
    .map(a => ({ a, margin: a.rangeKm - distKm(a.lat, a.lng, target.lat, target.lng) }))
    .filter(x => x.margin >= 0)
    .sort((x, y) => {
      const r = (RELEASE_RANK[x.a.release] ?? 9) - (RELEASE_RANK[y.a.release] ?? 9);
      if (r !== 0) return r;
      return x.margin - y.margin;
    });
}
export function bestShooter(snap, target) {
  const c = shooterCandidates(snap, target);
  return c.length ? c[0].a : null;
}

function consequencesFor(snap, d) {
  const gate = snap.summary.gate;
  const out = [
    { label: 'Their most likely answer', text: d.rung <= 2 ? 'A statement; no military answer.' : d.rung === 3 ? 'Counter-battery against our firing positions.' : 'Deep fires against a base or a depot.' },
    { label: 'Guided holding after', text: `${Math.max(0, (gate.classes.find(c => c.cls === 'PGM')?.days || 11.5) - d.rung * 0.9).toFixed(1)} days at the measured posture.` },
    { label: 'Forward holding after', text: `${gate.forwardDays.toFixed(1)} days, unchanged — this course spends guided rounds, not forward stock.` },
    { label: 'Reserve decision', text: d.rung >= 4 ? 'The guided reserve must be released within 24 hours to hold the rate.' : 'No reserve decision required.' },
  ];
  return out;
}

function afterFor(d) {
  return d.rung <= 2
    ? 'The initiative stays with them. Expect the same situation again within a week.'
    : d.rung === 3
      ? 'Parity restored at this rung. Either side can stop here; neither has to.'
      : 'The exchange does not return to where it started. Plan for the next rung, not this one.';
}

function grounding(snap, sit) {
  const gate = snap.summary.gate;
  return [
    { label: 'Measured posture', value: `${gate.name}, ${gate.requiredDays} days required`, source: '/api/clp summary.gate' },
    { label: 'Guided holding', value: `${(gate.classes.find(c => c.cls === 'PGM')?.days || 0).toFixed(1)} d`, source: 'depot returns' },
    { label: 'Locations in their reach', value: `${snap.standoff.exposure.length}`, source: 'assessed system ranges' },
    { label: 'Assessment confidence', value: snap.opposing.meta.confidence, source: `as of ${snap.opposing.meta.asOfHours} h ago` },
    { label: 'Situation', value: sit.name, source: 'selected by the staff' },
  ];
}

export function threatForecast(snap) {
  const exposure = snap.standoff.exposure.slice(0, 5);
  return {
    exposed: exposure,
    moves: [
      { id: 'mv-1', name: 'Disperse guided stock at Gujrat', hours: 18, effect: 'Removes 62 per cent of the exposed guided holding.', cost: 'Two lift serials; no munitions.', status: 'AMBER' },
      { id: 'mv-2', name: 'Kestrel AD forward 30 km', hours: 6, effect: 'Brings Jhelum and Gujrat under the long-range umbrella.', cost: 'Uncovers Sargodh for 6 hours.', status: 'AMBER' },
      { id: 'mv-3', name: 'Harden the Gujrat issue point', hours: 216, effect: 'Permanent; the only move that survives a second raid.', cost: 'Nine days of engineer effort.', status: 'GREEN' },
      { id: 'mv-4', name: 'Move the forward issue point west 25 km', hours: 30, effect: 'Leaves their shallow fires; adds 40 minutes to every issue.', cost: 'Slower replenishment for the divisions in contact.', status: 'AMBER' },
    ],
    note: 'The forecast is what their systems can reach today, not what they intend.',
  };
}

// A strike option against one assessed site.
export function strikeOption(snap, { kind, id, rung = 3 }) {
  const pool = kind === 'onode' ? snap.opposing.nodes : kind === 'ounit' ? snap.opposing.units : snap.opposing.assets;
  const target = pool.find(t => t.id === id);
  if (!target) return null;
  const shooter = bestShooter(snap, target);
  // The alternatives are the same pool, in the same order, less the one already named.
  const alternatives = shooterCandidates(snap, target)
    .filter(x => x.a.id !== shooter?.id)
    .map(({ a, margin }) => ({
      id: a.id, name: a.name, category: a.category, rangeKm: a.rangeKm,
      marginKm: Math.round(margin), ttpMin: a.ttpMin,
      rounds: a.rounds.PGM || 0, release: a.release,
    }));

  const rounds = target.category === 'Air bases' ? 8 : target.rangeKm > 200 ? 6 : 12;
  const ad = snap.opposing.assets.filter(a => a.category === 'Air defence'
    && distKm(a.lat, a.lng, target.lat, target.lng) <= a.rangeKm);

  return {
    target: {
      kind, id: target.id, name: target.name, category: target.category || target.kind || target.type,
      lat: target.lat, lng: target.lng, confidence: target.confidence,
      asOfHours: snap.opposing.meta.asOfHours,
    },
    optimal: shooter ? {
      id: shooter.id, name: shooter.name, category: shooter.category,
      rounds, ttpMin: shooter.ttpMin, release: shooter.release,
      marginKm: Math.round(shooter.rangeKm - distKm(shooter.lat, shooter.lng, target.lat, target.lng)),
      serviceable: shooter.serviceable, held: shooter.held,
      lat: shooter.lat, lng: shooter.lng,
    } : null,
    alternatives: alternatives.slice(0, 5),
    defended: ad.map(a => ({ id: a.id, name: a.name, rangeKm: a.rangeKm, altKm: a.altKm, confidence: a.confidence })),
    roe: {
      release: shooter ? shooter.release : 'No system in reach',
      rules: ['Positively identified military target.', 'No aim point within 3 km of a populated place.', 'One engagement, then battle damage assessment.'],
      collateral: ad.length ? 'Defended; expect interception of a proportion of the salvo.' : 'Undefended at the assessed confidence.',
    },
    execution: shooter ? [
      { phase: 'H-4', text: 'Confirm the target by unmanned reconnaissance and emitter fix.' },
      { phase: 'H-1', text: `${shooter.name} to firing position; ${shooter.ttpMin} minutes to be in action.` },
      { phase: 'H', text: `Engage with ${rounds} rounds.` },
      { phase: 'H+8m', text: 'Scoot to the alternate position; expect counter-battery.' },
      { phase: 'H+2', text: 'Battle damage assessment; decide on a second engagement.' },
    ] : [],
    reaction: {
      theirs: 'Counter-battery against the firing position within 2–6 hours.',
      ours: 'Scoot within 8 minutes; Kestrel AD at immediate readiness over the position.',
    },
    why: shooter
      ? `${shooter.name} reaches it with ${Math.round(shooter.rangeKm - distKm(shooter.lat, shooter.lng, target.lat, target.lng))} km to spare and is released at ${shooter.release.toLowerCase()} — the lowest authority that can do it.`
      : 'Nothing in the inventory reaches this target from its present position.',
    escalation: {
      rung, rungName: (LADDER.find(l => l.rung === rung) || {}).name,
      above: rung >= 4 ? 0.52 : 0.28, strategic: rung >= 5 ? 0.14 : 0.02,
      answer: rung >= 4 ? 'Deep fires against one of our bases.' : 'Counter-battery against the firing position.',
    },
    after: rung >= 4
      ? 'The exchange does not return to where it started.'
      : 'Parity at this rung; either side can stop here.',
    cost: {
      rounds, cls: 'PGM',
      daysOfGuided: (rounds / 12).toFixed(1),
      remaining: ((snap.summary.gate.classes.find(c => c.cls === 'PGM')?.days || 11.5) - rounds / 12).toFixed(1),
    },
    grounding: [
      { label: 'Assessment', value: `${target.confidence || 'medium'} confidence`, source: `as of ${snap.opposing.meta.asOfHours} h ago` },
      { label: 'Reach', value: shooter ? `${shooter.name}, ${shooter.rangeKm} km` : 'none in reach', source: 'system ranges' },
      { label: 'Release', value: shooter ? shooter.release : '—', source: 'release matrix' },
    ],
  };
}

// The target folder behind a strike option or the terrain scene.
export function targetFolder(snap, kind, id) {
  const opt = strikeOption(snap, { kind, id, rung: 3 });
  if (!opt) return null;
  const t = opt.target;
  const jam = snap.assets.filter(a => a.category === 'Electronic warfare'
    && distKm(a.lat, a.lng, t.lat, t.lng) <= a.rangeKm * 1.4);
  const umbrella = snap.assets.filter(a => a.category === 'Air defence' && opt.optimal
    && distKm(a.lat, a.lng, opt.optimal.lat, opt.optimal.lng) <= a.rangeKm);
  return {
    ...opt,
    scene: {
      target: { name: t.name, lat: t.lat, lng: t.lng, kind: 'target' },
      shooter: opt.optimal ? { name: opt.optimal.name, lat: opt.optimal.lat, lng: opt.optimal.lng, kind: 'firing-position' } : null,
      path: opt.optimal ? [[opt.optimal.lat, opt.optimal.lng], [t.lat, t.lng]] : [],
      domes: opt.defended.map(a => {
        const src = snap.opposing.assets.find(x => x.id === a.id);
        return { name: a.name, lat: src.lat, lng: src.lng, radiusKm: a.rangeKm, altKm: Math.min(a.altKm || 20, 30), hostile: true };
      }),
      umbrella: umbrella.map(a => ({ name: a.name, lat: a.lat, lng: a.lng, radiusKm: a.rangeKm, altKm: Math.min(a.altKm || 20, 30), hostile: false })),
      jamming: jam.map(a => ({ name: a.name, lat: a.lat, lng: a.lng, radiusKm: a.rangeKm, altKm: Math.min(a.altKm || 5, 8), hostile: false })),
      scoot: opt.optimal ? { from: [opt.optimal.lat, opt.optimal.lng], to: [opt.optimal.lat - 0.09, opt.optimal.lng - 0.12], minutes: 8 } : null,
      counterBattery: opt.optimal ? { lat: t.lat, lng: t.lng, radiusKm: 90 } : null,
    },
    sequence: opt.optimal ? [
      { at: 'H-4:00', text: 'Reconnaissance confirms the target.' },
      { at: 'H-1:00', text: `${opt.optimal.name} occupies the firing position.` },
      { at: 'H+0:00', text: `Engage, ${opt.optimal.rounds} rounds.` },
      { at: 'H+0:08', text: 'Scoot complete.' },
      { at: 'H+2:00', text: 'Battle damage assessment.' },
    ] : [],
  };
}

// The exchange: their likely answer run against a copy of the picture, five days forward.
export function exchange(snap, { rung = 3, horizonDays = 5 } = {}) {
  const gate = snap.summary.gate;
  const before = {
    forwardDays: gate.forwardDays,
    commandDays: gate.sustainableDays,
    routesClosed: snap.summary.counts.routesClosed,
    guidedDays: gate.classes.find(c => c.cls === 'PGM')?.days || 0,
    sortiesPerDay: snap.air.sortiesPerDay,
  };
  // Their answer at this rung costs us lift, forward stock and sorties.
  const bite = 0.06 + rung * 0.055;
  const after = {
    forwardDays: before.forwardDays * (1 - bite * 1.4),
    commandDays: before.commandDays * (1 - bite * 0.55),
    routesClosed: Math.min(snap.routes.length, before.routesClosed + (rung >= 3 ? 1 : 0) + (rung >= 5 ? 1 : 0)),
    guidedDays: before.guidedDays * (1 - bite * 1.1),
    sortiesPerDay: Math.round(before.sortiesPerDay * (1 - bite * 0.8)),
  };
  return {
    rung, rungName: (LADDER.find(l => l.rung === rung) || {}).name, horizonDays,
    before, after,
    rows: [
      { label: 'Forward holding', before: before.forwardDays, after: after.forwardDays, unit: 'd', good: 'up' },
      { label: 'Command holding', before: before.commandDays, after: after.commandDays, unit: 'd', good: 'up' },
      { label: 'Routes closed', before: before.routesClosed, after: after.routesClosed, unit: '', good: 'down' },
      { label: 'Guided fire', before: before.guidedDays, after: after.guidedDays, unit: 'd', good: 'up' },
      { label: 'Sorties a day', before: before.sortiesPerDay, after: after.sortiesPerDay, unit: '', good: 'up' },
    ],
    note: `Their most likely answer at ${(LADDER.find(l => l.rung === rung) || {}).name.toLowerCase()}, run against a copy of the picture ${horizonDays} days forward.`,
  };
}

// Indicators: what would tell us which hypothesis is running.
export function intel(snap, hours = 48) {
  const now = new Date(snap.simTime).getTime();
  const rows = [
    { id: 'i-1', t: 2.2, kind: 'EMISSION', text: 'Fire-control emitter, intermittent, near the assessed Pinaka Group.', confidence: 0.71, supports: 'h-1', status: 'AMBER' },
    { id: 'i-2', t: 4.6, kind: 'IMAGERY', text: 'Launcher movement inside 90 km of the line, three vehicles revetted.', confidence: 0.82, supports: 'h-2', status: 'RED' },
    { id: 'i-3', t: 7.1, kind: 'MOVEMENT', text: 'Rail loading observed at the assessed Jalandhar depot.', confidence: 0.58, supports: 'h-4', status: 'AMBER' },
    { id: 'i-4', t: 11.4, kind: 'SIGNALS', text: 'Corps-level signals activity increased on the eastern axis.', confidence: 0.64, supports: 'h-4', status: 'AMBER' },
    { id: 'i-5', t: 14.8, kind: 'IMAGERY', text: 'Bridging brought forward to the assessed Amritsar depot.', confidence: 0.49, supports: 'h-4', status: 'AMBER' },
    { id: 'i-6', t: 19.2, kind: 'EMISSION', text: 'Counter-battery radar emissions, two fixes, eastern axis.', confidence: 0.77, supports: 'h-1', status: 'RED' },
    { id: 'i-7', t: 26.5, kind: 'MOVEMENT', text: 'Reconnaissance track over our forward depots, twice in six hours.', confidence: 0.69, supports: 'h-2', status: 'RED' },
    { id: 'i-8', t: 33.0, kind: 'SIGNALS', text: 'Emitter discipline tightened across the assessed XVI Corps.', confidence: 0.52, supports: 'h-2', status: 'AMBER' },
    { id: 'i-9', t: 41.7, kind: 'IMAGERY', text: 'No change at the assessed strike corps assembly areas.', confidence: 0.86, supports: 'h-5', status: 'GREEN' },
  ].filter(r => r.t <= hours);

  const tasks = [
    { id: 'tk-1', name: 'Confirm the Pinaka Group firing position', by: 'H+6', asset: 'Shahpar UAV Flight', status: 'open', answers: 'h-1' },
    { id: 'tk-2', name: 'Watch the Amritsar depot for bridging', by: 'H+18', asset: 'Imagery', status: 'open', answers: 'h-4' },
    { id: 'tk-3', name: 'Emitter fix on the long-range SAM', by: 'H+12', asset: 'Ibex EW Company', status: 'open', answers: 'h-2' },
  ];

  const hyps = hypotheses(snap, 3);
  for (const h of hyps) {
    h.indicatorsSeen = rows.filter(r => r.supports === h.id).length;
    h.indicatorsTotal = h.indicators.length;
  }

  return {
    hours,
    rows: rows.map(r => ({ ...r, at: new Date(now - r.t * 3600000).toISOString() })),
    tasks,
    hypotheses: hyps,
    summary: {
      observations: rows.length,
      red: rows.filter(r => r.status === 'RED').length,
      leading: hyps.slice().sort((a, b) => b.indicatorsSeen - a.indicatorsSeen)[0],
    },
  };
}

// The decisions board: what has to be decided, and by when.
export function decisions(snap) {
  const now = new Date(snap.simTime).getTime();
  const gate = snap.summary.gate;
  const mk = (id, name, hours, why, owner, status) => ({
    id, name, by: new Date(now + hours * 3600000).toISOString(), hoursLeft: hours,
    why, owner, status, late: hours < 6,
  });
  return [
    mk('d-1', 'Release the guided munition reserve', 9,
      `Forward guided holding is ${gate.forwardDays.toFixed(1)} days; the reserve takes 14 hours to be in effect.`,
      'Theatre commander', 'RED'),
    mk('d-2', 'Open or bypass the Rahim Axis', 22,
      '14 Infantry Division is fed through it; the repair is 2.5 days.', 'Chief engineer', 'AMBER'),
    mk('d-3', 'Move the Gujrat issue point west', 30,
      'It sits inside three assessed systems’ reach with 48 per cent of objective.', 'Corps commander', 'AMBER'),
    mk('d-4', 'Confirm the measured posture for the coming week', 54,
      `The ladder is ${gate.verdict.toLowerCase()} at ${gate.name.toLowerCase()}.`, 'Theatre commander', 'AMBER'),
    mk('d-5', 'Authorise the second lane at Chenab', 96,
      'Six days of engineer effort; restores 1 800 t/day to the eastern axis.', 'Chief engineer', 'GREEN'),
  ];
}

// The ribbon: the one line the wall carries.
export function ribbon(snap) {
  const gate = snap.summary.gate;
  const exposure = snap.standoff.exposure;
  const top = exposure[0];
  const co = courses(snap, { rung: 3, situation: 'raid' });
  return {
    rung: 3, rungName: (LADDER.find(l => l.rung === 3) || {}).name,
    rungStatus: 'AMBER',
    moment: `${snap.summary.issues.length} matters outstanding. ${gate.name}: ${gate.sustainableDays.toFixed(1)} d held against ${gate.requiredDays} required.`,
    forwardDays: gate.forwardDays,
    forwardStatus: gate.forwardVerdict === 'ADEQUATE' ? 'GREEN' : gate.forwardVerdict === 'MARGINAL' ? 'AMBER' : 'RED',
    postureName: gate.name,
    exposed: top ? { name: top.name, systems: top.systems, holds: top.holds, status: top.status } : null,
    recommendation: { name: co.recommendation.name, total: co.recommendation.total, by: 'staff' },
  };
}

// What the agent is watching — the wall ticker.
export function watch(snap) {
  const out = [];
  const gate = snap.summary.gate;
  out.push({ kind: 'sustainment', severity: gate.verdict === 'ADEQUATE' ? 'GREEN' : gate.verdict === 'MARGINAL' ? 'AMBER' : 'RED',
    title: `${gate.name}: ${gate.sustainableDays.toFixed(1)} days against ${gate.requiredDays} required`,
    action: `${META.classes[gate.limitingClass]?.name} is the limiting class. Forward holding is ${gate.forwardDays.toFixed(1)} days.`,
    select: null });
  for (const e of snap.standoff.exposure.slice(0, 3))
    out.push({ kind: 'exposure', severity: e.status, title: `${e.name} sits inside ${e.systems} assessed systems' reach`,
      action: `Holds ${e.holds} per cent of objective, ${e.depthKm} km inside the deepest.`, select: `node:${e.id}` });
  for (const i of snap.summary.issues.slice(0, 6))
    out.push({ kind: i.kind, severity: i.status, title: i.name, action: i.text, select: `${i.kind}:${i.id}` });
  return out;
}
