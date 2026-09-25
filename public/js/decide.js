// The Decide pane: courses of action, strike option, escalation.
// Decide's geometry belongs to Decide: its map layer draws only while the tab
// is open and clears otherwise.

import {
  state, emit, on, esc, num, days, pct, dtg, setHtml, cls, st as stCls,
  post, byId, grid, classShort,
} from './state.js';
import { ladderChart, barChart, deltaBars } from './charts.js';

const TYPE_ST = {
  Restraint: 'GREEN', Demonstrative: 'ACCENT', Proportionate: 'AMBER',
  Punitive: 'RED', Escalatory: 'HOSTILE',
};
const openSections = new Set(['Enemy courses', 'Plan of execution', 'Escalation estimate']);

export function renderOptions() {
  const host = document.getElementById('options');
  if (!host) return;
  if (state.strikeOption) { setHtml(host, strikeView(state.strikeOption)); return; }
  if (!state.estimate) { setHtml(host, resting()); return; }
  setHtml(host, estimateView(state.estimate));
  foldSections(host);
}

/* --- resting: opening the tab is not an ask ------------------------------ */
function resting() {
  const target = state.selected && /^o/.test(state.selected.kind)
    ? byId(state.selected.kind, state.selected.id) : null;
  return `<div class="empty-state">
    <b>No decision on the table</b>
    <p>The estimate runs only when it is asked for. Opening this tab is not an ask.</p>
    <div class="d-acts" style="margin-top:16px">
      <button class="btn btn-sm primary" data-decide-run="1">Courses of action now</button>
      ${target ? `<button class="btn btn-sm" data-strike="${esc(state.selected.kind)}:${esc(target.id)}">
        Strike courses against ${esc(target.name.replace(/\s*\(assessed\)/, ''))}</button>` : ''}
      <button class="btn btn-sm quiet" data-ask="Give me courses of action">Ask the agent instead</button>
    </div>
  </div>`;
}

/* --- the estimate -------------------------------------------------------- */
function estimateView(E) {
  const chosen = E.courses.find(c => c.id === state.chosenCourse) || E.courses[0];
  const intent = state.data?.intent;
  return head(E) +
    `<div class="dz-line">${esc(E.line)}</div>` +
    recommendation(E, intent) +
    situationPicker(E) +
    section('Enemy courses', `their most likely answer is ${E.hypotheses[0]?.name.toLowerCase()}`, hypothesesBlock(E)) +
    section('Threat forecast', `${E.threat.exposed.length} of our locations are inside assessed reach`, threatBlock(E)) +
    coursesList(E, chosen, intent) +
    (chosen ? chosenCourse(chosen, E) : '') +
    actions(E, chosen);
}

function head(E) {
  return `<div class="dz-h ${stCls('AMBER')}">
    <span class="rung-chip">R${E.rung}</span>
    <b class="title" style="flex:1 1 auto">${esc(E.rungName)}</b>
    <button class="btn-sm quiet" data-decide-clear="1">Clear</button>
  </div>`;
}

function recommendation(E, intent) {
  const commander = intent?.courses?.length
    ? E.courses.find(c => intent.courses.includes(c.id)) : null;
  const staff = E.courses.find(c => c.id === E.recommendation.courseId);
  const lead = commander || staff;
  return `<div class="dz-rec">
    <span class="lbl">${commander ? 'The commander’s course' : 'Staff recommendation'}</span>
    <b>${esc(lead?.name || '—')}</b>
    <p>${esc(commander
      ? `Set by the commander. The staff recommendation was ${staff?.name.toLowerCase()}.`
      : E.recommendation.why)}</p>
    <p class="note">${esc(E.recommendation.note)}</p>
  </div>`;
}

function situationPicker(E) {
  return `<details class="fold"><summary><h4>Situation</h4>
    <span class="lead">${esc(E.situation.name)}</span></summary>
    <div class="d-b">
      <div class="chip-row">${E.situations.map(s =>
        `<button class="chip ${s.id === E.situation.id ? 'is-on' : ''}" data-decide-situation="${esc(s.id)}">${esc(s.name)}</button>`).join('')}</div>
      <div class="chip-row" style="margin-top:8px">${E.ladder.map(l =>
        `<button class="chip ${l.rung === E.rung ? 'is-on' : ''}" data-decide-rung="${l.rung}">R${l.rung}</button>`).join('')}</div>
      <p class="note">${esc(E.situation.lead)}</p>
    </div></details>`;
}

const section = (title, lead, body) => `<details class="fold" data-section="${esc(title)}"
  ${openSections.has(title) ? 'open' : ''}>
  <summary><h4>${esc(title)}</h4><span class="lead">${esc(lead)}</span></summary>
  <div class="d-b">${body}</div></details>`;

function hypothesesBlock(E) {
  return E.hypotheses.map(h => `<div class="fact ${stCls(h.likelihood > 0.3 ? 'RED' : h.likelihood > 0.15 ? 'AMBER' : 'GREEN')}">
    <span class="k" style="color:var(--ink-2)">${esc(h.name)}
      <span class="sub">${esc(h.costsUs)} · warning ${esc(h.warning)}</span></span>
    <span class="v">${pct(h.likelihood)}</span></div>`).join('');
}

function threatBlock(E) {
  return `<span class="lbl" style="display:block;margin-bottom:6px">Most exposed</span>` +
    E.threat.exposed.map(e => `<div class="fact ${stCls(e.status)}" data-select="node:${esc(e.id)}">
      <span class="k" style="color:var(--ink-2)">${esc(e.name)}
        <span class="sub">${e.systems} systems · ${num(e.depthKm)} km inside</span></span>
      <span class="v">${e.holds}%</span></div>`).join('') +
    `<span class="lbl" style="display:block;margin:12px 0 6px">Protective moves</span>` +
    E.threat.moves.map(m => `<div class="fact ${stCls(m.status)}">
      <span class="k" style="color:var(--ink-2)">${esc(m.name)}
        <span class="sub">${esc(m.effect)} ${esc(m.cost)}</span></span>
      <span class="v">${m.hours >= 48 ? Math.round(m.hours / 24) + ' d' : m.hours + ' h'}</span></div>`).join('') +
    `<p class="note">${esc(E.threat.note)}</p>`;
}

/* --- the course list ----------------------------------------------------- */
function coursesList(E, chosen, intent) {
  const ticked = state.tickedCourses || new Set();
  const cmdIds = new Set(intent?.courses || []);
  // The commander's course leads the list.
  const list = E.courses.slice().sort((a, b) => (cmdIds.has(b.id) ? 1 : 0) - (cmdIds.has(a.id) ? 1 : 0));
  return `<div class="d-b" style="padding:0;border-bottom:0">
    <div style="display:flex;align-items:baseline;gap:8px;padding:12px 16px 6px">
      <span class="lbl">Courses of action</span>
      <span class="dim" style="font-size:11px;margin-left:auto">${ticked.size ? ticked.size + ' ticked' : 'tick to combine'}</span>
    </div>
    ${list.map(c => courseRow(c, c.id === chosen?.id, ticked.has(c.id), cmdIds.has(c.id))).join('')}
    ${ticked.size ? `<div style="padding:10px 16px">
      <button class="btn btn-sm primary" data-intent-build="1">Make this the commander’s course</button>
      ${cmdIds.size ? `<button class="btn btn-sm quiet" data-intent-clear="1">Clear</button>` : ''}
    </div>` : cmdIds.size ? `<div style="padding:10px 16px">
      <button class="btn btn-sm quiet" data-intent-clear="1">Clear the commander’s course</button></div>` : ''}
  </div>`;
}

function courseRow(c, isSel, isTicked, isCmd) {
  const s = TYPE_ST[c.type] || 'ACCENT';
  const maxBar = 46;
  return `<button class="coa ${stCls(s)} ${isSel ? 'is-sel' : ''}" data-option="${esc(c.id)}">
    <span class="rank">${c.rank}</span>
    <span>
      <span class="coa-badges">
        <input type="checkbox" class="coa-check" data-option-choose="${esc(c.id)}" ${isTicked ? 'checked' : ''}
          aria-label="Combine ${esc(c.name)}">
        <span class="pill">${esc(c.type)}</span>
        <span class="badge">R${c.rung}</span>
        ${isCmd ? `<span class="badge cmd">Commander’s course</span>` : ''}
        ${c.held ? `<span class="badge">Held</span>` : ''}
        <span class="badge">${esc(c.verdict)}</span>
      </span>
      <span class="nm">${esc(c.name)}${c.hard ? `<span class="hard"> · hard</span>` : ''}</span>
      <span class="ml">${esc(c.means)} ${esc(c.cost)}</span>
      <span class="coa-bars">
        <i class="e" style="width:${(c.scores.effect / 100 * maxBar).toFixed(1)}px"></i>
        <i class="c" style="width:${(c.scores.cost / 100 * maxBar).toFixed(1)}px"></i>
        <i class="r" style="width:${(c.scores.risk / 100 * maxBar).toFixed(1)}px"></i>
      </span>
    </span>
    <span class="tot">${c.total}</span>
  </button>`;
}

/* --- the chosen course --------------------------------------------------- */
function chosenCourse(c, E) {
  return `<div class="d-b"><h4>${esc(c.name)}</h4>
      <p style="font-size:13.5px;line-height:1.55;color:var(--ink)">${esc(c.statement)}</p></div>` +
    section('Plan of execution', `${c.execution.length} phases`,
      c.execution.map(p => `<div class="fact"><span class="k">${esc(p.phase)}</span>
        <span class="v" style="font-family:var(--sans);text-align:left">${esc(p.text)}</span></div>`).join('')) +
    section('Synchronisation matrix', 'what happens when, and who does it',
      `<div class="scroll-x"><table class="tbl"><thead><tr><th>When</th><th>Action</th><th>Who</th></tr></thead>
      <tbody>${c.execution.map(p => `<tr><td class="num">${esc(p.phase)}</td><td>${esc(p.text)}</td>
        <td>${esc(c.rung >= 4 ? 'National / theatre' : 'Corps')}</td></tr>`).join('')}</tbody></table></div>`) +
    section('Rules of engagement', c.roe.slice(0, 60), `<p style="font-size:12.5px;color:var(--ink-2)">${esc(c.roe)}</p>`) +
    (c.targets?.length ? section('Targets', `${c.targets.length} in reach`,
      c.targets.map(t => `<div class="fact st-HOSTILE" data-select="${esc(t.kind)}:${esc(t.id)}">
        <span class="k" style="color:var(--ink-2)">${esc(t.name.replace(/\s*\(assessed\)/, ''))}
          <span class="sub">${esc(t.inReachOf || 'nothing in reach')}${t.reachMarginKm != null ? ` · ${t.reachMarginKm} km to spare` : ''}</span></span>
        <span class="v">${esc(t.confidence)}</span></div>`).join('')) : '') +
    section('Means and cost', c.cost.slice(0, 60),
      `<div class="fact"><span class="k">Means</span><span class="v" style="font-family:var(--sans);text-align:left">${esc(c.means)}</span></div>
       <div class="fact"><span class="k">Cost</span><span class="v" style="font-family:var(--sans);text-align:left">${esc(c.cost)}</span></div>
       <div class="fact"><span class="k">What it buys</span><span class="v" style="font-family:var(--sans);text-align:left">${esc(c.buys)}</span></div>`) +
    section('Consequences', c.consequences[0]?.text || '',
      c.consequences.map(x => `<div class="fact"><span class="k">${esc(x.label)}</span>
        <span class="v" style="font-family:var(--sans);text-align:left">${esc(x.text)}</span></div>`).join('')) +
    section('Escalation estimate', `${pct(c.escalationProb)} chance of an answer above this rung`,
      `<div class="kpis">
        <div class="kpi st-AMBER"><span class="k">This rung</span><span class="v">R${c.rung}</span>
          <span class="n">${esc(c.rungName || '')}</span></div>
        <div class="kpi ${c.escalationProb > 0.5 ? 'st-RED' : 'st-AMBER'}"><span class="k">Answer above</span>
          <span class="v">${pct(c.escalationProb)}</span></div>
        <div class="kpi ${c.strategicProb > 0.05 ? 'st-RED' : 'st-GREEN'}"><span class="k">Strategic</span>
          <span class="v">${pct(c.strategicProb)}</span></div>
      </div>
      ${ladderChart({ ladder: E.ladder, rung: E.rung, courseRung: c.rung })}`) +
    section('After this', c.after.slice(0, 60), `<p style="font-size:12.5px;color:var(--ink-2)">${esc(c.after)}</p>`) +
    (c.warnings?.length ? `<div class="d-b"><div class="ac-warn"><span class="kind">Hard decision</span>
      ${c.warnings.map(w => `<div class="w"><span>${esc(w.text)}</span><span class="f">${esc(w.figure)}</span></div>`).join('')}
    </div></div>` : '') +
    section('Grounding', 'every figure, and where it came from',
      c.grounding.map(g => `<div class="fact"><span class="k">${esc(g.label)}</span>
        <span class="v">${esc(g.value)}<span class="sub">${esc(g.source)}</span></span></div>`).join(''));
}

function actions(E, chosen) {
  return `<div class="d-b"><div class="d-acts">
    ${chosen ? `<button class="btn btn-sm" data-option-plan="${esc(chosen.id)}">Take this into a plan</button>` : ''}
    <button class="btn btn-sm" data-board="ladder">Escalation ladder</button>
    <button class="btn btn-sm quiet" data-ask="What will they do if we take ${esc(chosen?.name || 'this course')}?">Ask the agent</button>
  </div></div>`;
}

/* --- the strike option --------------------------------------------------- */
function strikeView(o) {
  const t = o.target;
  const opt = o.optimal;
  return `<div class="dz-h st-HOSTILE">
      <span class="rung-chip">R${o.escalation.rung}</span>
      <b class="title" style="flex:1 1 auto">Strike option</b>
      <button class="btn-sm quiet" data-decide-clear="1">Clear</button>
    </div>
    <div class="assessed-banner"><span class="lbl">Assessed</span>
      <span>${esc(t.confidence)} confidence · as of ${t.asOfHours} h ago</span></div>
    <div class="d-h st-HOSTILE"><span class="kind">Target</span>
      <h3>${esc(t.name.replace(/\s*\(assessed\)/, ''))}</h3>
      <div class="d-meta"><span class="pill">${esc(t.category)}</span>
        <span class="grid">${esc(grid(t.lat, t.lng))}</span></div></div>` +
    (opt ? `<div class="kpis">
      <div class="kpi"><span class="k">Optimal package</span><span class="v" style="font-size:17px">${esc(opt.name)}</span>
        <span class="n">${opt.serviceable} of ${opt.held} serviceable</span></div>
      <div class="kpi st-AMBER"><span class="k">Rounds</span><span class="v">${opt.rounds}</span>
        <span class="n">${o.cost.daysOfGuided} d of guided, ${o.cost.remaining} d left</span></div>
      <div class="kpi"><span class="k">Reach to spare</span><span class="v">${num(opt.marginKm)}<span class="unit">km</span></span></div>
      <div class="kpi"><span class="k">Into action</span><span class="v">${opt.ttpMin}<span class="unit">min</span></span></div>
    </div>` : `<div class="d-b"><p class="mute">Nothing in the inventory reaches this target from its present position.</p></div>`) +
    section('Rules of engagement', o.roe.release,
      `<div class="fact"><span class="k">Release</span><span class="v">${esc(o.roe.release)}</span></div>
       ${o.roe.rules.map(r => `<div class="fact"><span class="k" style="color:var(--ink-2)">${esc(r)}</span><span class="v"></span></div>`).join('')}
       <p class="note">${esc(o.roe.collateral)}</p>`) +
    (o.execution.length ? section('Plan of execution', `${o.execution.length} phases`,
      o.execution.map(p => `<div class="fact"><span class="k">${esc(p.phase)}</span>
        <span class="v" style="font-family:var(--sans);text-align:left">${esc(p.text)}</span></div>`).join('')) : '') +
    (o.alternatives.length ? section('Alternatives', `${o.alternatives.length} other systems reach it`,
      `<div class="scroll-x"><table class="tbl"><thead><tr><th>System</th><th class="num">Reach</th>
        <th class="num">Spare</th><th class="num">Rounds</th><th>Release</th></tr></thead><tbody>
        ${o.alternatives.map(a => `<tr data-select="asset:${esc(a.id)}"><td>${esc(a.name)}</td>
          <td class="num">${num(a.rangeKm)} km</td><td class="num">${num(a.marginKm)} km</td>
          <td class="num">${num(a.rounds)}</td><td>${esc(a.release)}</td></tr>`).join('')}
      </tbody></table></div>`) : '') +
    section('Their reaction, our counter', o.reaction.theirs,
      `<div class="fact"><span class="k">Theirs</span><span class="v" style="font-family:var(--sans);text-align:left">${esc(o.reaction.theirs)}</span></div>
       <div class="fact"><span class="k">Ours</span><span class="v" style="font-family:var(--sans);text-align:left">${esc(o.reaction.ours)}</span></div>`) +
    section('Why', o.why.slice(0, 60), `<p style="font-size:12.5px;color:var(--ink-2)">${esc(o.why)}</p>`) +
    (o.defended.length ? section('What defends it', `${o.defended.length} assessed air defence systems`,
      o.defended.map(a => `<div class="fact st-HOSTILE" data-select="oasset:${esc(a.id)}">
        <span class="k" style="color:var(--ink-2)">${esc(a.name.replace(/\s*\(assessed\)/, ''))}</span>
        <span class="v">${num(a.rangeKm)} km${a.altKm ? ` · ${a.altKm} km alt` : ''}</span></div>`).join('')) : '') +
    section('Escalation estimate', `${pct(o.escalation.above)} chance of an answer above this rung`,
      `<div class="kpis">
        <div class="kpi st-AMBER"><span class="k">Rung</span><span class="v">R${o.escalation.rung}</span>
          <span class="n">${esc(o.escalation.rungName)}</span></div>
        <div class="kpi ${o.escalation.above > 0.5 ? 'st-RED' : 'st-AMBER'}"><span class="k">Answer above</span>
          <span class="v">${pct(o.escalation.above)}</span></div>
        <div class="kpi ${o.escalation.strategic > 0.05 ? 'st-RED' : 'st-GREEN'}"><span class="k">Strategic</span>
          <span class="v">${pct(o.escalation.strategic)}</span></div>
      </div><p style="margin-top:8px;font-size:12.5px;color:var(--ink-2)">${esc(o.escalation.answer)}</p>`) +
    section('After this', o.after.slice(0, 60), `<p style="font-size:12.5px;color:var(--ink-2)">${esc(o.after)}</p>`) +
    section('Grounding', 'every figure, and where it came from',
      o.grounding.map(g => `<div class="fact"><span class="k">${esc(g.label)}</span>
        <span class="v">${esc(g.value)}<span class="sub">${esc(g.source)}</span></span></div>`).join('')) +
    `<div class="d-b"><div class="d-acts">
      <button class="btn btn-sm" data-terrain-target="${esc(t.kind)}:${esc(t.id)}">See it in 3D</button>
      <button class="btn btn-sm quiet" data-ask="What happens if we strike ${esc(t.name)}?">Ask the agent</button>
    </div></div>`;
}

/* --- 8.2 foldSections — opens survive a re-render ------------------------ */
function foldSections(host) {
  for (const d of host.querySelectorAll('details.fold[data-section]')) {
    const title = d.dataset.section;
    d.open = openSections.has(title);
    d.addEventListener('toggle', () => {
      if (d.open) openSections.add(title); else openSections.delete(title);
    });
  }
}

/* --- running the estimate ------------------------------------------------ */
export async function runEstimate(opts = {}) {
  const body = {
    rung: opts.rung ?? state.rung ?? 3,
    situation: opts.situation ?? state.situation ?? 'raid',
    target: opts.target ?? null,
  };
  state.rung = body.rung; state.situation = body.situation;
  const r = await fetch('/api/decide', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  state.estimate = await r.json();
  state.strikeOption = null;
  state.decideLadder = {
    ladder: state.estimate.ladder, rung: state.estimate.rung,
    rungName: state.estimate.rungName, courses: state.estimate.courses,
  };
  state.chosenCourse = state.estimate.courses[0]?.id;
  emit('side', 'options');
  renderOptions();
  drawDecideLayer();
}

export async function runStrike(kind, id, rung = 3) {
  const r = await fetch('/api/strike', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, id, rung }),
  });
  if (!r.ok) return;
  state.strikeOption = await r.json();
  state.estimate = null;
  emit('side', 'options');
  renderOptions();
  drawDecideLayer();
}

export function clearDecide() {
  state.estimate = null;
  state.strikeOption = null;
  state.chosenCourse = null;
  state.tickedCourses = new Set();
  emit('decide-clear');
  renderOptions();
}

export async function buildIntent() {
  const ticked = [...(state.tickedCourses || [])];
  if (!ticked.length) return;
  await post('/api/intent', {
    courses: ticked, rung: state.rung || 3,
    situation: state.situation || 'raid', target: null,
  });
  state.tickedCourses = new Set();
  emit('intent-changed');
  renderOptions();
}
export async function clearIntent() {
  await post('/api/intent', undefined, 'DELETE');
  emit('intent-changed');
  renderOptions();
}

/* --- Decide's own geometry ----------------------------------------------- */
export function drawDecideLayer() {
  emit('decide-draw', decideScene());
}
export function decideScene() {
  if (state.side !== 'options') return null;
  if (state.strikeOption) {
    const o = state.strikeOption;
    if (!o.optimal) return { points: [{ lat: o.target.lat, lng: o.target.lng, label: o.target.name, kind: 'target', hostile: true }] };
    return {
      points: [
        { lat: o.target.lat, lng: o.target.lng, label: o.target.name.replace(/\s*\(assessed\)/, ''), kind: 'target', hostile: true },
        { lat: o.optimal.lat, lng: o.optimal.lng, label: o.optimal.name, kind: 'firing-position' },
      ],
      lines: [{ path: [[o.optimal.lat, o.optimal.lng], [o.target.lat, o.target.lng]], kind: 'firing-line',
        label: `${o.optimal.marginKm} km to spare` }],
      rings: o.defended.map(a => {
        const src = state.data?.opposing.assets.find(x => x.id === a.id);
        return src ? { lat: src.lat, lng: src.lng, radiusKm: a.rangeKm, label: a.name, hostile: true } : null;
      }).filter(Boolean),
    };
  }
  if (state.estimate) {
    const c = state.estimate.courses.find(x => x.id === state.chosenCourse);
    if (!c?.targets?.length) return null;
    return {
      points: c.targets.map(t => ({ lat: t.lat, lng: t.lng, label: t.name.replace(/\s*\(assessed\)/, ''), kind: 'target', hostile: true })),
      lines: c.targets.filter(t => t.inReachOf).map(t => {
        const shooter = state.data?.assets.find(a => a.name === t.inReachOf);
        return shooter ? { path: [[shooter.lat, shooter.lng], [t.lat, t.lng]], kind: 'firing-line' } : null;
      }).filter(Boolean),
    };
  }
  return null;
}

export function chooseCourse(id) {
  state.chosenCourse = id;
  renderOptions();
  drawDecideLayer();
  emit('decide-select', id);
}
export function tickCourse(id) {
  state.tickedCourses = state.tickedCourses || new Set();
  if (state.tickedCourses.has(id)) state.tickedCourses.delete(id);
  else state.tickedCourses.add(id);
  renderOptions();
}
