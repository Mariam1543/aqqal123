// The decision agent. It answers from the picture and nothing else: every figure it says is
// read out of the snapshot it was handed. It names no model, anywhere.

import { courses, strikeOption, targetFolder, hypotheses, threatForecast, LADDER, bestShooter, exchange } from './decide.js';
import { distKm } from './sim.js';
import { META } from './seed.js';

const d1 = v => (v == null ? '—' : v < 10 ? v.toFixed(1) : Math.round(v).toString());
// "a, b and c" — not "a and b and c".
const list = xs => (xs.length <= 1 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

// --- intent ---------------------------------------------------------------

export function classify(text) {
  const t = (text || '').toLowerCase();
  const has = (...w) => w.some(x => t.includes(x));
  if (has('course of action', 'courses of action', 'coa', 'what are my options', 'what should i do', 'options'))
    return 'courses';
  if (has('strike', 'engage', 'hit ', 'target folder', 'attack'))
    return 'strike';
  if (has('what will they', 'what do they do', 'their answer', 'enemy course', 'hypothes', 'next move', 'react'))
    return 'hypotheses';
  if (has('how long', 'endurance', 'sustain', 'days of supply', 'holding', 'last'))
    return 'sustainment';
  if (has('exposed', 'in their reach', 'reach here', 'what reaches', 'threat', 'at risk'))
    return 'exposure';
  if (has('reserve', 'release'))
    return 'reserve';
  if (has('mission', 'drone', 'uav', 'detection', 'feed'))
    return 'mission';
  if (has('route', 'axis', 'road', 'rail', 'lift', 'movement', 'convoy', 'serial'))
    return 'movement';
  if (has('depot', 'stock', 'fill', 'node'))
    return 'depots';
  if (has('exchange', 'what if', 'whatif', 'five days'))
    return 'exchange';
  return 'brief';
}

// Which object the question is about, if it names one.
export function resolveMention(snap, text) {
  const t = (text || '').toLowerCase();
  const pools = [
    ['asset', snap.assets], ['node', snap.nodes], ['unit', snap.units], ['route', snap.routes],
    ['oasset', snap.opposing.assets], ['onode', snap.opposing.nodes], ['ounit', snap.opposing.units],
  ];
  let best = null;
  for (const [kind, pool] of pools) {
    for (const o of pool) {
      const name = (o.name || '').toLowerCase().replace(/\s*\(assessed\)\s*/, '');
      if (!name) continue;
      const key = name.split(/\s+/).slice(0, 2).join(' ');
      if (t.includes(name) || (key.length > 5 && t.includes(key))) {
        if (!best || name.length > best.name.length) best = { kind, id: o.id, name: o.name, obj: o };
      }
    }
  }
  return best;
}

// --- the answers ----------------------------------------------------------

function sustainmentCard(snap) {
  const g = snap.summary.gate;
  return {
    kind: 'scorecard',
    st: g.verdict === 'ADEQUATE' ? 'GREEN' : g.verdict === 'MARGINAL' ? 'AMBER' : 'RED',
    title: `${g.name}: ${d1(g.sustainableDays)} days held`,
    sub: `against ${g.requiredDays} days required · ${META.classes[g.limitingClass]?.name.toLowerCase()} limiting`,
    verdict: `The command holds ${d1(g.sustainableDays)} days at the measured posture against ${g.requiredDays} required — ${g.verdict.toLowerCase()}. Forward, where it is actually consumed, it holds ${d1(g.forwardDays)} days, which is ${g.forwardVerdict.toLowerCase()}. The gap between those two figures is the whole problem: the stock exists, it is not where the fighting is.`,
    kpis: [
      { label: 'Command holding', value: d1(g.sustainableDays), unit: 'd', st: g.verdict === 'ADEQUATE' ? 'GREEN' : g.verdict === 'MARGINAL' ? 'AMBER' : 'RED', note: `${g.requiredDays} d required` },
      { label: 'Forward holding', value: d1(g.forwardDays), unit: 'd', st: g.forwardVerdict === 'ADEQUATE' ? 'GREEN' : g.forwardVerdict === 'MARGINAL' ? 'AMBER' : 'RED', note: 'where it is consumed' },
      { label: 'Limiting class', value: META.classes[g.limitingClass]?.short || '—', note: `${META.classes[g.limitingClass]?.lead} d to replace` },
      { label: 'Routes not open', value: String(snap.summary.counts.routes - snap.summary.counts.routesOpen), st: snap.summary.counts.routesClosed ? 'RED' : 'AMBER', note: `of ${snap.summary.counts.routes}` },
    ],
    table: {
      head: ['Class', 'Command', 'Forward', 'Norm', 'Lead'],
      rows: g.classes.map(c => ({
        st: c.forwardStatus,
        cells: [
          { t: c.name, txt: true },
          { t: d1(c.days) + ' d', num: true, st: c.status },
          { t: d1(c.forwardDays) + ' d', num: true, st: c.forwardStatus },
          { t: c.norm + ' d', num: true },
          { t: c.lead + ' d', num: true, more: true },
        ],
      })),
    },
    sections: [
      { title: 'What sets the figure', body: `Endurance is set by the class that runs out first, not by the average. That class is ${META.classes[g.limitingClass]?.name.toLowerCase()}, at ${d1(g.classes.find(c => c.cls === g.limitingClass)?.days)} days. Replacing it takes ${META.classes[g.limitingClass]?.lead} days, so a decision to replenish taken today lands after the holding has already run down.` },
      { title: 'The ladder', body: snap.summary.scenarioMatrix.map(r => `${r.name}: ${d1(r.sustainableDays)} d against ${r.requiredDays} required — ${r.verdict.toLowerCase()}.`).join(' ') },
    ],
    note: 'Holdings are depot returns as at the last reporting hour; systems and reserves are live.',
  };
}

function exposureCard(snap) {
  const ex = snap.standoff.exposure;
  const top = ex[0];
  return {
    kind: 'force',
    st: ex.some(e => e.status === 'RED') ? 'RED' : 'AMBER',
    title: `${ex.length} of our locations sit inside their assessed reach`,
    sub: `${ex.filter(e => e.status === 'RED').length} inside three or more systems`,
    verdict: top
      ? `${top.name} is the most exposed: ${top.systems} assessed systems reach it, the deepest by ${top.depthKm} km, and it holds ${top.holds} per cent of its objective. The stock and the exposure are in the same place, which is the thing to change.`
      : 'Nothing of ours sits inside an assessed system’s reach.',
    kpis: [
      { label: 'Locations exposed', value: String(ex.length), st: 'AMBER' },
      { label: 'Inside three or more', value: String(ex.filter(e => e.status === 'RED').length), st: 'RED' },
      { label: 'Their longest reach', value: String(snap.standoff.summary.theirLongest), unit: 'km' },
      { label: 'Ours', value: String(snap.standoff.summary.ourLongest), unit: 'km' },
    ],
    table: {
      head: ['Location', 'Systems', 'Depth', 'Holds'],
      rows: ex.map(e => ({
        st: e.status, select: `node:${e.id}`,
        cells: [
          { t: e.name, txt: true },
          { t: String(e.systems), num: true, st: e.status },
          { t: e.depthKm + ' km', num: true },
          { t: e.holds + '%', num: true },
        ],
      })),
    },
    items: threatForecast(snap).moves.map(m => ({
      st: m.status, title: m.name,
      text: `${m.effect} ${m.cost}`,
      figure: m.hours >= 48 ? `${Math.round(m.hours / 24)} d` : `${m.hours} h`,
    })),
    note: 'The forecast is what their systems can reach today, not what they intend.',
    map: {
      rings: ex.flatMap(e => e.by.map(b => {
        const a = snap.opposing.assets.find(x => x.id === b.id);
        return a ? { lat: a.lat, lng: a.lng, radiusKm: a.rangeKm, label: a.name, hostile: true } : null;
      })).filter(Boolean).slice(0, 6),
      points: ex.slice(0, 5).map(e => ({ lat: e.lat, lng: e.lng, label: e.name, kind: 'exposed' })),
    },
  };
}

function coursesCard(snap, opts) {
  const co = courses(snap, opts);
  return {
    card: {
      kind: 'compare',
      st: 'ACCENT',
      title: `${co.courses.length} courses against ${co.situation.name.toLowerCase()}`,
      sub: `at ${co.rungName.toLowerCase()} · staff recommends ${co.recommendation.name.toLowerCase()}`,
      verdict: co.recommendation.why,
      table: {
        head: ['Course', 'Rung', 'Effect', 'Cost', 'Risk', 'Total'],
        rows: co.courses.map(c => ({
          st: c.typeStatus, select: null,
          cells: [
            { t: c.name, txt: true, sub: c.means },
            { t: 'R' + c.rung, num: true },
            { t: String(c.scores.effect), num: true },
            { t: String(c.scores.cost), num: true },
            { t: String(c.scores.risk), num: true },
            { t: String(c.total), num: true, st: c.typeStatus },
          ],
        })),
      },
      escalation: {
        rung: co.rung, rungName: co.rungName,
        above: co.courses[0].escalationProb, strategic: co.courses[0].strategicProb,
        answer: co.courses[0].consequences[0].text,
      },
      sections: co.courses.slice(0, 3).map(c => ({
        title: `${c.name} — ${c.type.toLowerCase()}, rung ${c.rung}`,
        body: `${c.statement} Means: ${c.means} Cost: ${c.cost} ${c.buys}`,
      })),
      warnings: co.courses.filter(c => c.hard).flatMap(c => c.warnings.map(w => ({ ...w, course: c.name }))),
      why: co.line,
      backing: co.courses[0].grounding,
      note: 'Scores are a reading of the picture, not an order. The commander decides.',
    },
    ui: { type: 'side', pane: 'options' },
    trigger: { type: 'options-trigger', payload: opts },
  };
}

function strikeCard(snap, mention, rung) {
  const kind = mention ? mention.kind : 'oasset';
  const id = mention ? mention.id : 'oa-pin';
  const opt = strikeOption(snap, { kind, id, rung });
  if (!opt) return null;
  const o = opt.optimal;
  return {
    card: {
      kind: 'target',
      st: o ? 'AMBER' : 'RED',
      title: `Strike option: ${opt.target.name.replace(/\s*\(assessed\)/, '')}`,
      sub: `${opt.target.confidence} confidence · assessed ${opt.target.asOfHours} h ago`,
      verdict: opt.why,
      kpis: o ? [
        { label: 'System', value: o.name.split(' ').slice(0, 2).join(' '), note: `${o.serviceable} of ${o.held} serviceable` },
        { label: 'Rounds', value: String(o.rounds), note: `${opt.cost.daysOfGuided} d of guided` },
        { label: 'Reach to spare', value: String(o.marginKm), unit: 'km' },
        { label: 'Into action', value: String(o.ttpMin), unit: 'min' },
      ] : [{ label: 'In reach', value: 'None', st: 'RED', note: 'from present positions' }],
      roe: opt.roe,
      table: opt.alternatives.length ? {
        head: ['Alternative', 'Reach', 'Spare', 'Rounds', 'Release'],
        rows: opt.alternatives.map(a => ({
          select: `asset:${a.id}`,
          cells: [
            { t: a.name, txt: true },
            { t: a.rangeKm + ' km', num: true },
            { t: a.marginKm + ' km', num: true },
            { t: String(a.rounds), num: true },
            { t: a.release, txt: true, more: true },
          ],
        })),
      } : null,
      timeline: opt.execution,
      reaction: opt.reaction,
      escalation: opt.escalation,
      after: opt.after,
      backing: opt.grounding,
      warnings: rung >= 4 ? [
        { code: 'ESC-4', text: 'Moves the exchange into operational depth.', figure: `${Math.round(opt.escalation.above * 100)}%` },
        { code: 'REL', text: `Released at ${o ? o.release.toLowerCase() : 'no authority'}.`, figure: o ? o.release : '—' },
      ] : [],
      actions: o ? [
        { id: `strike:${kind}:${id}`, label: `Order the engagement — ${o.rounds} rounds`, hard: rung >= 4, kind: 'strike' },
        { id: `folder:${kind}:${id}`, label: 'Open the target folder', kind: 'quiet' },
      ] : [],
      note: 'An assessment is a snapshot, not a return. Confirm before engaging.',
    },
    map: o ? {
      points: [
        { lat: opt.target.lat, lng: opt.target.lng, label: opt.target.name, kind: 'target', hostile: true },
        { lat: o.lat, lng: o.lng, label: o.name, kind: 'firing-position' },
      ],
      lines: [{ path: [[o.lat, o.lng], [opt.target.lat, opt.target.lng]], label: `${o.name} — ${o.marginKm} km to spare`, kind: 'firing-line' }],
      rings: opt.defended.map(a => {
        const src = snap.opposing.assets.find(x => x.id === a.id);
        return src ? { lat: src.lat, lng: src.lng, radiusKm: a.rangeKm, label: a.name, hostile: true } : null;
      }).filter(Boolean),
    } : null,
    ui: { type: 'select', kind, id },
  };
}

function hypothesesCard(snap, rung) {
  const h = hypotheses(snap, rung);
  return {
    kind: 'hypotheses',
    st: 'AMBER',
    title: 'What they do next',
    sub: `${h.length} courses open to them · ${snap.opposing.meta.confidence} confidence`,
    verdict: `The leading answer is ${h[0].name.toLowerCase()}, at ${Math.round(h[0].likelihood * 100)} per cent. Warning time is ${h[0].warning}, which is shorter than the ${META.classes.PGM.lead} days it takes to replace what it would cost us.`,
    table: {
      head: ['Their course', 'Likelihood', 'Rung', 'Warning'],
      rows: h.map(x => ({
        st: x.likelihood > 0.3 ? 'RED' : x.likelihood > 0.15 ? 'AMBER' : 'GREEN',
        cells: [
          { t: x.name, txt: true, sub: x.costsUs },
          { t: Math.round(x.likelihood * 100) + '%', num: true },
          { t: 'R' + x.rung, num: true },
          { t: x.warning, num: true, more: true },
        ],
      })),
    },
    items: h[0].indicators.map(i => ({ st: 'AMBER', title: i, text: 'Indicator for the leading course.', figure: '' })),
    sections: h.map(x => ({ title: `${x.name} — ${Math.round(x.likelihood * 100)}%`, body: `${x.costsUs} Indicators: ${x.indicators.join('; ')}. Warning time ${x.warning}.` })),
    note: 'Likelihoods are the staff assessment, not a measurement.',
  };
}

function movementCard(snap) {
  const m = snap.movement;
  const bad = snap.routes.filter(r => r.status !== 'OPEN');
  return {
    kind: 'analysis',
    st: m.status,
    title: `${Math.round(m.utilisation * 100)} per cent of lift committed`,
    sub: `${bad.length} of ${snap.routes.length} routes not fully open`,
    verdict: `The command can lift ${Math.round(m.liftPerDay).toLocaleString('en')} tonnes a day and has committed ${Math.round(m.committed).toLocaleString('en')}. ${bad.length ? `${list(bad.map(r => r.name))} ${bad.length > 1 ? 'are' : 'is'} not fully open; the engineer tasks against them would return ${Math.round(snap.summary.liftBonus.recoverable).toLocaleString('en')} tonnes a day.` : 'Every route is open.'}`,
    kpis: [
      { label: 'Lift a day', value: Math.round(m.liftPerDay / 1000) + 'k', unit: 't' },
      { label: 'Committed', value: Math.round(m.utilisation * 100) + '%', st: m.status },
      { label: 'Lost to closure', value: Math.round(snap.summary.liftBonus.lostToClosure / 1000) + 'k', unit: 't', st: 'RED' },
      { label: 'Serials moving', value: String(m.serialsMoving), note: `${m.serialsHeld} held` },
    ],
    table: {
      head: ['Route', 'Class', 'Status', 'Capacity', 'Effective'],
      rows: snap.routes.map(r => ({
        st: r.statusColour, select: `route:${r.id}`,
        cells: [
          { t: r.name, txt: true, sub: r.note || '' },
          { t: r.cls, num: true },
          { t: r.status, txt: true, st: r.statusColour },
          { t: Math.round(r.capacityPerDay).toLocaleString('en'), num: true },
          { t: Math.round(r.effectiveCapacity).toLocaleString('en'), num: true, st: r.statusColour },
        ],
      })),
    },
    note: 'Effective capacity is what a restricted route actually passes, not what it is rated at.',
  };
}

function depotsCard(snap) {
  const ns = snap.nodes.slice().sort((a, b) => a.fill - b.fill);
  const worstN = ns[0];
  return {
    kind: 'analysis',
    st: worstN.status,
    title: `${ns.filter(n => n.status === 'RED' || n.status === 'BLACK').length} depots below half their objective`,
    sub: `lowest is ${worstN.name} at ${Math.round(worstN.fill * 100)} per cent`,
    verdict: `${worstN.name} holds ${Math.round(worstN.fill * 100)} per cent of its objective, limited by ${META.classes[worstN.lowestClass]?.name.toLowerCase()}. It is a forward depot, so what it is short of is what the divisions in contact draw on.`,
    table: {
      head: ['Depot', 'Echelon', 'Fill', 'Lowest', 'Throughput'],
      rows: ns.map(n => ({
        st: n.status, select: `node:${n.id}`,
        cells: [
          { t: n.name, txt: true },
          { t: n.echelon, txt: true, more: true },
          { t: Math.round(n.fill * 100) + '%', num: true, st: n.status },
          { t: META.classes[n.lowestClass]?.short || '—', txt: true, st: n.lowestStatus },
          { t: Math.round(n.throughputPerDay).toLocaleString('en') + ' t', num: true, more: true },
        ],
      })),
    },
    note: 'Fill is held against objective, summed over every class the depot carries.',
  };
}

function reserveCard(snap) {
  const held = snap.reserves.filter(r => r.state === 'held');
  const fastest = held.slice().sort((a, b) => a.effectHours - b.effectHours)[0];
  const g = snap.summary.gate;
  return {
    card: {
      kind: 'release',
      st: 'AMBER',
      title: `${held.length} reserves held`,
      sub: fastest ? `fastest to effect is ${fastest.name.toLowerCase()} at ${fastest.effectHours} h` : 'none held',
      verdict: `Forward holding is ${d1(g.forwardDays)} days. Releasing the guided munition reserve would add roughly ${d1(snap.summary.potential.find(p => p.cls === 'PGM')?.gain || 0)} days to the command holding and takes ${fastest ? fastest.effectHours : '—'} hours to be in effect — which is inside the warning time for their leading course, but only just.`,
      kpis: [
        { label: 'Held', value: String(held.length), note: `${snap.summary.counts.reservesMoving} moving` },
        { label: 'Fastest to effect', value: fastest ? String(fastest.effectHours) : '—', unit: 'h' },
        { label: 'Forward holding', value: d1(g.forwardDays), unit: 'd', st: g.forwardVerdict === 'ADEQUATE' ? 'GREEN' : 'RED' },
        { label: 'Returns in', value: fastest ? String(fastest.returnsDays) : '—', unit: 'd', note: 'before it is replaced' },
      ],
      table: {
        head: ['Reserve', 'Class', 'Quantity', 'To effect', 'Authority'],
        rows: snap.reserves.map(r => ({
          st: r.status, select: `reserve:${r.id}`,
          cells: [
            { t: r.name, txt: true, sub: `${r.atName} → ${r.toName}` },
            { t: r.cls, num: true },
            { t: Math.round(r.qty).toLocaleString('en'), num: true },
            { t: r.state === 'held' ? r.effectHours + ' h' : r.state, num: true, st: r.status },
            { t: r.authority, txt: true, more: true },
          ],
        })),
      },
      actions: held.slice(0, 3).map(r => ({
        id: `release:${r.id}`, label: `Release ${r.name.toLowerCase()}`,
        hard: r.authority === 'National authority', kind: 'release',
      })),
      warnings: [{ code: 'RES-RET', text: 'A released reserve is not replaced for weeks. Releasing it is a decision about the month, not the day.', figure: fastest ? `${fastest.returnsDays} d` : '—' }],
      note: 'A reserve counts as held until it is in effect, not when it is ordered.',
    },
  };
}

function missionCard(snap) {
  const m = snap.missions.find(x => x.state === 'airborne') || snap.missions[0];
  if (!m) return null;
  return {
    card: {
      kind: 'detections',
      st: 'AMBER',
      title: `${m.name}: ${m.detections.filter(d => d.status === 'new').length} detections to review`,
      sub: `${m.callsign} · ${m.phase} · leg ${m.leg + 1} of ${m.route.length}`,
      verdict: m.detections.length
        ? `${m.name} is ${m.phase} over ${m.target.name.replace(/\s*\(assessed\)/, '')} with ${(m.endurance - m.elapsed).toFixed(1)} hours of endurance left. The highest-confidence detection is ${m.detections[0].label.toLowerCase()} at ${Math.round(m.detections[0].conf * 100)} per cent.`
        : `${m.name} is ${m.state} and has not yet reported.`,
      kpis: [
        { label: 'Endurance left', value: (m.endurance - m.elapsed).toFixed(1), unit: 'h' },
        { label: 'Detections', value: String(m.detections.length), st: 'AMBER' },
        { label: 'Sensor', value: m.sensor },
        { label: 'Leg', value: `${m.leg + 1}/${m.route.length}` },
      ],
      table: m.detections.length ? {
        head: ['Detection', 'Kind', 'Confidence', 'Status'],
        rows: m.detections.map(dt => ({
          st: dt.conf > 0.7 ? 'RED' : 'AMBER',
          cells: [
            { t: dt.label, txt: true },
            { t: dt.kind, txt: true, more: true },
            { t: Math.round(dt.conf * 100) + '%', num: true },
            { t: dt.status, txt: true },
          ],
        })),
      } : null,
      note: 'Detections are machine calls awaiting review. Nothing here is confirmed.',
    },
    ui: { type: 'side', pane: 'mission' },
  };
}

function exchangeCard(snap, rung) {
  const ex = exchange(snap, { rung, horizonDays: 5 });
  return {
    kind: 'sequence',
    st: 'AMBER',
    title: `Their answer at ${ex.rungName.toLowerCase()}, five days on`,
    sub: ex.note,
    verdict: `Run against a copy of the picture, their most likely answer takes forward holding from ${d1(ex.before.forwardDays)} days to ${d1(ex.after.forwardDays)} and closes one more route. The command figure barely moves; the forward figure is the one that breaks.`,
    hero: { before: `${d1(ex.before.forwardDays)} d forward`, after: `${d1(ex.after.forwardDays)} d forward` },
    table: {
      head: ['Measure', 'Before', 'After', 'Change'],
      rows: ex.rows.map(r => {
        const delta = r.after - r.before;
        const good = r.good === 'up' ? delta >= 0 : delta <= 0;
        return {
          st: good ? 'GREEN' : 'RED',
          cells: [
            { t: r.label, txt: true },
            { t: d1(r.before) + (r.unit ? ' ' + r.unit : ''), num: true },
            { t: d1(r.after) + (r.unit ? ' ' + r.unit : ''), num: true, st: good ? 'GREEN' : 'RED' },
            { t: (delta >= 0 ? '+' : '') + d1(delta), num: true, st: good ? 'GREEN' : 'RED' },
          ],
        };
      }),
    },
    note: ex.note,
  };
}

function briefCard(snap) {
  const g = snap.summary.gate;
  const ex = snap.standoff.exposure;
  return {
    kind: 'scorecard',
    st: g.verdict === 'ADEQUATE' ? 'GREEN' : 'AMBER',
    title: 'The picture as it stands',
    sub: `${snap.summary.issues.length} matters outstanding · measured against ${g.name.toLowerCase()}`,
    verdict: `The command holds ${d1(g.sustainableDays)} days against ${g.requiredDays} required — ${g.verdict.toLowerCase()} — but forward, where it is consumed, it holds ${d1(g.forwardDays)}. ${ex.length} of our locations sit inside assessed reach. The decision in front of you is whether to move the forward stock or to release the reserve; doing neither is also a decision.`,
    kpis: [
      { label: 'Command holding', value: d1(g.sustainableDays), unit: 'd', st: g.verdict === 'ADEQUATE' ? 'GREEN' : 'AMBER' },
      { label: 'Forward holding', value: d1(g.forwardDays), unit: 'd', st: 'RED' },
      { label: 'Exposed locations', value: String(ex.length), st: 'AMBER' },
      { label: 'Routes not open', value: String(snap.summary.counts.routes - snap.summary.counts.routesOpen), st: 'AMBER' },
    ],
    items: snap.summary.issues.slice(0, 6).map(i => ({
      st: i.status, title: i.name, text: i.text, figure: '', select: `${i.kind}:${i.id}`,
    })),
    note: 'Ask for courses of action, a strike option, what they do next, or how long we last.',
  };
}

// --- the stream -----------------------------------------------------------

// Split an answer into the deltas a reader actually sees arriving.
function chunks(text) {
  const out = [];
  const words = text.split(/(\s+)/);
  let buf = '';
  for (const w of words) {
    buf += w;
    if (buf.length >= 14) { out.push(buf); buf = ''; }
  }
  if (buf) out.push(buf);
  return out;
}

export function plan(snap, message, context = {}) {
  const intent = classify(message);
  const mention = resolveMention(snap, message);
  const rung = context.rung || (intent === 'strike' ? 3 : 3);
  const frames = [];
  const say = t => frames.push({ type: 'text', delta: t });

  frames.push({ type: 'mode', mode: 'reading the picture', label: 'Reading the picture' });
  frames.push({ type: 'tool', tool: 'snapshot', detail: '/api/clp' });

  let answer = '', card = null, extra = [];

  switch (intent) {
    case 'sustainment': {
      const g = snap.summary.gate;
      answer = `The command holds **${d1(g.sustainableDays)} days** at ${g.name.toLowerCase()}, against ${g.requiredDays} required. That is ${g.verdict.toLowerCase()}.\n\nForward it holds **${d1(g.forwardDays)} days**. ${META.classes[g.limitingClass]?.name} is the limiting class in both figures, and it takes ${META.classes[g.limitingClass]?.lead} days to replace — longer than the forward holding lasts.`;
      card = sustainmentCard(snap);
      extra.push({ type: 'ui', ui: { type: 'board', board: 'sustainability' } });
      break;
    }
    case 'exposure': {
      const ex = snap.standoff.exposure;
      answer = `**${ex.length} of our locations** sit inside an assessed system's reach. ${ex.filter(e => e.status === 'RED').length} of them are inside three or more.\n\nThe one that matters is **${ex[0]?.name}** — it holds ${ex[0]?.holds} per cent of its objective and sits ${ex[0]?.depthKm} km inside the deepest system that reaches it. Stock and exposure in the same place is the thing to change, and there are four ways to change it.`;
      card = exposureCard(snap);
      break;
    }
    case 'courses': {
      const r = coursesCard(snap, { rung, situation: context.situation || 'raid', target: mention?.id });
      const co = courses(snap, { rung, situation: context.situation || 'raid' });
      answer = `Five courses, ranked. The staff recommendation is **${co.recommendation.name}**.\n\n${co.recommendation.why}\n\nTwo of the five are hard decisions and carry warnings: they need national release and they move the exchange into depth. The escalation estimate is on each one.`;
      card = r.card; extra.push({ type: 'ui', ui: r.ui });
      break;
    }
    case 'strike': {
      const r = strikeCard(snap, mention, rung);
      if (!r) { answer = 'I could not find that target in the assessed picture.'; break; }
      const o = strikeOption(snap, { kind: mention?.kind || 'oasset', id: mention?.id || 'oa-pin', rung });
      answer = o.optimal
        ? `**${o.optimal.name}** reaches it with ${o.optimal.marginKm} km to spare and is released at ${o.optimal.release.toLowerCase()} — the lowest authority that can do it.\n\n${o.optimal.rounds} rounds, ${o.cost.daysOfGuided} days of the guided holding, leaving ${o.cost.remaining}. Expect counter-battery within 2 to 6 hours; the battery scoots in 8 minutes.`
        : `Nothing in the inventory reaches **${o.target.name}** from its present position. Moving a battery forward would take it inside their counter-battery reach.`;
      card = r.card;
      if (r.map) extra.push({ type: 'map', scene: r.map });
      extra.push({ type: 'ui', ui: r.ui });
      break;
    }
    case 'hypotheses': {
      const h = hypotheses(snap, rung);
      answer = `The leading answer is **${h[0].name.toLowerCase()}** at ${Math.round(h[0].likelihood * 100)} per cent, with ${h[0].warning} of warning.\n\n${h[0].costsUs}\n\nThe indicators that would tell you it is running are emitter activity, launcher movement inside 90 km, and tightened emission discipline. Two of the three have already been seen.`;
      card = hypothesesCard(snap, rung);
      extra.push({ type: 'ui', ui: { type: 'board', board: 'intel' } });
      break;
    }
    case 'reserve': { const r = reserveCard(snap); answer = `${snap.reserves.filter(x => x.state === 'held').length} reserves are held. The fastest to effect is **${snap.reserves.filter(x => x.state === 'held').sort((a, b) => a.effectHours - b.effectHours)[0]?.name.toLowerCase()}**, at ${snap.reserves.filter(x => x.state === 'held').sort((a, b) => a.effectHours - b.effectHours)[0]?.effectHours} hours.\n\nA released reserve is not replaced for weeks. This is a decision about the month, not the day.`; card = r.card; break; }
    case 'mission': { const r = missionCard(snap); if (r) { card = r.card; extra.push({ type: 'ui', ui: r.ui }); answer = `**${snap.missions[0].name}** is ${snap.missions[0].phase} with ${(snap.missions[0].endurance - snap.missions[0].elapsed).toFixed(1)} hours of endurance left and ${snap.missions[0].detections.filter(d => d.status === 'new').length} detections awaiting review.`; } break; }
    case 'movement': { card = movementCard(snap); answer = `The command can lift **${Math.round(snap.movement.liftPerDay).toLocaleString('en')} tonnes a day** and has committed ${Math.round(snap.movement.utilisation * 100)} per cent of it.\n\n${list(snap.routes.filter(r => r.status !== 'OPEN').map(r => r.name))} ${snap.routes.filter(r => r.status !== 'OPEN').length > 1 ? 'are' : 'is'} not fully open. The engineer tasks against them would return ${Math.round(snap.summary.liftBonus.recoverable).toLocaleString('en')} tonnes a day, the largest single gain available.`; extra.push({ type: 'ui', ui: { type: 'board', board: 'movement' } }); break; }
    case 'depots': { card = depotsCard(snap); const w = snap.nodes.slice().sort((a, b) => a.fill - b.fill)[0]; answer = `**${w.name}** is the lowest at ${Math.round(w.fill * 100)} per cent of objective, limited by ${META.classes[w.lowestClass]?.name.toLowerCase()}.\n\nIt is a forward depot, so what it is short of is what the divisions in contact draw on.`; break; }
    case 'exchange': { card = exchangeCard(snap, rung); answer = `Run five days forward, their most likely answer at rung ${rung} takes forward holding from ${d1(snap.summary.gate.forwardDays)} days to ${d1(exchange(snap, { rung }).after.forwardDays)}.\n\nThe command figure barely moves. The forward figure is the one that breaks, which is the same thing the standing picture says.`; break; }
    default: {
      card = briefCard(snap);
      const g = snap.summary.gate;
      answer = `${snap.summary.issues.length} matters are outstanding.\n\nThe command holds **${d1(g.sustainableDays)} days** against ${g.requiredDays} required, but forward it holds **${d1(g.forwardDays)}**. ${snap.standoff.exposure.length} of our locations sit inside assessed reach.\n\nThe decision in front of you is whether to move the forward stock or release the reserve. Doing neither is also a decision.`;
    }
  }

  frames.push({ type: 'mode', mode: 'answering', label: 'Answering' });
  for (const c of chunks(answer)) frames.push({ type: 'text', delta: c });
  if (card) frames.push({ type: 'card', card });
  for (const e of extra) frames.push(e);

  // What an answer proposes, the reader approves. Nothing is applied by the agent.
  if (intent === 'reserve' || intent === 'courses') {
    frames.push({
      type: 'actions',
      actions: (card?.actions || []).map(a => ({ ...a, record: true })),
    });
  }
  frames.push({ type: 'mode', mode: 'idle', label: 'Standing by' });
  return frames;
}
