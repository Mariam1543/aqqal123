// Drawing and assessing a plan, and its sustainment annex.
// Every edit snapshots the plan onto an undo stack.

import {
  state, emit, on, esc, num, days, pct, setHtml, cls, st as stCls,
  storeJSON, byId, classShort, distKm,
} from './state.js';
import { ganttChart, barChart } from './charts.js';

const UNDO_DEPTH = 60;
let undo = [], redo = [];

export const PHASE_TYPES = ['prepare', 'move', 'assault', 'consolidate', 'sustain'];

export function newPlan(seed = {}) {
  return {
    id: 'p-' + Math.random().toString(36).slice(2, 8),
    name: seed.name || 'Untitled plan',
    mission: seed.mission || '',
    objective: seed.objective || null,     // polygon
    axis: seed.axis || null,               // polyline
    phases: seed.phases || [
      { name: 'Prepare', type: 'prepare', days: 2 },
      { name: 'Move', type: 'move', days: 3 },
      { name: 'Assault', type: 'assault', days: 2 },
    ],
    assigned: seed.assigned || [],
    createdAt: new Date().toISOString(),
  };
}

export function snapshot() {
  if (!state.plan) return;
  undo.push(JSON.stringify(state.plan));
  if (undo.length > UNDO_DEPTH) undo.shift();
  redo = [];
}
export function undoPlan() {
  if (!undo.length) return;
  redo.push(JSON.stringify(state.plan));
  state.plan = JSON.parse(undo.pop());
  assess(); renderPlan();
}
export function redoPlan() {
  if (!redo.length) return;
  undo.push(JSON.stringify(state.plan));
  state.plan = JSON.parse(redo.pop());
  assess(); renderPlan();
}

export function savePlans() {
  const plans = storeJSON('plans') || [];
  const i = plans.findIndex(p => p.id === state.plan.id);
  if (i >= 0) plans[i] = state.plan; else plans.unshift(state.plan);
  storeJSON('plans', plans.slice(0, 12));    // the 12 most recent
}

let assessTimer = null;
export function assess() {
  clearTimeout(assessTimer);
  assessTimer = setTimeout(async () => {
    if (!state.plan) return;
    try {
      const r = await fetch('/api/plan/assess', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.plan),
      });
      state.planAssessment = await r.json();
      renderPlan();
    } catch (e) { /* the pane renders without it */ }
  }, 180);
}

export function renderPlan() {
  const host = document.getElementById('plan');
  if (!host) return;
  const p = state.plan;
  if (!p) {
    setHtml(host, `<div class="empty-state">
      <b>No plan drawn</b>
      <p>Press <kbd>P</kbd> or the Plan tool, then draw an objective and an axis on the map.</p>
    </div>`);
    return;
  }
  const a = state.planAssessment;
  setHtml(host, `
    <div class="d-b">
      <input class="plan-name" value="${esc(p.name)}" data-plan="name" aria-label="Plan name">
      <input class="plan-mission" value="${esc(p.mission)}" data-plan="mission"
        placeholder="Mission — what this plan is for" aria-label="Mission">
      <div class="d-acts" style="margin-top:10px">
        <span class="dim" style="font-size:11px">${p.objective ? 'Objective drawn' : 'No objective'} · ${p.axis ? 'axis drawn' : 'no axis'}</span>
      </div>
    </div>
    ${a ? `<div class="kpis">
      <div class="kpi ${stCls(a.verdict === 'ADEQUATE' ? 'GREEN' : a.verdict === 'MARGINAL' ? 'AMBER' : 'RED')}">
        <span class="k">Verdict</span><span class="v" style="font-size:19px">${esc(a.verdict.toLowerCase())}</span></div>
      <div class="kpi"><span class="k">Duration</span><span class="v">${days(a.totalDays)}<span class="unit">d</span></span></div>
      <div class="kpi"><span class="k">Assigned</span><span class="v">${a.assigned.length}</span>
        <span class="n">formations</span></div>
      <div class="kpi ${stCls(a.lift.utilisation > 0.6 ? 'AMBER' : 'GREEN')}"><span class="k">Of theatre lift</span>
        <span class="v">${pct(a.lift.utilisation)}</span></div>
    </div>` : ''}
    <section class="d-b"><h4>Phases</h4>
      ${ganttChart({ phases: p.phases })}
      ${p.phases.map((ph, i) => `<div class="ph-row">
        <input value="${esc(ph.name)}" data-ph-name="${i}" aria-label="Phase name">
        <select data-ph-type="${i}" aria-label="Phase type">${PHASE_TYPES.map(t =>
          `<option value="${t}" ${ph.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <input type="number" min="0.5" step="0.5" value="${esc(ph.days)}" data-ph-days="${i}" aria-label="Days">
        <button class="x" data-ph-del="${i}" aria-label="Delete phase">×</button>
      </div>`).join('')}
      <button class="btn-sm quiet" data-ph-add="1" style="margin-top:6px">Add a phase</button>
    </section>
    <section class="d-b"><h4>Assigned formations</h4>
      ${(state.data?.units || []).map(u => {
        const on = p.assigned.includes(u.id);
        const d = p.objective ? distToObjective(u) : null;
        return `<label class="assign-row">
          <input type="checkbox" data-assign="${esc(u.id)}" ${on ? 'checked' : ''}>
          <span>${esc(u.name)}</span>
          <span class="st-txt ${stCls(u.strengthStatus)}">${pct(u.strength)}${d != null ? ` · ${num(d)} km` : ''}</span>
        </label>`;
      }).join('')}
      <p class="note">A formation can also be dragged from any list onto the map or this pane.</p>
    </section>
    ${a ? requirementBlock(a) + readinessBlock(a) + decisionsBlock(a) + risksBlock(a) + annexBlock(a) : ''}
    <section class="d-b"><div class="d-acts">
      <button class="btn btn-sm" data-plan-save="1">Save</button>
      <button class="btn btn-sm quiet" data-plan-discard="1">Discard</button>
      <button class="btn btn-sm quiet" data-ask="Assess this plan">Ask the agent</button>
    </div></section>`);
}

function distToObjective(u) {
  const o = state.plan?.objective;
  if (!o?.length) return null;
  const lat = o.reduce((s, p) => s + p[0], 0) / o.length;
  const lng = o.reduce((s, p) => s + p[1], 0) / o.length;
  return distKm(u.lat, u.lng, lat, lng);
}

function requirementBlock(a) {
  return `<section class="d-b"><h4>Requirement against availability</h4>
    <div class="scroll-x"><table class="tbl"><thead><tr><th>Class</th>
      <th class="num">Required</th><th class="num">Held</th><th class="num">Short</th></tr></thead><tbody>
      ${a.requirement.map(r => `<tr class="${stCls(r.status)}"><td>${esc(r.name)}</td>
        <td class="num">${days(r.requiredDays)} d</td>
        <td class="num st-fig ${stCls(r.status)}">${days(r.heldDays)} d</td>
        <td class="num">${r.shortfall > 0 ? days(r.shortfall) + ' d' : '—'}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="note">The requirement is the plan's duration scaled by the share of the command assigned to it.</p>
  </section>
  <section class="d-b"><h4>What the routes can carry</h4>
    <div class="fact"><span class="k">Theatre lift</span><span class="v">${num(a.lift.perDay)} t/d</span></div>
    <div class="fact ${stCls(a.lift.utilisation > 0.6 ? 'AMBER' : 'GREEN')}">
      <span class="k">This plan demands</span><span class="v">${num(a.lift.demandPerDay)} t/d</span></div>
    <div class="fact"><span class="k">Share of lift</span><span class="v">${pct(a.lift.utilisation)}</span></div>
  </section>`;
}

function readinessBlock(a) {
  if (!a.readiness.length) return '';
  return `<section class="d-b"><h4>Readiness against H</h4>
    ${a.readiness.map(r => `<div class="rd-row ${stCls(r.status)}">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name)}</span>
      <span class="meter"><i style="width:${Math.min(100, (r.days / Math.max(1, a.totalDays)) * 100).toFixed(1)}%"></i>
        <b style="left:100%"></b></span>
      <span class="st-txt" style="font-family:var(--mono);text-align:right">${days(r.days)} d</span>
    </div>`).join('')}
    <p class="note">The tick is the plan's duration. A formation whose bar falls short cannot sustain itself to the end of it.</p>
  </section>`;
}

function decisionsBlock(a) {
  return `<section class="d-b"><h4>Decisions to take, and by when</h4>
    ${a.decisions.map(d => `<div class="dec-row ${d.byDay <= 1 ? 'late' : ''}">
      <span class="w">by day ${d.byDay}</span><span>${esc(d.name)}</span>
      <span class="dim" style="font-size:11px">${esc(d.owner)}</span></div>`).join('')}
  </section>`;
}

function risksBlock(a) {
  if (!a.risks.length) return `<section class="d-b"><h4>Risks</h4><p class="mute" style="font-size:12.5px">Nothing outstanding.</p></section>`;
  return `<section class="d-b"><h4>Risks</h4>
    <div class="ac-warn ${a.risks.some(r => r.st === 'RED') ? '' : 'caution'}">
      <span class="kind">${a.risks.some(r => r.st === 'RED') ? 'Hard decision' : 'Caution'}</span>
      ${a.risks.map(r => `<div class="w"><span>${esc(r.text)}</span><span class="f">${esc(r.figure)}</span></div>`).join('')}
    </div></section>`;
}

function annexBlock(a) {
  return `<section class="d-b"><h4>${esc(a.annex.title)}</h4>
    ${a.annex.lines.map(l => `<div class="fact"><span class="k" style="color:var(--ink-2)">${esc(l)}</span><span class="v"></span></div>`).join('')}
    <p style="font-size:12.5px;color:var(--ink-2);margin-top:8px">${esc(a.annex.lift)}</p>
    <p style="font-size:12.5px;color:var(--ink-2);margin-top:4px">${esc(a.annex.limiting)}</p>
  </section>`;
}

/* --- edits --------------------------------------------------------------- */
export function editPlan(fn) {
  if (!state.plan) return;
  snapshot();
  fn(state.plan);
  assess();
  renderPlan();
}
export function assignUnit(id) {
  editPlan(p => {
    const i = p.assigned.indexOf(id);
    if (i >= 0) p.assigned.splice(i, 1); else p.assigned.push(id);
  });
}
export function discardPlan() {
  state.plan = null; state.planAssessment = null;
  undo = []; redo = [];
  emit('plan-discard');
  renderPlan();
}
