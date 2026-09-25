// Bootstrap, polling, the click router, keyboard, workspaces and panes.

import {
  state, emit, on, esc, num, days, pct, dtg, setHtml, store, storeJSON, post,
  byId, isOpp, setRefresher, getRole, setRole, debounce, cls, st as stCls,
} from './state.js';
import { initMap, syncMap, fitAll, focusOn, flyTo, invalidate, scheduleCollide, setHover, groups } from './map.js';
import { initLayers, render as renderLayers, renderLegend, handleLayersClick, setForce, applyPreset, blank } from './layers.js';
import { renderRail, toggleRail } from './rail.js';
import { renderDetail } from './detail.js';
import { renderBoard, openBoard, boardsFor, isOppBoard, OWN_BOARDS, OPP_BOARDS } from './boards.js';
import { initAssistant, ask, clearChat, toggleCard, foldPass, uploadGuidance, loadGuidance, deleteGuidance } from './assistant.js';
import { renderOptions, runEstimate, runStrike, clearDecide, chooseCourse, tickCourse, buildIntent, clearIntent, drawDecideLayer, decideScene } from './decide.js';
import { renderPlan, newPlan, editPlan, assignUnit, discardPlan, assess, savePlans, undoPlan, redoPlan, snapshot } from './plan.js';
import { renderAlerts, toggleAlerts, ackAll, unreadCount } from './alerts.js';
import { drawScene, clearAgentLayer } from './agentmap.js';
import { initTools, setTool, clearTool, clearDrawings, activeTool, finishPlan } from './tools.js';
import { initMenu, close as closeMenu } from './menu.js';
import { openPalette, closePalette, isPaletteOpen, paletteKey, runRow } from './palette.js';
import { refreshRibbon } from './ribbon.js';
import { startWall, stopWall, refreshTicker, restartCycleAt } from './wall.js';
import { syncMissions } from './missions.js';
import { renderMissionPanel, missionAct, reviewObservation } from './mission-panel.js';
import { openFeed, closeFeed, isFeedOpen, setSensor, zoomFeed, renderFeed } from './feed.js';
import { openTerrain, closeTerrain, terrainOpen, toggleTerrainSide, terrainElement, playSequence } from './terrain.js';
import { startBrief, startCase, closeBrief, briefOpen, stepBrief, showIntro, closeIntro } from './brief.js';
import { startTour, closeTour, tourOpen, stepTour } from './tour.js';
import { clockControl, setReplay, playReplay, backToLive, replayOverlay } from './replay.js';
import { setLang, currentLang } from './i18n.js';
import { initVoice, startTalking, stopTalking } from './voice.js';
import { initPop, applyPopMode, openPop } from './pop.js';
import { renderFindings } from './findings.js';
import { openProduct, close as closeProduct, productOpen } from './product-viewer.js';

/* --- 6.3 Workspaces ------------------------------------------------------ */
const WS = {
  watch: { side: 440, tab: 'detail',    layers: true,  wall: false },
  plan:  { side: 620, tab: 'options',   layers: true,  wall: false },
  agent: { side: 640, tab: 'assistant', layers: true,  wall: false },
  brief: { side: 384, tab: 'detail',    layers: false, wall: true  },
};

// Decide and the conversation always stand; the rest come and go with their contents.
const PANES = { detail: false, plan: false, mission: false, options: true, assistant: true };
const TAB_LABEL = { detail: 'Selected', plan: 'Plan', options: 'Decide', mission: 'Mission', assistant: 'Agent' };
const TAB_ICON = {
  detail: '<svg viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  plan: '<svg viewBox="0 0 12 12"><path d="M1.5 9.5 L4.5 3 L7.5 7 L10.5 2.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  options: '<svg viewBox="0 0 12 12"><path d="M6 1.5 L10.5 6 L6 10.5 L1.5 6 Z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  mission: '<svg viewBox="0 0 12 12"><path d="M1.5 6 H10.5 M6 2.5 V9.5 M3.5 2.5 H8.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  assistant: '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="6" r="1.4" fill="currentColor"/></svg>',
};

/* --- boot ---------------------------------------------------------------- */
let pollTimer = null;

async function boot() {
  state.layers = blank();
  state.workspace = store('workspace') || 'watch';
  state.speed = 1;
  document.body.classList.toggle('rail-open', store('railOpen') === '1');
  if (store('dock') === 'on') setDock(true);
  if (currentLang() === 'ur') setLang('ur');

  const pop = applyPopMode();
  initPop();
  initMap();
  initLayers();
  initTools();
  initMenu();
  initAssistant();
  initVoice();
  loadGuidance();
  bindEvents();
  bindBus();
  setWorkspace(state.workspace === 'brief' ? 'watch' : state.workspace, true);

  setRefresher(refresh);
  await refresh();
  pollTimer = setInterval(refresh, 3000);

  if (pop) applyPopView(pop);
  else if (store('introSeen') !== '1' || new URLSearchParams(location.search).has('intro')) showIntro();
}

/* --- 12.3 the poll ------------------------------------------------------- */
let lastRibbon = 0, lastIntel = 0, lastDecisions = 0;

async function refresh() {
  let data = null;
  try {
    const r = await fetch('/api/clp');
    if (!r.ok) throw new Error(String(r.status));
    data = await r.json();
  } catch (e) {
    state.failures++;
    document.body.classList.remove('live-on');
    // Two consecutive failures with no data: say so, rather than showing stale figures silently.
    if (state.failures >= 2 && !state.data) document.getElementById('map-empty').hidden = false;
    return;
  }
  state.failures = 0;
  document.body.classList.add('live-on');
  document.getElementById('map-empty').hidden = true;

  const first = !state.data;
  state.data = replayOverlay(data);
  state.speed = data.clock?.speed ?? 1;

  if (first) { renderLayers(); fitAll(); }
  syncMap();
  syncMissions();
  renderMissionPanel();
  if (first) renderLegend();
  renderHeader();
  renderRail();
  renderFindings();
  renderTabs();
  renderDetail();
  renderBoard();
  renderAlerts();
  renderPlan();
  renderOptions();
  if (isFeedOpen()) renderFeed();
  changePulse();
  decorateNotes();
  renderLegend();

  const now = Date.now();
  if (document.body.classList.contains('wall') && now - lastRibbon > 9000) { lastRibbon = now; refreshRibbon(); }
  if (state.board === 'intel' && now - lastIntel > 15000) { lastIntel = now; loadIntel(); }
  if (state.board === 'decisions' && now - lastDecisions > 5000) { lastDecisions = now; loadDecisions(); }
}

async function loadIntel() {
  try { state.intel = await (await fetch('/api/intel?hours=48')).json(); renderBoard(); } catch (e) {}
}
async function loadDecisions() {
  try { state.decisions = await (await fetch('/api/decisions')).json(); renderBoard(); } catch (e) {}
}

function renderHeader() {
  const d = state.data;
  const force = state.layers?.force || 'own';
  const name = force === 'opp'
    ? `${d.opposing.meta.command} · assessed`
    : `${d.meta.command} · ${d.meta.subtitle}`;
  const el = document.getElementById('command-name');
  if (el.textContent !== name) el.textContent = name;
  const dtgEl = document.getElementById('asof-dtg');
  const t = dtg(state.replay != null ? d.history[state.replay]?.t : d.simTime);
  if (dtgEl.textContent !== t) dtgEl.textContent = t;
}

/* --- 16.2 the change pulse ----------------------------------------------- */
const lastValues = new Map();
function changePulse() {
  for (const el of document.querySelectorAll('.kpi, .gauge, .fact, .ladder-row')) {
    const label = el.querySelector('.k, .g-n, .nm')?.textContent?.trim();
    const valueEl = el.querySelector('.v, .g-v, .fig');
    if (!label || !valueEl) continue;
    const host = el.closest('[id]')?.id || 'x';
    const key = `${host}|${label}`;
    const value = valueEl.textContent.trim();
    const prev = lastValues.get(key);
    if (prev !== undefined && prev !== value) {
      valueEl.classList.remove('fig-pulse');
      void valueEl.offsetWidth;                 // restart the animation
      valueEl.classList.add('fig-pulse');
    }
    lastValues.set(key, value);
  }
}

/* --- 8.5 notes behind an ⓘ ----------------------------------------------- */
function decorateNotes() {
  for (const root of ['#side', '#board-body', '#rail']) {
    const host = document.querySelector(root);
    if (!host) continue;
    for (const blk of host.querySelectorAll('.d-b, .panel, .dz-rec, .blk')) {
      if (!blk.querySelector(':scope > .note, :scope > .panel-b > .note')) continue;
      const heading = blk.querySelector('h2, h4, .panel-h b, .lbl');
      if (!heading || heading.querySelector('.i-btn')) continue;
      const title = heading.textContent.trim();
      const btn = document.createElement('button');
      btn.className = 'i-btn';
      btn.type = 'button';
      btn.textContent = 'ⓘ';
      btn.setAttribute('aria-label', `Explain ${title}`);
      btn.setAttribute('aria-pressed', String(state.openNotes.has(title)));
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const on = !state.openNotes.has(title);
        if (on) state.openNotes.add(title); else state.openNotes.delete(title);
        blk.classList.toggle('show-notes', on);
        btn.setAttribute('aria-pressed', String(on));
      });
      heading.appendChild(btn);
      blk.classList.toggle('show-notes', state.openNotes.has(title));
    }
  }
}
let noteObserver = new MutationObserver(debounce(decorateNotes, 60));
for (const root of ['#side', '#board-body', '#rail']) {
  const el = document.querySelector(root);
  if (el) noteObserver.observe(el, { childList: true, subtree: true });
}

/* --- panes and tabs ------------------------------------------------------ */
function paneExists(id) {
  if (PANES[id]) return true;
  if (id === 'detail') return !!state.selected;
  if (id === 'plan') return !!state.plan;
  if (id === 'mission') return (state.data?.missions || []).length > 0;
  return false;
}

function renderTabs() {
  const host = document.getElementById('side-tabs');
  if (!host) return;
  const ids = Object.keys(PANES).filter(paneExists);
  if (!ids.includes(state.side)) state.side = 'assistant';
  const html = ids.map(id => `<button role="tab" data-side="${id}" aria-selected="${state.side === id}"
      aria-controls="${id}" tabindex="${state.side === id ? 0 : -1}">
      ${TAB_ICON[id]}<span class="tb">${esc(TAB_LABEL[id])}</span>
      ${PANES[id] ? '' : `<span class="tab-x" data-close-pane="${id}" role="button" tabindex="0" aria-label="Close ${esc(TAB_LABEL[id])}">×</span>`}
    </button>`).join('') +
    `<button class="btn-sm quiet pop-out" data-pop="side" title="Open this pane in its own window">Pop out</button>`;
  setHtml(host, html);
  for (const id of Object.keys(PANES)) {
    const el = document.getElementById(id);
    if (el) el.hidden = id !== state.side;
  }
  const active = document.getElementById(state.side);
  if (active) {
    active.classList.remove('is-in');
    void active.offsetWidth;
    active.classList.add('is-in');
  }
}

function showPane(id) {
  if (!paneExists(id)) id = 'assistant';
  state.side = id;
  renderTabs();
  emit('pane', id);
  // Decide's geometry belongs to Decide.
  drawDecideLayer();
  if (id !== 'options') groups().decide?.clearLayers();
}

function closePane(id) {
  if (id === 'detail') select(null);
  else if (id === 'plan') { discardPlan(); clearDrawings(); }
  else if (id === 'mission') {
    const airborne = (state.data?.missions || []).some(m => m.state === 'airborne');
    if (airborne && !confirm('A mission is airborne. Delete every mission?')) return;
    post('/api/missions?all=1', undefined, 'DELETE').catch(() => {});
  }
  showPane('assistant');
}

/* --- selection ----------------------------------------------------------- */
function select(sel) {
  state.selected = sel;
  emit('select', sel);
  renderTabs();
  renderDetail();
  if (sel) showPane('detail');
  syncMap();
}

/* --- 6.3 workspaces ------------------------------------------------------ */
function setWorkspace(name, quiet) {
  const w = WS[name];
  if (!w) return;
  state.workspace = name;
  for (const k of Object.keys(WS)) document.body.classList.toggle('ws-' + k, k === name);
  document.documentElement.style.setProperty('--side-w', w.side + 'px');
  store('sideW', String(w.side));
  if (name !== 'brief') store('workspace', name);
  if (state.layers) { state.layers.collapsed = !w.layers; renderLayers(); }
  setWall(w.wall, true);
  showPane(paneExists(w.tab) ? w.tab : 'assistant');
  if (!quiet) emit('workspace', name);
  invalidate();
}

function setWall(on_, quiet) {
  const was = document.body.classList.contains('wall');
  document.body.classList.toggle('wall', !!on_);
  if (on_ === was) return;
  if (on_) { refreshRibbon(true); startWall(); }
  else { stopWall(); if (state.board) openBoard(null); }
  invalidate();
  scheduleCollide();
}

/* --- 7.6 the ask bar ----------------------------------------------------- */
function setDock(on_) {
  document.body.classList.toggle('dock-on', !!on_);
  const dock = document.getElementById('dock');
  const slot = document.getElementById('dock-slot');
  const form = document.getElementById('chat-form');
  const pane = document.getElementById('assistant');
  dock.hidden = !on_;
  // Move the actual form element, so its submit and key handlers travel with it.
  if (on_) slot.appendChild(form);
  else { pane.appendChild(form); showPane('assistant'); }
  document.documentElement.style.setProperty('--dock-h', on_ ? '56px' : '0px');
  store('dock', on_ ? 'on' : 'off');
  invalidate();
}

/* --- 15.2 the click router ----------------------------------------------
   One delegated listener, in a fixed order, each branch returning. */
function bindEvents() {
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('mouseover', onHover);
  document.addEventListener('mouseout', e => { if (e.target.closest?.('[data-hover]')) setHover(null); });
  bindResize();
  bindDrag();

  document.getElementById('btn-rail').addEventListener('click', () => toggleRail());
  document.getElementById('btn-alerts').addEventListener('click', e => { e.stopPropagation(); toggleAlerts(); });
  document.getElementById('btn-more').addEventListener('click', e => { e.stopPropagation(); toggleMore(); });
  document.getElementById('btn-clear-chat').addEventListener('click', clearChat);
  document.getElementById('btn-clear-map').addEventListener('click', clearEverything);
  document.getElementById('btn-dock').addEventListener('click', () => setDock(!document.body.classList.contains('dock-on')));
  document.getElementById('btn-guidance').addEventListener('click', () => document.getElementById('guidance-file').click());
  document.getElementById('guidance-file').addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) uploadGuidance(f);
    e.target.value = '';
  });
  const mic = document.getElementById('btn-mic');
  mic.addEventListener('pointerdown', startTalking);
  mic.addEventListener('pointerup', stopTalking);
  mic.addEventListener('pointerleave', stopTalking);

  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('.alerts')) toggleAlerts(false);
    if (!e.target.closest('.more')) toggleMore(false);
  });
  window.addEventListener('resize', () => { invalidate(); scheduleCollide(); });
}

async function onClick(e) {
  const t = e.target;
  if (!(t instanceof Element)) return;

  // 1. mutations that post
  const taskDone = t.closest('[data-task-complete]');
  if (taskDone) return void post(`/api/tasks/${taskDone.dataset.taskComplete}/complete`, {}).catch(noop);
  const sRel = t.closest('[data-strike-release]');
  if (sRel) return void post(`/api/strikes/${sRel.dataset.strikeRelease}/release`, {}).catch(noop);
  const sRes = t.closest('[data-strike-resolve]');
  if (sRes) return void post(`/api/strikes/${sRes.dataset.strikeResolve}/resolve`, {}).catch(noop);

  const ex = t.closest('[data-exchange]');
  if (ex) {
    if (ex.dataset.exchange === 'off') { state.exchange = null; renderBoard(); return; }
    try {
      const r = await fetch('/api/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rung: Number(ex.dataset.exchange) || 3, horizonDays: 5 }) });
      state.exchange = await r.json();
      renderBoard();
    } catch (err) { noop(); }
    return;
  }

  const obs = t.closest('[data-obs]');
  if (obs) return void reviewObservation(obs.dataset.obs).catch(noop);

  const strike = t.closest('[data-strike]');
  if (strike) { const [k, id] = strike.dataset.strike.split(':'); return void runStrike(k, id, state.rung || 3).catch(noop); }

  // 2. navigation
  const sel = t.closest('[data-select]');
  if (sel && !t.closest('input')) {
    e.preventDefault();
    const [kind, id] = sel.dataset.select.split(':');
    if (state.board) openBoard(null);           // it closes any open board and selects
    select(byId(kind, id) ? { kind, id } : null);
    return;
  }
  const ws = t.closest('[data-ws]'); if (ws) return setWorkspace(ws.dataset.ws);
  const tool = t.closest('[data-tool]');
  if (tool) {
    const k = tool.dataset.tool;
    if (k === 'clear') { clearEverything(); return; }
    if (k === 'plan' && !state.plan) state.plan = newPlan();
    setTool(k);
    if (k === 'plan') { renderTabs(); showPane('plan'); }
    return;
  }
  const closeP = t.closest('[data-close-pane]');
  if (closeP) { e.stopPropagation(); return closePane(closeP.dataset.closePane); }
  const board = t.closest('[data-board]');
  if (board) { openBoard(board.dataset.board || null); restartCycleAt(board.dataset.board);
    if (board.dataset.board === 'intel') loadIntel();
    if (board.dataset.board === 'decisions') loadDecisions();
    return; }
  const side = t.closest('[data-side]'); if (side) return showPane(side.dataset.side);

  const scen = t.closest('[data-scenario]');
  if (scen) { try { await post('/api/scenario', { id: scen.dataset.scenario }); emit('scenario-changed', scen.dataset.scenario); } catch (err) { noop(); } return; }

  const askBtn = t.closest('[data-ask]'); if (askBtn) { showPane('assistant'); return ask(askBtn.dataset.ask); }
  const askAbout = t.closest('[data-ask-about]');
  if (askAbout) {
    const [k, id] = askAbout.dataset.askAbout.split(':');
    const o = byId(k, id);
    showPane('assistant');
    return ask(`Tell me about ${o?.name || id}`);
  }

  const rs = t.closest('[data-route-status]');
  if (rs) { const [id, st_] = rs.dataset.routeStatus.split(':'); return void post(`/api/routes/${id}/status`, { status: st_ }).catch(noop); }
  const relV = t.closest('[data-reserve-release]');
  if (relV) return void post(`/api/reserves/${relV.dataset.reserveRelease}/release`, {}).catch(noop);
  const recV = t.closest('[data-reserve-recall]');
  if (recV) return void post(`/api/reserves/${recV.dataset.reserveRecall}/recall`, {}).catch(noop);
  const engr = t.closest('[data-engr-complete]');
  if (engr) return void post(`/api/engineering/${engr.dataset.engrComplete}/complete`, {}).catch(noop);

  const sp = t.closest('[data-speed]');
  if (sp) { try { await post('/api/speed', { speed: Number(sp.dataset.speed) }); } catch (err) { noop(); } return; }
  const popB = t.closest('[data-pop]');
  if (popB) return openPop(popB.dataset.pop, popB.dataset.pop === 'board' ? (state.board || 'assets') : state.side);
  const role = t.closest('[data-role]');
  if (role) { setRole(role.dataset.role); toggleMore(false); return; }

  const act = t.closest('[data-agent-act]');
  if (act) return hardApprove(act, () => post('/api/agent/act', { id: act.dataset.agentAct, record: screenRecord() }));
  const cardAct = t.closest('[data-card-act]');
  if (cardAct) {
    const id = cardAct.dataset.cardAct;
    if (id.startsWith('folder:')) { const [, k, i] = id.split(':'); return openTerrain(k, i); }
    return hardApprove(cardAct, () => post('/api/agent/act', { id, record: screenRecord() }));
  }
  const fold = t.closest('[data-card-fold]'); if (fold) return toggleCard(fold.dataset.cardFold);
  const gdel = t.closest('[data-guidance-del]'); if (gdel) return void deleteGuidance(gdel.dataset.guidanceDel);

  const intro = t.closest('[data-intro]');
  if (intro) {
    closeIntro();
    const k = intro.dataset.intro;
    if (k === 'brief') startBrief();
    if (k === 'case') startCase();
    if (k === 'tour') startTour();
    return;
  }
  const tourB = t.closest('[data-tour]');
  if (tourB) { const k = tourB.dataset.tour; if (k === 'close') closeTour(); else stepTour(k === 'next' ? 1 : -1); return; }
  const briefB = t.closest('[data-brief]');
  if (briefB) { const k = briefB.dataset.brief; if (k === 'close') closeBrief(); else stepBrief(k === 'next' ? 1 : -1); return; }
  if (t.closest('[data-case]')) return startCase();

  if (handleLayersClick(t)) return;

  // 3. Decide
  const opt = t.closest('[data-option]');
  if (opt && !t.closest('[data-option-choose]')) return chooseCourse(opt.dataset.option);
  const oc = t.closest('[data-option-choose]'); if (oc) { e.stopPropagation(); return tickCourse(oc.dataset.optionChoose); }
  const op = t.closest('[data-option-plan]');
  if (op) {
    const c = state.estimate?.courses.find(x => x.id === op.dataset.optionPlan);
    state.plan = newPlan({ name: c?.name || 'Plan', mission: c?.statement || '' });
    assess(); renderTabs(); showPane('plan');
    return;
  }
  if (t.closest('[data-decide-run]')) return void runEstimate().catch(noop);
  if (t.closest('[data-decide-clear]')) return clearDecide();
  const dsit = t.closest('[data-decide-situation]'); if (dsit) return void runEstimate({ situation: dsit.dataset.decideSituation }).catch(noop);
  const drung = t.closest('[data-decide-rung]'); if (drung) return void runEstimate({ rung: Number(drung.dataset.decideRung) }).catch(noop);
  if (t.closest('[data-intent-build]')) return void buildIntent().catch(noop);
  if (t.closest('[data-intent-clear]')) return void clearIntent().catch(noop);

  // 4. Plan
  const phAdd = t.closest('[data-ph-add]');
  if (phAdd) return editPlan(p => p.phases.push({ name: 'New phase', type: 'prepare', days: 1 }));
  const phDel = t.closest('[data-ph-del]');
  if (phDel) return editPlan(p => p.phases.splice(Number(phDel.dataset.phDel), 1));
  const assign = t.closest('[data-assign]'); if (assign) return assignUnit(assign.dataset.assign);
  if (t.closest('[data-plan-save]')) { savePlans(); return; }
  if (t.closest('[data-plan-discard]')) { discardPlan(); clearDrawings(); renderTabs(); showPane('assistant'); return; }

  // 5. mission, feed, terrain
  const mp = t.closest('[data-mission-pick]'); if (mp) { state.missionId = mp.dataset.missionPick; return renderMissionPanel(); }
  const ma = t.closest('[data-mission-act]');
  if (ma) { const [a, id] = ma.dataset.missionAct.split(':'); return void missionAct(a, id).catch(noop); }
  const fo = t.closest('[data-feed-open]'); if (fo) return openFeed(fo.dataset.feedOpen);
  if (t.closest('[data-feed-close]')) return closeFeed();
  const fs = t.closest('[data-feed-sensor]'); if (fs) return setSensor(fs.dataset.feedSensor);
  const fz = t.closest('[data-feed-zoom]'); if (fz) return zoomFeed(Number(fz.dataset.feedZoom));
  const tt = t.closest('[data-terrain-target]');
  if (tt) { const [k, id] = tt.dataset.terrainTarget.split(':'); return openTerrain(k, id); }
  if (t.closest('[data-terrain-open]')) {
    const s = state.selected;
    const target = s && isOpp(s.kind) ? s : { kind: 'oasset', id: 'oa-pin' };
    return openTerrain(target.kind, target.id);
  }
  if (t.closest('[data-terrain-close]')) return closeTerrain();
  if (t.closest('[data-terrain-side]')) return toggleTerrainSide();
  if (t.closest('[data-terrain-play]')) return playSequence();
  const te = t.closest('[data-terrain-el]'); if (te) return terrainElement(te.dataset.terrainEl);

  // 6. header, replay, menus
  if (t.closest('[data-ack-all]')) return ackAll();
  const rep = t.closest('[data-replay]');
  if (rep) { const k = rep.dataset.replay; if (k === 'play') playReplay(); else backToLive(); return; }
  const focusT = t.closest('[data-focus-target]');
  if (focusT) { const [k, id] = focusT.dataset.focusTarget.split(':'); if (state.board) openBoard(null); return focusOn(k, id); }
  const legendT = t.closest('[data-legend-toggle]');
  if (legendT) { const el = document.getElementById('legend'); const open = !el.classList.contains('is-open');
    store('legend', open ? 'open' : 'shut'); renderLegend(); return; }
  if (t.closest('[data-theme-toggle]')) return toggleTheme();
  if (t.closest('[data-lang-toggle]')) return setLang(currentLang() === 'ur' ? 'en' : 'ur');
  if (t.closest('[data-reset]')) { if (confirm('Reset the picture to its starting state?')) await post('/api/reset', {}).catch(noop); toggleMore(false); return; }
  const prod = t.closest('[data-product]'); if (prod) { toggleMore(false); return openProduct(prod.dataset.product); }
  if (t.closest('[data-help]')) { toggleMore(false); return showHelp(); }
  if (t.closest('[data-palette]')) { toggleMore(false); return openPalette(); }
  if (t.closest('[data-wall]')) { toggleMore(false); return setWall(!document.body.classList.contains('wall')); }
  const pal = t.closest('[data-pal]'); if (pal) return runRow(Number(pal.dataset.pal));

  // 7. the context menu's own actions
  const cg = t.closest('[data-copy-grid]');
  if (cg) { navigator.clipboard?.writeText(cg.dataset.copyGrid).catch(noop); closeMenu(); return; }
  const mRange = t.closest('[data-menu-range]'); if (mRange) { closeMenu(); return setTool('range'); }
  const mMeas = t.closest('[data-menu-measure]'); if (mMeas) { closeMenu(); return setTool('measure'); }
  const mPlan = t.closest('[data-menu-plan]');
  if (mPlan) { closeMenu(); if (!state.plan) state.plan = newPlan(); setTool('plan'); renderTabs(); return; }

  if (t.closest('.scrim') && t.classList.contains('scrim')) { closeHelp(); closeIntro(); closePalette(); }
}

// 8.6 An approval for a hard decision is approved twice.
const pending = new Map();
function hardApprove(btn, run) {
  if (btn.dataset.hard !== '1') return void run().catch(noop);
  const id = btn.dataset.agentAct || btn.dataset.cardAct;
  if (pending.has(id)) {
    clearTimeout(pending.get(id).timer);
    pending.delete(id);
    return void run().catch(noop);
  }
  const original = btn.textContent;
  btn.textContent = `Warnings read · approve: ${original}`;
  btn.classList.add('confirm');
  // The confirmation lapses after 20 s.
  const timer = setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('confirm');
    pending.delete(id);
  }, 20000);
  pending.set(id, { timer, at: Date.now() });
}

// What was on screen, for how long, and which warning codes were shown.
function screenRecord() {
  const warnings = [...document.querySelectorAll('.ac-warn .w .f')].map(el => el.textContent.trim());
  return {
    at: new Date().toISOString(),
    board: state.board, side: state.side,
    selected: state.selected, scenario: state.data?.selectedScenario,
    warningsShown: warnings,
    secondsOnScreen: Math.round((Date.now() - (window.__shownAt || Date.now())) / 1000),
    role: getRole(),
  };
}

function onHover(e) {
  const t = e.target.closest?.('[data-hover], .sys-row[data-select], .fleet [data-select], .finding[data-select]');
  if (!t) return;
  const raw = t.dataset.hover || t.dataset.select;
  if (!raw) return;
  const [kind, id] = raw.split(':');
  setHover(kind, id);
}

/* --- 15.1 keyboard ------------------------------------------------------- */
function onKey(e) {
  // While the palette is open, no other key is handled.
  if (isPaletteOpen()) return void paletteKey(e);

  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  if (typing) {
    if (e.key === 'Escape') e.target.blur();
    if (e.key === 'Enter' && activeTool() === 'plan') { e.preventDefault(); finishPlan(); }
    return;
  }

  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); return openPalette(); }
  if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? redoPlan() : undoPlan(); }
  if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); return redoPlan(); }
  // Browser chords are left to the browser: never swallow reload, print, save,
  // select-all or tab switching.
  if (meta || e.altKey) {
    // Alt+digit does not reliably produce a digit in e.key — on several layouts it
    // yields a symbol — so match the physical key instead.
    const digit = /^Digit([1-4])$/.exec(e.code || '')?.[1] ?? (['1', '2', '3', '4'].includes(e.key) ? e.key : null);
    if (e.altKey && digit) {
      e.preventDefault();
      return setWorkspace(['watch', 'plan', 'agent', 'brief'][Number(digit) - 1]);
    }
    return;
  }

  switch (e.key) {
    case '/': e.preventDefault(); return openPalette();
    case 's': case 'S': return toggleRail();
    case 'l': case 'L': if (state.layers) { state.layers.collapsed = !state.layers.collapsed; renderLayers(); } return;
    case 'b': case 'B': return openBoard(state.board ? null : boardsFor(state.layers?.force)[0][0]);
    case '1': return setForce('own');
    case '2': return setForce('opp');
    case '3': return setForce('both');
    case 'p': case 'P': if (!state.plan) state.plan = newPlan(); setTool('plan'); renderTabs(); return;
    case 'm': case 'M': return setTool('measure');
    case 'r': case 'R': return setTool('range');
    case 'a': case 'A': return toggleAlerts();
    case 'w': case 'W': return setWall(!document.body.classList.contains('wall'));
    case '?': return showHelp();
    case 'ArrowRight': case 'PageDown': if (briefOpen()) { e.preventDefault(); stepBrief(1); } return;
    case 'ArrowLeft': case 'PageUp': if (briefOpen()) { e.preventDefault(); stepBrief(-1); } return;
    case 'Enter': case ' ':
      if (e.target.getAttribute?.('role') === 'button') { e.preventDefault(); e.target.click(); }
      return;
    case 'Escape': return escapeChain();
    default: return;
  }
}

// Escape, in order.
function escapeChain() {
  const lb = document.getElementById('lightbox');
  if (lb && !lb.hidden) { lb.hidden = true; return; }
  if (productOpen()) return closeProduct();
  if (!document.getElementById('cmenu').hidden) return closeMenu();
  if (isFeedOpen()) return closeFeed();
  if (terrainOpen()) return closeTerrain();
  if (tourOpen()) return closeTour();
  if (!document.getElementById('help').hidden) return closeHelp();
  if (!document.getElementById('more-pop').hidden) return toggleMore(false);
  if (briefOpen()) return closeBrief();
  if (activeTool()) return clearTool();
  if (state.board) return openBoard(null);
  if (document.body.classList.contains('rail-open')) return toggleRail(false);
  if (state.selected) return select(null);
}

/* --- the More menu ------------------------------------------------------- */
let roles = [];
fetch('/api/roles').then(r => r.json()).then(r => { roles = r; }).catch(noop);

function toggleMore(force) {
  const pop = document.getElementById('more-pop');
  const btn = document.getElementById('btn-more');
  const open = force ?? pop.hidden;
  pop.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (!open) return;
  const d = state.data;
  setHtml(pop, `
    <div class="pop-sec">
      <button class="pop-item" data-brief="start">Brief</button>
      <button class="pop-item" data-palette="1">Find <kbd>⌘K</kbd></button>
      <button class="pop-item" data-wall="1">Wall <kbd>W</kbd></button>
      <button class="pop-item" data-board="${esc(boardsFor(state.layers?.force)[0][0])}">Boards <kbd>B</kbd></button>
    </div>
    <div class="pop-sec"><span class="lbl">Role</span>
      <div style="padding:0 12px"><div class="seg-group" role="radiogroup" aria-label="Role" style="flex-wrap:wrap">
        ${roles.map(r => `<button class="seg ${getRole() === r.id ? 'is-on' : ''}" data-role="${esc(r.id)}"
          title="${esc(r.note)}">${esc(r.name)}</button>`).join('')}
      </div></div>
    </div>
    <div class="pop-sec"><span class="lbl">Measured against</span>
      <div style="padding:0 12px">${(d?.scenarios || []).map(s =>
        `<button class="pop-item" data-scenario="${esc(s.id)}" style="padding-left:0">
          ${esc(s.name)}<span class="dim">${s.requiredDays} d${d.selectedScenario === s.id ? ' · measured' : ''}</span></button>`).join('')}</div>
    </div>
    ${clockControl(true)}
    <div class="pop-sec">
      <button class="pop-item" data-product="brief">Decision brief</button>
      <button class="pop-item" data-help="1">Shortcuts <kbd>?</kbd></button>
    </div>
    <div class="pop-sec"><span class="lbl">Layout</span>
      <div style="padding:0 12px"><div class="seg-group" role="radiogroup" aria-label="Layout">
        ${['watch', 'plan', 'agent'].map(k => `<button class="seg ${state.workspace === k ? 'is-on' : ''}"
          data-ws="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}
      </div></div>
    </div>
    <div class="pop-sec"><span class="lbl">Other pictures</span>
      <button class="pop-item" disabled>Common Operational Picture</button>
      <button class="pop-item" disabled>Common Intelligence Picture</button>
    </div>
    <div class="pop-sec"><button class="pop-item danger" data-reset="1">Reset the picture</button></div>`);

  const range = document.getElementById('replay-range');
  if (range) range.addEventListener('input', () => setReplay(Number(range.value)));
}

/* --- shortcuts ----------------------------------------------------------- */
const SHORTCUTS = [
  ['⌘K / Ctrl+K / /', 'Find'], ['S', 'Status rail'], ['L', 'Layers'], ['B', 'Boards'],
  ['1 2 3', 'Own · Opposing · Both'], ['P', 'Draw a plan'], ['M / R', 'Measure · Range'],
  ['A', 'Alerts'], ['W', 'Wall mode'], ['?', 'This card'],
  ['Alt+1…4', 'Workspace'], ['← →', 'Step the brief'],
  ['⌘Z / ⌘⇧Z', 'Undo · redo a plan edit'], ['Esc', 'Close the topmost thing'],
];
function showHelp() {
  const host = document.getElementById('help');
  host.hidden = false;
  host.innerHTML = `<div class="ov" role="dialog" aria-label="Shortcuts">
    <div class="ov-h"><span class="lbl">Keyboard</span></div>
    <div class="ov-b"><dl>${SHORTCUTS.map(([k, v]) =>
      `<dt><kbd>${esc(k)}</kbd></dt><dd>${esc(v)}</dd>`).join('')}</dl></div>
    <div class="ov-f"><button class="btn btn-sm" data-help-close="1">Close</button></div></div>`;
  host.addEventListener('click', e => { if (e.target === host || e.target.closest('[data-help-close]')) closeHelp(); });
}
function closeHelp() { const h = document.getElementById('help'); if (h) { h.hidden = true; h.innerHTML = ''; } }

/* --- theme --------------------------------------------------------------- */
function toggleTheme() {
  const light = document.documentElement.dataset.theme === 'light';
  document.documentElement.dataset.theme = light ? 'dark' : 'light';
  store('theme', light ? 'dark' : 'light');
  emit('theme', light ? 'dark' : 'light');
  renderLayers();
}

/* --- resize -------------------------------------------------------------- */
function bindResize() {
  const handle = document.getElementById('side-handle');
  if (!handle) return;
  let dragging = false;
  handle.addEventListener('pointerdown', e => {
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const w = Math.max(340, Math.min(760, e.clientX));
    document.documentElement.style.setProperty('--side-w', w + 'px');
    invalidate();
  });
  const end = e => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('resizing');
    const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--side-w'), 10);
    store('sideW', String(w));
    invalidate();
    scheduleCollide();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', () => {
    document.documentElement.style.setProperty('--side-w', '440px');
    store('sideW', '440');
    invalidate();
  });
}

/* --- 15.5 drag a formation onto the plan --------------------------------- */
function bindDrag() {
  document.addEventListener('dragstart', e => {
    const el = e.target.closest?.('[data-select^="unit:"]');
    if (!el) return;
    e.dataTransfer.setData('text/plain', el.dataset.select);
    document.body.classList.add('dragging-unit');
  });
  document.addEventListener('dragend', () => document.body.classList.remove('dragging-unit'));
  for (const id of ['map', 'plan']) {
    const host = document.getElementById(id);
    if (!host) continue;
    host.addEventListener('dragover', e => { if (document.body.classList.contains('dragging-unit')) e.preventDefault(); });
    host.addEventListener('drop', e => {
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw?.startsWith('unit:')) return;
      e.preventDefault();
      if (!state.plan) state.plan = newPlan();
      assignUnit(raw.split(':')[1]);
      renderTabs();
      showPane('plan');
    });
  }
  // mark every formation row draggable after each render
  new MutationObserver(debounce(() => {
    for (const el of document.querySelectorAll('[data-select^="unit:"]')) el.draggable = true;
  }, 80)).observe(document.body, { childList: true, subtree: true });
}

/* --- the bus ------------------------------------------------------------- */
function bindBus() {
  on('select', sel => { if (sel !== state.selected) { state.selected = sel; renderTabs(); renderDetail(); } });
  on('select-remote', sel => select(sel));
  on('board', id => openBoard(id));
  on('side', pane => showPane(pane === 'pane-plan' ? 'plan' : pane));
  on('force-request', f => setForce(f));
  on('tool-request', t => setTool(t));
  on('agent-map', scene => drawScene(scene, 'agent'));
  on('agent-layer-clear', clearAgentLayer);
  on('map-clear', clearEverything);
  on('decide-draw', scene => drawScene(scene, 'decide'));
  on('decide-clear', () => groups().decide?.clearLayers());
  on('focus-target', t => { if (!t) return; const [k, id] = String(t).split(':'); focusOn(k, id); });
  on('mission-focus', id => { state.missionId = id; renderTabs(); showPane('mission'); renderMissionPanel(); });
  on('map-click', () => { if (document.body.classList.contains('rail-open')) toggleRail(false); });
  on('board-open', () => { if (state.board === 'intel') loadIntel(); if (state.board === 'decisions') loadDecisions(); });
  on('plan-drawn', () => { renderTabs(); showPane('plan'); });
  on('plan-discard', () => renderTabs());
  on('theme', () => renderLegend());
  on('layers-changed', () => { renderLegend(); renderRail(); });
  on('force', () => {
    // Switching the force swaps the board list and closes a board that belongs to the other side.
    if (state.board) {
      const oppNow = (state.layers.force === 'opp');
      if (isOppBoard(state.board) !== oppNow) openBoard(null); else renderBoard();
    }
    renderRail(); renderHeader();
  });
  on('replay', () => { if (state.data) { state.data = replayOverlay(state.data); renderRail(); renderBoard(); } });
  on('palette-run', act => {
    if (act.select) { const [k, id] = act.select.split(':'); select({ kind: k, id }); }
    if (act.board) openBoard(act.board);
    if (act.preset) applyPreset(act.preset);
    if (act.force) setForce(act.force);
    if (act.tool) setTool(act.tool);
    if (act.scenario) post('/api/scenario', { id: act.scenario }).catch(noop);
    if (act.release) post(`/api/reserves/${act.release}/release`, {}).catch(noop);
    if (act.wall) setWall(true);
    if (act.rail) toggleRail(true);
    if (act.brief) startBrief();
    if (act.case) startCase();
    if (act.intro) showIntro();
  });
  on('brief-act', act => {
    if (act.rail) toggleRail(true);
    if (act.board) openBoard(act.board);
    if (act.force) setForce(act.force);
    if (act.preset) applyPreset(act.preset);
    if (act.side) showPane(act.side);
  });
  on('scenario-at', s => {
    if (!s) return;
    if (s.force) setForce(s.force);
    if (s.board !== undefined) openBoard(s.board);
    if (s.select) { const [k, id] = s.select.split(':'); select(byId(k, id) ? { kind: k, id } : null); }
  });
  on('scenario-leave', () => { openBoard(null); });
  on('pane', () => { syncMissions(); invalidate(); });
  on('rail', () => invalidate());
  on('intent-changed', () => refresh());
  on('agent-acted', () => refresh());
}

// A function declaration, not a const: this is used during module evaluation.
function noop() {}

function clearEverything() {
  clearAgentLayer();
  groups().decide?.clearLayers();
  clearDrawings();
  clearTool();
  emit('map-cleared');
}

/* --- pop-out ------------------------------------------------------------- */
function applyPopView(pop) {
  if (pop.kind === 'board') openBoard(pop.id);
  if (pop.kind === 'side') showPane(pop.id);
}

window.__shownAt = Date.now();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

export { refresh, select, showPane, setWorkspace, setWall, setDock };
