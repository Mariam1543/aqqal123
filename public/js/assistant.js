// The conversation, the SSE client, the card family and the fold pass.
// Names no model, anywhere.

import {
  state, emit, on, esc, num, days, pct, dtg, setHtml, cls, st as stCls,
  session, post, byId, classShort,
} from './state.js';

const messages = [];          // { role, content, cards[], actions, working, mode }
const openCards = new Set();  // held by index, so a card the reader opened stays open
let streaming = false;

export function initAssistant() {
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  form.addEventListener('submit', e => { e.preventDefault(); send(input.value); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(140, input.scrollHeight) + 'px';
  });
  fetch('/api/agent/status').then(r => r.json()).then(s => {
    if (s.speech) document.getElementById('btn-mic').hidden = false;
    setMode(s.mode, s.label);
  }).catch(() => {});
  render();
}

export function ask(text) { send(text); }

export function clearChat() {
  messages.length = 0;
  openCards.clear();
  render();
}

function setMode(mode, label) {
  const dot = document.getElementById('mode-dot');
  const lbl = document.getElementById('mode-label');
  if (dot) dot.classList.toggle('busy', mode && mode !== 'idle');
  if (lbl) lbl.textContent = label || '';
}

/* --- the stream ---------------------------------------------------------- */
async function send(text) {
  const q = (text || '').trim();
  if (!q || streaming) return;
  const input = document.getElementById('chat-input');
  if (input) { input.value = ''; input.style.height = ''; }

  messages.push({ role: 'user', content: q });
  const bot = { role: 'bot', content: '', cards: [], actions: null, working: true };
  messages.push(bot);
  streaming = true;
  render();

  // Context carries the current selection, the drawn plan, the active pane,
  // the open board and the scenario step.
  const context = {
    selected: state.selected ? { ...state.selected, name: byId(state.selected.kind, state.selected.id)?.name } : null,
    plan: state.plan ? { name: state.plan.name, phases: state.plan.phases, assigned: state.plan.assigned } : null,
    side: state.side, board: state.board, scenario: state.scenario,
    rung: state.rung || 3, situation: state.situation || 'raid',
  };

  let reader = null, finished = false;
  try {
    const res = await fetch('/api/agent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.filter(m => m.role === 'user').map(m => ({ role: 'user', content: m.content })), context, session }),
    });
    if (!res.ok || !res.body) throw new Error('no stream');
    reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) { finished = true; break; }
      buf += dec.decode(value, { stream: true });
      // Frames arrive separated by a blank line.
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = frame.split('\n').find(l => l.startsWith('data: '));
        if (!line) continue;
        let f;
        try { f = JSON.parse(line.slice(6)); } catch (e) { continue; }
        // A frame that throws must not abandon the reader — an abandoned reader shows
        // up as an aborted request and loses every frame after it.
        try { handleFrame(f, bot); } catch (e) { /* the rest of the answer still lands */ }
      }
    }
  } catch (e) {
    if (!bot.content && !bot.cards.length) bot.content = 'The agent could not complete that.';
  } finally {
    // A stream that ran to its end only needs its lock released; one that did not has
    // to be cancelled. Leaving either undone surfaces as an aborted request in the
    // network log even though every frame arrived.
    if (reader) {
      try { if (finished) reader.releaseLock(); else await reader.cancel(); }
      catch (e) { /* already released or closed */ }
    }
    bot.working = false;
    streaming = false;
    setMode('idle', 'Standing by');
    render();
  }
}

function handleFrame(f, bot) {
  switch (f.type) {
    case 'text': bot.content += f.delta || ''; bot.working = false; render(); break;
    case 'mode': setMode(f.mode, f.label); break;
    // The working is the picture's own. A step list is not shown.
    case 'tool': case 'thinking': break;
    case 'card': bot.cards.push(f.card); bot.working = false; render(); break;
    case 'proposal': bot.cards.push({ ...f.proposal, kind: 'proposal' }); render(); break;
    case 'map': emit('agent-map', f.scene); break;
    case 'ui': applyUi(f.ui); break;
    case 'actions': bot.actions = f.actions; render(); break;
    case 'acted': bot.applied = f.applied || 'Applied to the picture'; render(); emit('agent-acted'); break;
    case 'superseded': bot.superseded = (bot.superseded || []).concat(f.ids || []); render(); break;
    case 'intent': emit('intent-changed'); break;
    case 'error': if (!bot.content) bot.content = 'The agent could not complete that.'; break;
    case 'done': break;
    default: break;
  }
}

function applyUi(ui) {
  if (!ui) return;
  switch (ui.type) {
    case 'board': emit('board', ui.board); break;
    case 'select': emit('select', { kind: ui.kind, id: ui.id }); break;
    case 'scenario': emit('scenario-at', ui.scenario); break;
    case 'side': emit('side', ui.pane); break;
    case 'force': emit('force-request', ui.force); break;
    case 'terrain': emit('terrain', ui); break;
    case 'feed': emit('feed', ui); break;
    case 'focus': emit('focus-target', ui.target); break;
    case 'measure': emit('tool-request', 'measure'); break;
    default: break;
  }
}

/* --- tiny, safe markdown -------------------------------------------------
   Escape FIRST, then structure. No HTML from the model ever reaches innerHTML
   unescaped. */
export function md(src) {
  const text = esc(src || '');
  const blocks = text.split(/\n{2,}/);
  return blocks.map(b => {
    const lines = b.split('\n');
    if (lines.every(l => /^\s*-\s+/.test(l))) {
      return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*-\s+/, ''))}</li>`).join('')}</ul>`;
    }
    const h = b.match(/^(#{1,3})\s+(.*)$/);
    if (h) return `<p><strong>${inline(h[2])}</strong></p>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>');
}

/* --- render -------------------------------------------------------------- */
function render() {
  const host = document.getElementById('chat');
  if (!host) return;
  const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 60;

  if (!messages.length) {
    setHtml(host, `<div class="chat-idle">
      <b>Decision agent</b>
      <span class="s">Standing by</span>
      <span class="e">Courses of action, what they hit next, a target folder, a strike option.</span>
    </div>`);
    return;
  }

  let idx = 0;
  const html = messages.map(m => {
    if (m.role === 'user') return `<div class="msg user">${esc(m.content)}</div>`;
    // While the answer is empty and no card has arrived, only the working
    // indicator. No model name, no step list, no reasoning.
    if (m.working && !m.content && !m.cards.length) {
      return `<div class="msg bot"><div class="working"><i></i><i></i><i></i>Working the picture</div></div>`;
    }
    return `<div class="msg bot">` +
      (m.content ? md(m.content) : '') +
      m.cards.map(c => card(c, idx++)).join('') +
      (m.actions?.length ? actionsBlock(m.actions, m.superseded) : '') +
      (m.applied ? `<div class="ac-sec"><span class="lbl">Applied to the picture</span><p>${esc(m.applied)}</p></div>` : '') +
    `</div>`;
  }).join('');

  setHtml(host, html);
  foldPass();
  if (atBottom) host.scrollTop = host.scrollHeight;
}

/* --- 14.2 the card family ------------------------------------------------ */
function card(c, idx) {
  const open = openCards.has(idx);
  const body = cardBody(c);
  return `<article class="acard ${stCls(c.st || 'ACCENT')} ${open ? 'is-open' : ''}" data-card-index="${idx}">
    <header class="ac-head"><div class="ac-top"><div style="min-width:0">
      <span class="ac-kind">${esc(kindLabel(c.kind))}</span>
      <b>${esc(c.title || '')}</b>
    </div>${c.score != null ? `<span class="ac-score">${esc(c.score)}</span>` : ''}</div>
    ${c.sub ? `<span class="ac-sub">${esc(c.sub)}</span>` : ''}</header>` +
    (c.verdict ? `<div class="ac-verdict">${esc(c.verdict)}</div>` : '') +
    body +
    `<footer class="ac-acts">
      ${(c.actions || []).map(a => `<button class="btn btn-sm ${a.kind === 'quiet' ? 'quiet' : ''}"
        data-card-act="${esc(a.id)}" ${a.hard ? 'data-hard="1"' : ''}>${esc(a.label)}</button>`).join('')}
      <button class="btn-sm quiet fold" data-card-fold="${idx}"></button>
    </footer>` +
    (c.note ? `<div class="ac-note">${esc(c.note)}</div>` : '') +
  `</article>`;
}

const KIND_LABEL = {
  target: 'Target', compare: 'Courses', scorecard: 'Scorecard', hypotheses: 'Their courses',
  task: 'Task', release: 'Release', footage: 'Footage', mission: 'Mission',
  detections: 'Detections', analysis: 'Analysis', product: 'Product', effects: 'Effects',
  ad: 'Air defence', force: 'Force', observations: 'Observations', engineering: 'Engineering',
  sequence: 'Sequence', proposal: 'Proposal',
};
const kindLabel = k => KIND_LABEL[k] || 'Answer';

// The generic card, in DOM order. Everything after the figures/table folds.
function cardBody(c) {
  let out = '';
  if (c.warnings?.length) out += warnings(c.warnings);
  if (c.roe) out += roeBlock(c.roe);
  if (c.hero) out += `<div class="ac-sec"><div class="seq-hero">
    <span>${esc(c.hero.before)}</span><span class="ar">→</span><span class="b2">${esc(c.hero.after)}</span></div></div>`;
  if (c.kpis?.length) out += `<div class="ac-kpis">${c.kpis.map(k =>
    `<div class="ac-kpi ${stCls(k.st)}"><span class="k">${esc(k.label)}</span>
      <span class="v">${esc(k.value)}${k.unit ? `<span class="unit">${esc(k.unit)}</span>` : ''}</span>
      ${k.note ? `<span class="n">${esc(k.note)}</span>` : ''}</div>`).join('')}</div>`;
  if (c.table) out += cardTable(c.table);
  if (c.guidance?.length) out += guidanceBlock(c.guidance);
  if (c.items?.length) out += itemsBlock(c.items);
  if (c.escalation) out += escalationBlock(c.escalation);
  if (c.sections?.length) out += c.sections.map(s =>
    `<section class="ac-sec" data-detail><h5>${esc(s.title)}</h5><p>${esc(s.body)}</p></section>`).join('');
  if (c.reaction) out += `<section class="ac-sec" data-detail><h5>Their reaction, our counter</h5>
    <p><strong>Theirs:</strong> ${esc(c.reaction.theirs)}</p><p><strong>Ours:</strong> ${esc(c.reaction.ours)}</p></section>`;
  if (c.timeline?.length) out += `<section class="ac-sec" data-detail><h5>Plan of execution</h5>
    ${c.timeline.map(t => `<div class="fact"><span class="k">${esc(t.phase || t.at)}</span>
      <span class="v" style="font-family:var(--sans);text-align:left">${esc(t.text)}</span></div>`).join('')}</section>`;
  if (c.sequence?.length) out += sequenceBlock(c.sequence);
  if (c.matrix?.length) out += `<section class="ac-sec" data-detail><h5>Synchronisation matrix</h5>
    ${cardTable(c.matrix)}</section>`;
  if (c.decisions?.length) out += `<section class="ac-sec" data-detail><h5>Decisions</h5>
    ${c.decisions.map(x => `<div class="fact"><span class="k">${esc(x.name)}</span><span class="v">${esc(x.by || '')}</span></div>`).join('')}</section>`;
  if (c.why) out += `<section class="ac-sec" data-detail><h5>Why</h5><p>${esc(c.why)}</p></section>`;
  if (c.after) out += `<section class="ac-sec" data-detail><h5>After this</h5><p>${esc(c.after)}</p></section>`;
  if (c.backing?.length) out += `<section class="ac-sec" data-detail><h5>Backing</h5>
    ${c.backing.map(b => `<div class="fact"><span class="k">${esc(b.label)}</span>
      <span class="v">${esc(b.value)}<span class="sub">${esc(b.source || '')}</span></span></div>`).join('')}</section>`;
  return out;
}

function cardTable(t) {
  if (!t?.rows?.length) return '';
  return `<div class="scroll-x" data-cap><table class="ac-tbl">
    <thead><tr>${t.head.map((h, i) => `<th class="${i === 0 ? 'txt' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${t.rows.map(r => `<tr class="${stCls(r.st)}"${r.select ? ` data-select="${esc(r.select)}"` : ''}>
      ${r.cells.map(c => `<td class="${c.num ? 'num' : c.txt ? 'txt' : ''} ${c.more ? 'col-more' : ''} ${c.st ? 'st-fig ' + stCls(c.st) : ''}">
        ${esc(c.t)}${c.sub ? `<span class="sub dim">${esc(c.sub)}</span>` : ''}</td>`).join('')}
    </tr>`).join('')}</tbody></table></div>`;
}

// 8.6 A decision the picture judges hard renders a warnings block.
function warnings(ws) {
  const hard = ws.some(w => /^ESC|^REL/.test(w.code || ''));
  return `<section class="ac-warn ${hard ? '' : 'caution'}">
    <span class="kind">${hard ? 'Hard decision' : 'Caution'}</span>
    ${ws.map(w => `<div class="w"><span>${esc(w.text)}</span><span class="f">${esc(w.figure || '')}</span></div>`).join('')}
  </section>`;
}

function roeBlock(roe) {
  return `<section class="ac-sec" data-detail><h5>Rules of engagement and collateral</h5>
    <div class="fact"><span class="k">Release</span><span class="v">${esc(roe.release || '—')}</span></div>
    ${(roe.rules || []).map(r => `<div class="fact"><span class="k" style="color:var(--ink-2)">${esc(r)}</span><span class="v"></span></div>`).join('')}
    ${roe.collateral ? `<p style="font-size:12.5px;color:var(--ink-2);margin-top:6px">${esc(roe.collateral)}</p>` : ''}
  </section>`;
}

// Escalation stays in the glance: rung, probability above, probability
// strategic, and the one-line answer. A kinetic decision turns on that line.
function escalationBlock(e) {
  return `<section class="ac-sec"><h5>Escalation estimate</h5>
    <div class="ac-kpis" style="margin:0">
      <div class="ac-kpi st-AMBER"><span class="k">Rung</span><span class="v">R${esc(e.rung)}</span>
        <span class="n">${esc(e.rungName || '')}</span></div>
      <div class="ac-kpi ${e.above > 0.5 ? 'st-RED' : 'st-AMBER'}"><span class="k">Answer above</span>
        <span class="v">${pct(e.above)}</span></div>
      <div class="ac-kpi ${e.strategic > 0.05 ? 'st-RED' : 'st-GREEN'}"><span class="k">Strategic</span>
        <span class="v">${pct(e.strategic)}</span></div>
    </div>
    <p style="margin-top:8px;font-size:12.5px;color:var(--ink-2)">${esc(e.answer || '')}</p>
  </section>`;
}

function itemsBlock(items) {
  return `<section class="ac-sec" data-cap>${items.map(i =>
    `<div class="fact ${stCls(i.st)}"${i.select ? ` data-select="${esc(i.select)}"` : ''}>
      <span class="k" style="color:var(--ink-2)">${esc(i.title)}<span class="sub dim">${esc(i.text || '')}</span></span>
      <span class="v">${esc(i.figure || '')}</span></div>`).join('')}</section>`;
}

// Against the guidance: when a commander's strategy has been uploaded, every
// decision card carries the checks it ran.
function guidanceBlock(g) {
  const order = { breach: 0, honour: 1, note: 2 };
  const sorted = [...g].sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3));
  return `<section class="guid-check"><span class="lbl">Against the guidance</span>
    ${sorted.map(x => `<div class="g ${stCls(x.kind === 'breach' ? 'RED' : x.kind === 'honour' ? 'GREEN' : 'ACCENT')}">
      <span>${esc(x.text)}${x.quote ? `<span class="q">“${esc(x.quote)}”</span>` : ''}</span></div>`).join('')}
  </section>`;
}

function sequenceBlock(seq) {
  const three = seq.slice(0, 3);
  return `<section class="ac-sec" data-detail><div class="seq">
    ${three.map((p, i) => `<div class="ph"><span class="lbl">${esc(p.at || p.phase || `Phase ${i + 1}`)}</span>
      <p>${esc(p.text)}</p></div>${i < three.length - 1 ? '<div class="jn"></div>' : ''}`).join('')}
  </div></section>`;
}

function actionsBlock(actions, superseded = []) {
  return `<section class="ac-sec"><span class="lbl">Approve</span>
    <div class="d-acts" style="margin-top:6px">${actions.map(a => {
      const dead = superseded.includes(a.id);
      return `<button class="btn btn-sm ${a.hard ? '' : 'primary'}" data-agent-act="${esc(a.id)}"
        ${a.hard ? 'data-hard="1"' : ''} ${dead ? 'disabled style="text-decoration:line-through"' : ''}>${esc(a.label)}</button>`;
    }).join('')}</div>
  </section>`;
}

/* --- 8.2 the fold pass ---------------------------------------------------
   The toggle's label is assembled from the DOM after rendering, never written
   per card. */
export function foldPass() {
  for (const cardEl of document.querySelectorAll('.acard')) {
    const btn = cardEl.querySelector('[data-card-fold]');
    if (!btn) continue;
    const idx = Number(cardEl.dataset.cardIndex);
    const open = openCards.has(idx);
    cardEl.classList.toggle('is-open', open);

    if (open) { btn.textContent = 'Less'; continue; }

    const parts = [];
    let extraRows = 0;
    for (const capped of cardEl.querySelectorAll('[data-cap]')) {
      const rows = capped.querySelectorAll('tbody tr').length || capped.children.length;
      if (rows > 5) extraRows += rows - 5;
    }
    if (extraRows) parts.push(`${extraRows} more row${extraRows === 1 ? '' : 's'}`);

    const named = { timeline: 'timeline', backing: 'backing', matrix: 'matrix' };
    const details = [...cardEl.querySelectorAll('[data-detail] h5')].map(h => h.textContent.trim().toLowerCase());
    const shortNames = details.map(d =>
      d.includes('plan of execution') ? 'timeline'
      : d.includes('backing') ? 'backing'
      : d.includes('synchronis') ? 'matrix'
      : d.includes('rules of engagement') ? 'rules'
      : d.includes('reaction') ? 'reaction'
      : d.includes('why') ? 'why'
      : d.includes('after') ? 'after this' : null).filter(Boolean);
    const firstTwo = shortNames.slice(0, 2);
    parts.push(...firstTwo);
    const rest = details.length - firstTwo.length + (cardEl.querySelectorAll('.col-more').length ? 1 : 0);
    if (rest > 0) parts.push(`+${rest}`);

    // A card whose only hidden thing is a note says "Note".
    if (!parts.length) {
      btn.textContent = cardEl.querySelector('.ac-note') ? 'Note' : 'Details';
    } else {
      btn.textContent = 'Details · ' + parts.join(' · ');
    }
    btn.hidden = false;
  }
}

export function toggleCard(idx) {
  const i = Number(idx);
  if (openCards.has(i)) openCards.delete(i); else openCards.add(i);
  render();
}

/* --- guidance ------------------------------------------------------------ */
export async function uploadGuidance(file) {
  const text = await file.text();
  await fetch('/api/guidance', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'X-File-Name': file.name },
    body: text,
  });
  await loadGuidance();
}
export async function loadGuidance() {
  try {
    const r = await fetch('/api/guidance');
    const j = await r.json();
    state.guidance = j.guidance || [];
    renderGuidance();
  } catch (e) { /* the picture renders anyway */ }
}
function renderGuidance() {
  let row = document.querySelector('.guid-row');
  const form = document.getElementById('chat-form');
  if (!state.guidance.length) { row?.remove(); return; }
  if (!row) { row = document.createElement('div'); row.className = 'guid-row'; form.parentNode.insertBefore(row, form); }
  setHtml(row, state.guidance.map(g =>
    `<span class="guid-chip">${esc(g.name)}<button data-guidance-del="${esc(g.id)}" aria-label="Remove">×</button></span>`).join(''));
}
export async function deleteGuidance(id) {
  await fetch('/api/guidance/' + encodeURIComponent(id), { method: 'DELETE' });
  await loadGuidance();
}

export { messages };
