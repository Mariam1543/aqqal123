// The Selected pane. Twelve kinds: asset node unit route convoy reserve fires
// platform, and their assessed twins oasset onode ounit oroute.
//
// The shape is always the same: a .d-h head, then .d-b blocks separated by
// hairlines, ending in an actions block.

import {
  state, emit, esc, num, days, pct, dtg, grid, setHtml, cls, st as stCls,
  byId, isOpp, classShort, className, statusOfRoute, statusOfDos, distKm, fmtMin,
} from './state.js';
import { assetSymbol, symbolSvg, typeFor } from './symbols.js';
import { ringSvg, sparkline, nodeRingSvg } from './charts.js';

export function renderDetail() {
  const host = document.getElementById('detail');
  if (!host) return;
  const sel = state.selected;
  if (!sel || !state.data) { setHtml(host, emptyState()); return; }
  const o = byId(sel.kind, sel.id);
  if (!o) { setHtml(host, emptyState()); return; }

  let html = RENDER[sel.kind.replace(/^o/, '')]?.(o, sel.kind) || generic(o, sel.kind);

  // An assessed item is the same view with a banner above it and the own-side
  // affordances stripped — done by post-processing the HTML string, which is
  // ugly but keeps one renderer per kind.
  if (isOpp(sel.kind)) html = assessedPass(html, o, sel.kind);

  setHtml(host, html);
}

const emptyState = () => `<div class="empty-state">
  <b>Nothing selected</b>
  <p>Select a system, depot, formation or route on the map, in the rail, or from a finding.</p>
</div>`;

/* --- the common head ----------------------------------------------------- */
function head(kindLabel, o, status, reason, latlng) {
  return `<div class="d-h ${stCls(status)}">
    <span class="kind">${esc(kindLabel)}</span>
    <h3>${esc(o.name || o.serial || o.id)}</h3>
    <div class="d-meta">
      <span class="pill">${esc(status === 'HOSTILE' ? 'Assessed' : status)}</span>
      <span class="reason">${esc(reason)}</span>
      ${latlng ? `<span class="grid">${esc(grid(latlng[0], latlng[1]))}</span>` : ''}
    </div>
  </div>`;
}
const block = (title, body, opts = {}) => body
  ? `<section class="d-b ${opts.cls || ''}" ${opts.detail ? 'data-detail' : ''}>
      ${title ? `<h4>${esc(title)}</h4>` : ''}${body}
      ${opts.note ? `<p class="note">${esc(opts.note)}</p>` : ''}
    </section>` : '';
const facts = rows => rows.filter(Boolean).map(([k, v, s, sub]) =>
  `<div class="fact ${stCls(s)}"><span class="k">${esc(k)}</span><span class="v">${esc(v)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</span></div>`).join('');
const kpis = cells => `<div class="kpis">${cells.filter(Boolean).map(c =>
  `<div class="kpi ${stCls(c.st)}"><span class="k">${esc(c.label)}</span>
    <span class="v">${esc(c.value)}${c.unit ? `<span class="unit">${esc(c.unit)}</span>` : ''}</span>
    ${c.note ? `<span class="n">${esc(c.note)}</span>` : ''}</div>`).join('')}</div>`;
const acts = buttons => `<section class="d-b"><div class="d-acts">${buttons.filter(Boolean).join('')}</div></section>`;

/* --- asset --------------------------------------------------------------- */
function asset(a, kind) {
  const opp = isOpp(kind);
  const serv = a.held ? a.serviceable / a.held : 0;
  const reason = opp
    ? `${a.category} · assessed ${a.confidence}`
    : `${a.serviceable} of ${a.held} serviceable${a.limitingClass ? `, ${classShort(a.limitingClass).toLowerCase()} limiting` : ''}`;

  // the four-segment time-to-position timeline
  const ttp = a.ttpMin || 0;
  const segs = [['Notice', 0.15], ['Prepare', 0.3], ['Move', 0.4], ['Into action', 0.15]];
  const ttpBar = ttp ? `<div class="ttp">${segs.map(([n, f], i) =>
    `<i class="s${i + 1}" style="flex:${f}">${f > 0.14 ? esc(n) : ''}</i>`).join('')}</div>
    <div class="fact"><span class="k">Total</span><span class="v">${esc(fmtMin(ttp))}</span></div>` : '';

  return head(opp ? 'Assessed system' : 'System', a, opp ? 'HOSTILE' : a.status, reason, [a.lat, a.lng]) +
    kpis([
      { label: opp ? 'Assessed held' : 'Serviceable', value: opp ? String(a.held) : `${a.serviceable}/${a.held}`,
        st: opp ? null : servSt(serv), note: opp ? 'launchers or aircraft' : pct(serv) + ' of held' },
      { label: 'Reach', value: a.rangeKm ? num(a.rangeKm) : '—', unit: a.rangeKm ? 'km' : '', note: a.altKm ? `to ${a.altKm} km altitude` : a.category },
      { label: 'Into action', value: a.ttpMin ? fmtMin(a.ttpMin) : '—', note: opp ? 'assessed' : 'from notice to move' },
    ]) +
    block('Where it is', facts([
      ['Grid', grid(a.lat, a.lng)],
      ['Position', `${a.lat.toFixed(3)}°N ${a.lng.toFixed(3)}°E`],
      ['Control', a.control || '—'],
      a.category && ['Category', a.category],
    ])) +
    (ttpBar ? block('Time to position', ttpBar, { note: 'Notice, prepare, move, into action. A segment is only labelled when it is wide enough to read.' }) : '') +
    (a.rounds?.length ? block('Rounds', `<div class="scroll-x"><table class="tbl"><thead><tr>
        <th>Nature</th><th>Held</th><th>A day</th><th>Days</th><th>Norm</th><th>Lead</th></tr></thead><tbody>
        ${a.rounds.map(r => `<tr class="${stCls(r.status)}">
          <td>${esc(r.name)}</td><td class="num">${num(r.held)}</td><td class="num">${num(r.perDay)}</td>
          <td class="num st-fig ${stCls(r.status)}">${r.days != null ? days(r.days) : '—'}</td>
          <td class="num">${r.norm}</td><td class="num">${r.lead} d</td></tr>`).join('')}
      </tbody></table></div>`, {
        note: 'A holding shorter than its replenishment lead time cannot be replaced before it runs out.',
      }) : '') +
    block('Fleet state', (!opp && a.held) ? `<div class="stack">
        <i class="ok" style="width:${(serv * 100).toFixed(1)}%"></i>
        <i class="part" style="width:${(Math.min(1 - serv, 0.5) * 100).toFixed(1)}%"></i>
        <i class="off" style="flex:1"></i>
      </div>${facts([
        ['Serviceable', String(a.serviceable), servSt(serv)],
        ['Awaiting repair', String(Math.max(0, a.held - a.serviceable))],
        ['Held', String(a.held)],
      ])}` : '', { cls: 'fleet' }) +
    block('Control and release', facts([
      ['Release authority', a.release || '—'],
      ['Under command', a.control || '—'],
      a.strategic && ['Strategic', 'Yes — national release'],
    ])) +
    acts([
      a.rangeKm >= 10 ? `<button class="btn btn-sm" data-ring="${esc(a.id)}">Draw reach</button>` : '',
      `<button class="btn btn-sm" data-focus-target="asset:${esc(a.id)}">Focus on the map</button>`,
      `<button class="btn btn-sm" data-board="assets">Systems board</button>`,
      `<button class="btn btn-sm" data-ask-about="asset:${esc(a.id)}">Ask the agent</button>`,
    ]);
}
const servSt = r => (r >= 0.9 ? 'GREEN' : r >= 0.75 ? 'AMBER' : r >= 0.5 ? 'RED' : 'BLACK');

/* --- node ---------------------------------------------------------------- */
function node(n, kind) {
  const opp = isOpp(kind);
  if (opp) {
    return head('Assessed depot', n, 'HOSTILE', `${n.kind} · assessed ${n.confidence}`, [n.lat, n.lng]) +
      block('What is assessed', facts([
        ['Grid', grid(n.lat, n.lng)], ['Echelon', n.echelon], ['Kind', n.kind],
        ['Confidence', n.confidence], ['As of', `${state.data.opposing.meta.asOfHours} h ago`],
      ])) + acts([`<button class="btn btn-sm" data-focus-target="onode:${esc(n.id)}">Focus on the map</button>`]);
  }
  const hist = (state.data.history || []).map(h => h.nodeFill?.[n.id]).filter(v => v != null);
  return head('Depot', n, n.status, `${pct(n.fill)} of objective${n.lowestClass ? `, ${classShort(n.lowestClass).toLowerCase()} lowest` : ''}`, [n.lat, n.lng]) +
    kpis([
      { label: 'Fill', value: pct(n.fill), st: n.status, note: 'held against objective' },
      { label: 'Throughput', value: num(n.throughputPerDay), unit: 't/d', note: 'issued and received' },
      { label: 'Staff', value: num(n.staffPresent), note: `of ${num(n.staff)} established` },
    ]) +
    (hist.length > 2 ? block('Trend', `${sparkline(hist.slice(-48), n.status, 320, 44)}
      <p class="note">Fill over the last 48 reported hours.</p>`) : '') +
    block('By class', `<div class="scroll-x"><table class="tbl"><thead><tr>
        <th>Class</th><th>Held</th><th>Objective</th><th>Fill</th></tr></thead><tbody>
      ${n.classes.map(c => `<tr class="${stCls(c.status)}">
        <td>${esc(c.name)}</td><td class="num">${num(c.held)}</td><td class="num">${num(c.objective)}</td>
        <td class="num st-fig ${stCls(c.status)}">${pct(c.fill)}</td></tr>`).join('')}
    </tbody></table></div>`) +
    block('Where it sits', facts([
      ['Grid', grid(n.lat, n.lng)], ['Echelon', n.echelon], ['Kind', n.kind],
      n.forward && ['Forward', 'Yes — feeds formations in contact'],
      ['Routes in', String(n.routesIn.length)], ['Routes out', String(n.routesOut.length)],
    ])) +
    (n.serves?.length ? block('Supports', n.serves.map(id => {
      const u = byId('unit', id);
      return u ? `<div class="fact ${stCls(u.status)}"><span class="k">
        <a href="#" data-select="unit:${esc(u.id)}">${esc(u.name)}</a></span>
        <span class="v">${days(u.sustainableDays)} d</span></div>` : '';
    }).join(''), { cls: 'supports' }) : '') +
    exposureBlock(n) +
    acts([
      `<button class="btn btn-sm" data-focus-target="node:${esc(n.id)}">Focus on the map</button>`,
      `<button class="btn btn-sm" data-board="sustainability">Sustainability board</button>`,
      `<button class="btn btn-sm" data-ask-about="node:${esc(n.id)}">Ask the agent</button>`,
    ]);
}

function exposureBlock(n) {
  const e = (state.data.standoff?.exposure || []).find(x => x.id === n.id);
  if (!e) return '';
  return block('In their reach', facts([
    ['Systems that reach it', String(e.systems), e.status],
    ['Deepest by', `${num(e.depthKm)} km`, e.status],
    ...e.by.map(b => [b.name.replace(/\s*\(assessed\)/, ''), `${num(b.rangeKm)} km`, 'HOSTILE']),
  ]), { note: 'What their systems can reach today, not what they intend.', detail: false });
}

/* --- unit ---------------------------------------------------------------- */
function unit(u, kind) {
  const opp = isOpp(kind);
  if (opp) {
    return head('Assessed formation', u, 'HOSTILE', `${u.echelon} · assessed ${u.confidence}`, [u.lat, u.lng]) +
      kpis([
        { label: 'Strength', value: pct(u.strength), note: 'assessed' },
        { label: 'Echelon', value: u.echelon }, { label: 'Confidence', value: u.confidence },
      ]) +
      block('What is assessed', facts([
        ['Grid', grid(u.lat, u.lng)], ['Type', u.type], ['Echelon', u.echelon],
        ['As of', `${state.data.opposing.meta.asOfHours} h ago`],
      ])) + acts([`<button class="btn btn-sm" data-focus-target="ounit:${esc(u.id)}">Focus on the map</button>`]);
  }
  const parent = byId('node', u.parent);
  return head('Formation', u, u.status, `${days(u.sustainableDays)} days held${u.limitingClass ? `, ${classShort(u.limitingClass).toLowerCase()} limiting` : ''}`, [u.lat, u.lng]) +
    kpis([
      { label: 'Holds', value: days(u.sustainableDays), unit: 'd', st: u.status, note: 'at the measured posture' },
      { label: 'Strength', value: pct(u.strength), st: u.strengthStatus, note: `${num(Math.round(u.estab * u.strength))} of ${num(u.estab)}` },
      { label: 'Posture', value: u.posture || '—', note: u.echelon },
    ]) +
    block('First line', `<div class="scroll-x"><table class="tbl"><thead><tr>
        <th>Class</th><th>Days</th><th>Norm</th></tr></thead><tbody>
      ${u.classes.map(c => `<tr class="${stCls(c.status)}">
        <td>${esc(c.name)}</td>
        <td class="num st-fig ${stCls(c.status)}">${days(c.days)}</td><td class="num">${c.norm}</td></tr>`).join('')}
    </tbody></table></div>`, { note: 'What the formation carries itself, before it draws on a depot.' }) +
    block('Fed by', parent
      ? facts([[parent.name, pct(parent.fill), parent.status], ['Grid', grid(parent.lat, parent.lng)]])
      : '<p class="mute">No parent depot recorded.</p>', { cls: 'fedby' }) +
    block('Manning', facts([
      ['Establishment', num(u.estab)], ['Present', num(Math.round(u.estab * u.strength)), u.strengthStatus],
      ['Casualties', num(u.casualties)],
    ])) +
    acts([
      `<button class="btn btn-sm" data-focus-target="unit:${esc(u.id)}">Focus on the map</button>`,
      `<button class="btn btn-sm" data-assign="${esc(u.id)}">Assign to the plan</button>`,
      `<button class="btn btn-sm" data-ask-about="unit:${esc(u.id)}">Ask the agent</button>`,
    ]);
}

/* --- route --------------------------------------------------------------- */
function route(r, kind) {
  const opp = isOpp(kind);
  const s = opp ? 'HOSTILE' : statusOfRoute(r.status);
  const mid = r.path[Math.floor(r.path.length / 2)];
  return head(opp ? 'Assessed route' : 'Route', r, s, `${r.cls} · ${r.status.toLowerCase()}${r.note ? ' — ' + r.note : ''}`, mid) +
    kpis([
      { label: 'Capacity', value: num(r.capacityPerDay), unit: 't/d' },
      { label: 'Effective', value: num(r.effectiveCapacity ?? r.capacityPerDay), unit: 't/d', st: s,
        note: r.status === 'OPEN' ? 'at full rate' : 'what it actually passes' },
      { label: 'Length', value: num(r.lengthKm), unit: 'km' },
    ]) +
    block('The route', facts([
      ['Class', r.cls], ['Status', r.status, s],
      !opp && r.from && ['From', byId('node', r.from)?.name || r.from],
      !opp && r.to && ['To', byId('node', r.to)?.name || r.to],
      ['Waypoints', String(r.path.length)],
      r.note && ['Note', r.note],
    ])) +
    (r.serials?.length ? block('On it now', r.serials.map(id => {
      const c = byId('convoy', id);
      return c ? `<div class="fact ${stCls(c.status)}"><span class="k">
        <a href="#" data-select="convoy:${esc(c.id)}">${esc(c.serial)}</a></span>
        <span class="v">${num(c.tonnes)} t ${esc(classShort(c.cls))}<span class="sub">${pct(c.progress)} of the way</span></span></div>` : '';
    }).join('')) : '') +
    (!opp ? acts([
      `<button class="btn btn-sm" data-route-status="${esc(r.id)}:OPEN" ${r.status === 'OPEN' ? 'disabled' : ''}>Open</button>`,
      `<button class="btn btn-sm" data-route-status="${esc(r.id)}:RESTRICTED" ${r.status === 'RESTRICTED' ? 'disabled' : ''}>Restrict</button>`,
      `<button class="btn btn-sm" data-route-status="${esc(r.id)}:CLOSED" ${r.status === 'CLOSED' ? 'disabled' : ''}>Close</button>`,
      `<button class="btn btn-sm" data-board="movement">Movement board</button>`,
    ]) : acts([`<button class="btn btn-sm" data-focus-target="oroute:${esc(r.id)}">Focus on the map</button>`]));
}

/* --- convoy -------------------------------------------------------------- */
function convoy(c) {
  const r = byId('route', c.route);
  return head('Serial', c, c.status, `${num(c.tonnes)} t ${className(c.cls).toLowerCase()} by ${c.mode}`, [c.lat, c.lng]) +
    kpis([
      { label: 'Carrying', value: num(c.tonnes), unit: 't', note: className(c.cls) },
      { label: 'Arrives in', value: days(c.etaHours), unit: 'h', st: c.status, note: `${num(c.remainKm)} km to run` },
      { label: 'Progress', value: pct(c.progress), note: c.routeName },
    ]) +
    block('The serial', facts([
      ['Grid', grid(c.lat, c.lng)], ['Mode', c.mode], ['State', c.state, c.status],
      ['Route', c.routeName], ['From', byId('node', c.from)?.name || c.from],
      ['To', byId('node', c.to)?.name || c.to],
    ])) +
    acts([
      `<button class="btn btn-sm" data-focus-target="convoy:${esc(c.id)}">Focus on the map</button>`,
      r ? `<button class="btn btn-sm" data-select="route:${esc(r.id)}">Its route</button>` : '',
    ]);
}

/* --- reserve ------------------------------------------------------------- */
function reserve(v) {
  const held = v.state === 'held';
  return head('War reserve', v, v.status, `${num(v.qty)} ${className(v.cls).toLowerCase()} · ${v.state}`, [v.lat, v.lng]) +
    kpis([
      { label: 'Quantity', value: num(v.qty), note: className(v.cls) },
      { label: held ? 'To effect' : 'State', value: held ? String(v.effectHours) : v.state, unit: held ? 'h' : '', st: v.status },
      { label: 'Returns in', value: String(v.returnsDays), unit: 'd', note: 'before it is replaced' },
    ]) +
    block('The reserve', facts([
      ['Held at', v.atName], ['Destined for', v.toName],
      ['Release authority', v.authority], ['State', v.state, v.status],
    ])) +
    block('What it would buy', (() => {
      const p = state.data.summary.potential.find(x => x.cls === v.cls);
      return p ? facts([
        ['Held now', `${days(p.now)} d`, p.status],
        ['If every reserve of this class were released', `${days(p.potential)} d`],
        ['Gain', `${days(p.gain)} d`],
      ]) : '';
    })(), { note: 'A released reserve is not replaced for weeks. Releasing it is a decision about the month, not the day.' }) +
    acts([
      held ? `<button class="btn btn-sm primary" data-reserve-release="${esc(v.id)}">Release</button>` : '',
      v.state === 'moving' ? `<button class="btn btn-sm" data-reserve-recall="${esc(v.id)}">Recall</button>` : '',
      `<button class="btn btn-sm" data-focus-target="reserve:${esc(v.id)}">Focus on the map</button>`,
      `<button class="btn btn-sm" data-board="reserves">Reserves board</button>`,
    ]);
}

/* --- fires (a nature, not a system) -------------------------------------- */
function fires(f) {
  return head('Nature', f, f.status, `${days(f.days)} days of fire at the current rate`, null) +
    kpis([
      { label: 'Days of fire', value: days(f.days), unit: 'd', st: f.status, note: `norm ${f.norm} d` },
      { label: 'Held', value: num(f.held), note: f.className },
      { label: 'A day', value: num(f.perDay), note: `${f.lead} d to replace` },
    ]) +
    block('Systems that hold it', f.systems.map(s =>
      `<div class="fact"><span class="k"><a href="#" data-select="asset:${esc(s.id)}">${esc(s.name)}</a></span>
        <span class="v">${num(s.held)}</span></div>`).join('')) +
    block('Against the lead time', facts([
      ['Days held', days(f.days), f.status],
      ['Replenishment lead', `${f.lead} d`],
      ['Verdict', f.days >= f.lead ? 'replaceable before it runs out' : 'runs out before a replacement lands',
        f.days >= f.lead ? 'GREEN' : 'RED'],
    ])) +
    acts([`<button class="btn btn-sm" data-board="standoff">Non-contact board</button>`]);
}

/* --- platform (an equipment fleet) --------------------------------------- */
function platform(p) {
  return head('Fleet', p, p.status, `${p.serviceable} of ${p.held} serviceable`, null) +
    kpis([
      { label: 'Serviceable', value: `${p.serviceable}/${p.held}`, st: p.status, note: pct(p.serviceability) },
      { label: 'Awaiting repair', value: num(p.awaitingRepair) },
      { label: 'Systems', value: String(p.systems.length) },
    ]) +
    block('Held by', p.systems.map(s =>
      `<div class="fact"><span class="k"><a href="#" data-select="asset:${esc(s.id)}">${esc(s.name)}</a></span></div>`).join('')) +
    acts([`<button class="btn btn-sm" data-board="assets">Systems board</button>`]);
}

function generic(o, kind) {
  return head(kind, o, o.status || 'GREEN', '', o.lat != null ? [o.lat, o.lng] : null) +
    block('Figures', facts(Object.entries(o)
      .filter(([k, v]) => typeof v !== 'object' && k !== 'name' && k !== 'id')
      .slice(0, 14).map(([k, v]) => [k, String(v)])));
}

const RENDER = { asset, node, unit, route, convoy, reserve, fires, platform };

/* --- the assessed pass ---------------------------------------------------
   The banner goes on; the own-side affordances come off. */
function assessedPass(html, o, kind) {
  const meta = state.data.opposing.meta;
  const banner = `<div class="assessed-banner">
    <span class="lbl">Assessed</span>
    <span>${esc(o.confidence || meta.confidence)} confidence · as of ${meta.asOfHours} h ago</span>
  </div>`;

  // strip the own-side affordances
  let out = html
    .replace(/<button[^>]*data-reserve-[^>]*>.*?<\/button>/gs, '')
    .replace(/<button[^>]*data-route-status[^>]*>.*?<\/button>/gs, '')
    .replace(/<button[^>]*data-board=[^>]*>.*?<\/button>/gs, '')
    .replace(/<button[^>]*data-assign=[^>]*>.*?<\/button>/gs, '')
    .replace(/<section class="d-b fleet"[^>]*>.*?<\/section>/gs, '')
    .replace(/<section class="d-b fedby"[^>]*>.*?<\/section>/gs, '')
    .replace(/<section class="d-b supports"[^>]*>.*?<\/section>/gs, '');

  const strikeBar = (kind === 'oasset' || kind === 'onode')
    ? `<div class="strike-bar">
        <button class="btn btn-sm" data-strike="${esc(kind)}:${esc(o.id)}">Strike options against this</button>
        <button class="btn btn-sm quiet" data-terrain-target="${esc(kind)}:${esc(o.id)}">3D</button>
      </div>` : '';

  // The banner sits above the head and the strike bar under it. The head ends at the
  // close of the .d-h element: the d-meta div closes first, then .d-h itself.
  const metaAt = out.indexOf('d-meta');
  if (metaAt < 0) return banner + strikeBar + out;
  const metaClose = out.indexOf('</div>', metaAt);
  const headClose = out.indexOf('</div>', metaClose + 6);
  const headEnd = headClose < 0 ? out.length : headClose + 6;
  return banner + out.slice(0, headEnd) + strikeBar + out.slice(headEnd);
}
