// Every chart, hand-written SVG. Colours come from tokens; labels are drawn
// inside the drawing; legends are HTML under the SVG so they can never collide
// with it. Every chart carries role="img" and an aria-label that states what it
// shows.

import { esc, days, num, pct, classShort } from './state.js';

const ST = { GREEN: 'var(--ok)', AMBER: 'var(--warn)', RED: 'var(--bad)', BLACK: 'var(--crit)', HOSTILE: 'var(--hostile)', ACCENT: 'var(--accent)' };
export const stColour = s => ST[s] || 'var(--accent)';
const clean = v => (Number.isFinite(v) ? v : 0);
const svgOpen = (w, h, label, extra = '') =>
  `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet" ${extra}>`;

// Legends are HTML, under the drawing.
export function legendRow(items) {
  if (!items || !items.length) return '';
  return `<div class="chart-legend">${items.map(i =>
    `<div><i class="${i.dash ? 'dash' : ''}" style="${i.dash ? 'color:' + i.colour : 'background:' + i.colour}"></i>${esc(i.name)}</div>`
  ).join('')}</div>`;
}

const HATCH = `<defs><pattern id="hatch" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
  <line x1="0" y1="0" x2="0" y2="5" stroke="var(--hair-3)" stroke-width="2"/></pattern></defs>`;

/* --- 1. sparkline -------------------------------------------------------- */
export function sparkline(values, st, w = 84, h = 22) {
  const vs = (values || []).map(clean);
  if (vs.length < 2) return '';
  const min = Math.min(...vs), max = Math.max(...vs), span = max - min || 1;
  const x = i => (i / (vs.length - 1)) * w;
  const y = v => h - 2 - ((v - min) / span) * (h - 4);
  const line = vs.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  const c = stColour(st);
  return svgOpen(w, h, `Trend, ${vs.length} points, from ${days(vs[0])} to ${days(vs[vs.length - 1])}`) +
    `<path d="${area}" fill="${c}" opacity=".09"/>` +
    `<path d="${line}" class="series" stroke="${c}"/>` +
    `<circle cx="${x(vs.length - 1).toFixed(1)}" cy="${y(vs[vs.length - 1]).toFixed(1)}" r="2" fill="${c}"/></svg>`;
}

/* --- 2. ringSvg ---------------------------------------------------------- */
export function ringSvg(fraction, st, big, sub, size = 92) {
  const f = Math.max(0, Math.min(1, clean(fraction)));
  const r = 40, cx = 50, cy = 50, circ = 2 * Math.PI * r;
  return svgOpen(100, 100, `${big || pct(f)}${sub ? ', ' + sub : ''}`, `width="${size}" height="${size}"`) +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--s2)" stroke-width="11"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${stColour(st)}" stroke-width="11"
       stroke-dasharray="${(f * circ).toFixed(1)} ${circ.toFixed(1)}"
       transform="rotate(-90 ${cx} ${cy})" stroke-linecap="butt"/>` +
    `<text x="${cx}" y="${cy + 1}" text-anchor="middle" class="val" style="font-size:19px">${esc(big ?? pct(f))}</text>` +
    (sub ? `<text x="${cx}" y="${cy + 16}" text-anchor="middle" class="sub">${esc(sub)}</text>` : '') +
    `</svg>`;
}

/* --- 3. nodeRingSvg — the map's depot gauge ------------------------------ */
export function nodeRingSvg(fill, st, r = 11, label) {
  const f = Math.max(0, Math.min(1, clean(fill)));
  const size = r * 2 + 6, c = r + 3, circ = 2 * Math.PI * r;
  return svgOpen(size, size, label || `Fill ${pct(f)}`, `width="${size}" height="${size}"`) +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--s2)" stroke-width="3"/>` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${stColour(st)}" stroke-width="3"
       stroke-dasharray="${(f * circ).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${c} ${c})"/></svg>`;
}

/* --- 4. barChart --------------------------------------------------------- */
export function barChart(rows, opts = {}) {
  const W = 720, rowH = 26, labelW = opts.labelW || 150, valueW = 78;
  const list = (rows || []).slice(0, opts.cap || 40);
  const H = Math.max(40, list.length * rowH + 16);
  const barX = labelW + 10, barW = W - labelW - valueW - 30;
  const max = Math.max(...list.map(r => Math.max(clean(r.value), clean(r.target) || 0)), 1) * 1.08;
  let out = svgOpen(W, H, opts.label || `${list.length} rows`);
  list.forEach((r, i) => {
    const y = 8 + i * rowH, w = (clean(r.value) / max) * barW;
    out += `<text x="0" y="${y + 15}" class="lbl" style="font-size:11px">${esc(trunc(r.name, 24))}</text>`;
    out += `<rect x="${barX}" y="${y + 5}" width="${barW}" height="12" class="track" rx="1"/>`;
    out += `<rect x="${barX}" y="${y + 5}" width="${Math.max(0, w).toFixed(1)}" height="12" fill="${stColour(r.st)}" rx="1"/>`;
    if (r.target != null) {
      const tx = barX + (clean(r.target) / max) * barW;
      out += `<line x1="${tx.toFixed(1)}" y1="${y + 2}" x2="${tx.toFixed(1)}" y2="${y + 20}" class="marker"/>`;
    }
    out += `<text x="${W}" y="${y + 15}" text-anchor="end" class="val">${esc(r.display ?? num(r.value, 0))}</text>`;
  });
  return out + '</svg>' + legendRow(opts.legend);
}

/* --- 5. scenarioChart — paired columns per posture ----------------------- */
export function scenarioChart(matrix) {
  const W = 720, H = 230, padL = 40, padB = 42, padT = 14;
  const rows = matrix || [];
  if (!rows.length) return '';
  const max = Math.max(...rows.flatMap(r => [clean(r.sustainableDays), clean(r.forwardDays), clean(r.requiredDays)]), 1) * 1.15;
  const plotH = H - padB - padT, colW = (W - padL - 16) / rows.length;
  const y = v => padT + plotH - (clean(v) / max) * plotH;
  let out = svgOpen(W, H, `Endurance against requirement for ${rows.length} planning postures`);
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, yy = y(v);
    out += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W}" y2="${yy.toFixed(1)}" class="grid"/>`;
    out += `<text x="${padL - 6}" y="${(yy + 3).toFixed(1)}" text-anchor="end" class="sub">${Math.round(v)}</text>`;
  }
  rows.forEach((r, i) => {
    const x0 = padL + i * colW, bw = Math.min(30, colW * 0.24);
    // command holding, in the friendly hue at 55% — it is a capacity, not a state
    out += `<rect x="${(x0 + colW / 2 - bw - 4).toFixed(1)}" y="${y(r.sustainableDays).toFixed(1)}" width="${bw}"
      height="${Math.max(0, padT + plotH - y(r.sustainableDays)).toFixed(1)}" fill="var(--friendly)" opacity=".55"/>`;
    // forward holding, in its status
    out += `<rect x="${(x0 + colW / 2 + 4).toFixed(1)}" y="${y(r.forwardDays).toFixed(1)}" width="${bw}"
      height="${Math.max(0, padT + plotH - y(r.forwardDays)).toFixed(1)}" fill="${stColour(vs(r.forwardVerdict))}"/>`;
    // the requirement, as a dashed rule across the column
    const ry = y(r.requiredDays);
    out += `<line x1="${(x0 + 6).toFixed(1)}" y1="${ry.toFixed(1)}" x2="${(x0 + colW - 6).toFixed(1)}" y2="${ry.toFixed(1)}"
      stroke="var(--ink-2)" stroke-width="1.4" stroke-dasharray="5 4"/>`;
    out += `<text x="${(x0 + colW / 2).toFixed(1)}" y="${H - 24}" text-anchor="middle" class="lbl" style="font-size:10.5px">${esc(trunc(r.name, 16))}</text>`;
    out += `<text x="${(x0 + colW / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle" class="sub">${days(r.sustainableDays)} / ${days(r.forwardDays)} d</text>`;
  });
  out += `<line x1="${padL}" y1="${padT + plotH}" x2="${W}" y2="${padT + plotH}" class="axis"/></svg>`;
  return out + legendRow([
    { name: 'Command holding', colour: 'var(--friendly)' },
    // The forward bar is coloured by its verdict, so the legend must not imply one hue.
    { name: 'Forward holding — coloured by verdict', colour: 'var(--warn)' },
    { name: 'Requirement', colour: 'var(--ink-2)', dash: true },
  ]);
}
const vs = v => (v === 'ADEQUATE' ? 'GREEN' : v === 'MARGINAL' ? 'AMBER' : 'RED');

/* --- 6. burndownChart — share of today's holding over the horizon -------- */
export function burndownChart(projection, opts = {}) {
  const W = 720, H = 240, padL = 40, padB = 26, padT = 12, padR = 60;
  const rows = (projection || []).filter(p => p.series?.length);
  if (!rows.length) return '';
  const horizon = rows[0].series.length - 1;
  const max = Math.max(...rows.map(r => clean(r.start)), 1) * 1.1;
  const plotW = W - padL - padR, plotH = H - padB - padT;
  const x = d => padL + (d / horizon) * plotW;
  const y = v => padT + plotH - (clean(v) / max) * plotH;
  let out = svgOpen(W, H, `Holding remaining over ${horizon} days, ${rows.length} classes`);
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, yy = y(v);
    out += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${padL + plotW}" y2="${yy.toFixed(1)}" class="grid"/>`;
    out += `<text x="${padL - 6}" y="${(yy + 3).toFixed(1)}" text-anchor="end" class="sub">${Math.round(v)}</text>`;
  }
  rows.forEach(r => {
    const line = r.series.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)} ${y(p.days).toFixed(1)}`).join(' ');
    out += `<path d="${line}" class="series" stroke="${stColour(r.status)}" opacity=".85"/>`;
    // the norm marker: where this class ought to sit
    out += `<line x1="${padL}" y1="${y(r.norm).toFixed(1)}" x2="${padL + 14}" y2="${y(r.norm).toFixed(1)}" class="marker" opacity=".6"/>`;
    out += `<text x="${padL + plotW + 5}" y="${(y(r.series[r.series.length - 1].days) + 3).toFixed(1)}" class="sub">${esc(r.short)}</text>`;
  });
  for (let d = 0; d <= horizon; d += Math.max(1, Math.round(horizon / 6)))
    out += `<text x="${x(d).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="sub">${d}d</text>`;
  out += `<line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" class="axis"/></svg>`;
  return out;
}

/* --- 7. dofChart — days of fire per nature ------------------------------- */
export function dofChart(fires) {
  const rows = (fires || []).filter(f => f.days != null);
  if (!rows.length) return '';
  const W = 720, rowH = 30, labelW = 170;
  const H = rows.length * rowH + 16;
  const barX = labelW + 10, barW = W - labelW - 96;
  const max = Math.max(...rows.map(r => Math.max(clean(r.days), clean(r.lead), clean(r.norm))), 1) * 1.1;
  let out = svgOpen(W, H, `Days of fire for ${rows.length} natures against replenishment lead time`);
  rows.forEach((r, i) => {
    const y = 8 + i * rowH;
    out += `<text x="0" y="${y + 16}" class="lbl" style="font-size:11px">${esc(trunc(r.name, 26))}</text>`;
    out += `<rect x="${barX}" y="${y + 6}" width="${barW}" height="13" class="track" rx="1"/>`;
    // bar = days held
    out += `<rect x="${barX}" y="${y + 6}" width="${((clean(r.days) / max) * barW).toFixed(1)}" height="13" fill="${stColour(r.status)}" rx="1"/>`;
    // tick = the replenishment lead time: a holding shorter than this cannot be replaced in time
    const lx = barX + (clean(r.lead) / max) * barW;
    out += `<line x1="${lx.toFixed(1)}" y1="${y + 2}" x2="${lx.toFixed(1)}" y2="${y + 23}" stroke="var(--bad)" stroke-width="1.4" stroke-dasharray="3 2"/>`;
    // marker = the norm
    const nx = barX + (clean(r.norm) / max) * barW;
    out += `<line x1="${nx.toFixed(1)}" y1="${y + 3}" x2="${nx.toFixed(1)}" y2="${y + 22}" class="marker"/>`;
    out += `<text x="${W}" y="${y + 16}" text-anchor="end" class="val">${days(r.days)} d</text>`;
  });
  return out + '</svg>' + legendRow([
    { name: 'Days held', colour: 'var(--warn)' },
    { name: 'Replenishment lead', colour: 'var(--bad)', dash: true },
    { name: 'Norm', colour: 'var(--ink-2)' },
  ]);
}

/* --- 8. timelineChart — then · now · next on one axis -------------------- */
export function timelineChart({ history, projection, alt, norm } = {}) {
  const W = 720, H = 220, padL = 40, padB = 26, padT = 12, padR = 12;
  const h = history || [], p = projection || [];
  if (!h.length && !p.length) return '';
  const all = h.concat(p, alt || []).map(clean);
  const max = Math.max(...all, clean(norm) || 0, 1) * 1.12;
  const total = h.length + p.length - 1 || 1;
  const plotW = W - padL - padR, plotH = H - padB - padT;
  const x = i => padL + (i / total) * plotW;
  const y = v => padT + plotH - (clean(v) / max) * plotH;
  let out = svgOpen(W, H, 'Holding: history, now and projection');
  for (let i = 0; i <= 3; i++) {
    const v = (max / 3) * i;
    out += `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" class="grid"/>`;
    out += `<text x="${padL - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" class="sub">${Math.round(v)}</text>`;
  }
  if (h.length) out += `<path d="${h.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')}" class="series" stroke="var(--mute)"/>`;
  if (p.length) out += `<path d="${p.map((v, i) => `${i ? 'L' : 'M'}${x(h.length - 1 + i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')}" class="series" stroke="var(--friendly)"/>`;
  if (alt?.length) out += `<path d="${alt.map((v, i) => `${i ? 'L' : 'M'}${x(h.length - 1 + i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')}" class="series" stroke="var(--series-potential)" stroke-dasharray="5 4"/>`;
  if (norm != null) out += `<line x1="${padL}" y1="${y(norm).toFixed(1)}" x2="${W - padR}" y2="${y(norm).toFixed(1)}" class="marker" stroke-dasharray="4 3"/>`;
  // now: a hairline, not a band
  const nx = x(Math.max(0, h.length - 1));
  out += `<line x1="${nx.toFixed(1)}" y1="${padT}" x2="${nx.toFixed(1)}" y2="${padT + plotH}" stroke="var(--ink-2)" stroke-width="1"/>`;
  out += `<text x="${(nx + 4).toFixed(1)}" y="${padT + 9}" class="sub">now</text>`;
  out += `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" class="axis"/></svg>`;
  return out + legendRow([
    { name: 'Reported', colour: 'var(--mute)' },
    { name: 'Projection', colour: 'var(--friendly)' },
    ...(alt?.length ? [{ name: 'Alternative', colour: 'var(--series-potential)', dash: true }] : []),
  ]);
}

/* --- 9. groupedBars — now vs potential vs target ------------------------- */
export function groupedBars(rows) {
  const list = rows || [];
  if (!list.length) return '';
  const W = 720, rowH = 30, labelW = 150;
  const H = list.length * rowH + 16, barX = labelW + 10, barW = W - labelW - 96;
  const max = Math.max(...list.flatMap(r => [clean(r.now), clean(r.potential), clean(r.target)]), 1) * 1.1;
  let out = svgOpen(W, H, `Holding now against what a release would buy, ${list.length} classes`);
  list.forEach((r, i) => {
    const y = 8 + i * rowH;
    out += `<text x="0" y="${y + 16}" class="lbl" style="font-size:11px">${esc(trunc(r.name || r.short, 22))}</text>`;
    out += `<rect x="${barX}" y="${y + 6}" width="${barW}" height="13" class="track" rx="1"/>`;
    // the potential sits behind, the present in front — the gap is the decision
    out += `<rect x="${barX}" y="${y + 6}" width="${((clean(r.potential) / max) * barW).toFixed(1)}" height="13" fill="var(--series-potential)" opacity=".5" rx="1"/>`;
    out += `<rect x="${barX}" y="${y + 6}" width="${((clean(r.now) / max) * barW).toFixed(1)}" height="13" fill="var(--series-now)" rx="1"/>`;
    const tx = barX + (clean(r.target) / max) * barW;
    out += `<line x1="${tx.toFixed(1)}" y1="${y + 2}" x2="${tx.toFixed(1)}" y2="${y + 23}" stroke="var(--ink)" stroke-width="1.4"/>`;
    out += `<circle cx="${tx.toFixed(1)}" cy="${y + 2}" r="2" fill="var(--ink)"/>`;
    out += `<text x="${W}" y="${y + 16}" text-anchor="end" class="val">${days(r.now)} → ${days(r.potential)}</text>`;
  });
  return out + '</svg>' + legendRow([
    { name: 'Held now', colour: 'var(--series-now)' },
    { name: 'If released', colour: 'var(--series-potential)' },
    { name: 'Norm', colour: 'var(--ink)' },
  ]);
}

/* --- 10. deltaBars — before → after from a baseline ---------------------- */
export function deltaBars(rows) {
  const list = rows || [];
  if (!list.length) return '';
  const W = 720, rowH = 30, labelW = 160;
  const H = list.length * rowH + 16, barX = labelW + 10, barW = W - labelW - 130;
  const max = Math.max(...list.flatMap(r => [clean(r.before), clean(r.after)]), 1) * 1.1;
  let out = svgOpen(W, H, `Before and after, ${list.length} measures`);
  list.forEach((r, i) => {
    const y = 8 + i * rowH;
    const b = (clean(r.before) / max) * barW, a = (clean(r.after) / max) * barW;
    const grew = a >= b;
    const good = r.good === 'up' ? grew : !grew;
    out += `<text x="0" y="${y + 16}" class="lbl" style="font-size:11px">${esc(trunc(r.label, 24))}</text>`;
    out += `<rect x="${barX}" y="${y + 6}" width="${barW}" height="13" class="track" rx="1"/>`;
    out += `<rect x="${barX}" y="${y + 6}" width="${Math.min(a, b).toFixed(1)}" height="13" fill="var(--series-now)" rx="1"/>`;
    // the extension is the effect of the decision
    out += `<rect x="${(barX + Math.min(a, b)).toFixed(1)}" y="${y + 6}" width="${Math.abs(a - b).toFixed(1)}" height="13"
      fill="${good ? 'var(--accent)' : 'var(--bad)'}" opacity="${grew ? 1 : 0.45}" rx="1"/>`;
    out += `<text x="${W}" y="${y + 16}" text-anchor="end" class="val">${days(r.before)} → ${days(r.after)}</text>`;
  });
  return out + '</svg>' + legendRow([
    { name: 'Baseline', colour: 'var(--series-now)' },
    { name: 'Gained', colour: 'var(--accent)' },
    { name: 'Lost', colour: 'var(--bad)' },
  ]);
}

/* --- 11. gaugeBig — one figure in a ring --------------------------------- */
export function gaugeBig(fraction, big, word, sub, st, size = 132) {
  const f = Math.max(0, Math.min(1, clean(fraction)));
  const r = 44, c = 56, circ = 2 * Math.PI * r;
  const s = String(big ?? '');
  const fs = s.length <= 3 ? 30 : s.length <= 5 ? 27 : 24;   // steps by string length
  return svgOpen(112, 112, `${word || ''} ${s} ${sub || ''}`.trim(), `width="${size}" height="${size}"`) +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--s2)" stroke-width="10"/>` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${stColour(st)}" stroke-width="10"
       stroke-dasharray="${(f * circ).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${c} ${c})"/>` +
    `<text x="${c}" y="${c + fs / 3}" text-anchor="middle" class="val" style="font-size:${fs}px">${esc(s)}</text>` +
    (word ? `<text x="${c}" y="${c - 18}" text-anchor="middle" class="lbl" style="font-size:9.5px">${esc(word)}</text>` : '') +
    (sub ? `<text x="${c}" y="${c + 26}" text-anchor="middle" class="sub">${esc(sub)}</text>` : '') +
    `</svg>`;
}

/* --- 12. magazineChart — days of fire vs replenishment ------------------- */
export function magazineChart(own) {
  const rows = (own || []).filter(o => o.daysOfFire != null).slice(0, 12);
  if (!rows.length) return '';
  const W = 720, rowH = 28, labelW = 175;
  const H = rows.length * rowH + 16, barX = labelW + 10, barW = W - labelW - 92;
  const max = Math.max(...rows.map(r => clean(r.daysOfFire)), 21) * 1.12;
  let out = svgOpen(W, H, `Days of fire for ${rows.length} systems`) + HATCH;
  rows.forEach((r, i) => {
    const y = 8 + i * rowH;
    const w = (clean(r.daysOfFire) / max) * barW;
    out += `<text x="0" y="${y + 15}" class="lbl" style="font-size:11px">${esc(trunc(r.name, 27))}</text>`;
    // the dry part: past the holding, the magazine is empty
    out += `<rect x="${barX}" y="${y + 5}" width="${barW}" height="12" class="hatch" opacity=".35" rx="1"/>`;
    out += `<rect x="${barX}" y="${y + 5}" width="${Math.max(0, w).toFixed(1)}" height="12" fill="${stColour(r.status)}" rx="1"/>`;
    // the diamond marks when a replacement would land
    const rx = barX + (21 / max) * barW;
    out += `<path d="M${rx.toFixed(1)} ${y + 4} l4 7 l-4 7 l-4 -7 Z" fill="var(--series-potential)"/>`;
    out += `<text x="${W}" y="${y + 15}" text-anchor="end" class="val">${days(r.daysOfFire)} d</text>`;
  });
  return out + '</svg>' + legendRow([
    { name: 'Days of fire', colour: 'var(--warn)' },
    { name: 'Replenishment lands', colour: 'var(--series-potential)' },
    { name: 'Dry', colour: 'var(--hair-3)' },
  ]);
}

/* --- 13. ganttChart — plan phases against H-hour ------------------------- */
const PHASE_FILL = { prepare: 'var(--s3)', move: 'var(--hair-3)', assault: 'var(--accent)', consolidate: 'var(--ok)', sustain: 'var(--warn)' };
export function ganttChart(a) {
  const phases = a?.phases || [];
  if (!phases.length) return '';
  const W = 720, rowH = 28, labelW = 150;
  const H = phases.length * rowH + 34, barX = labelW + 10, barW = W - labelW - 70;
  const total = phases.reduce((s, p) => s + (Number(p.days) || 0), 0) || 1;
  const x = d => barX + (d / total) * barW;
  let out = svgOpen(W, H, `Plan phases over ${total} days`);
  let run = 0;
  phases.forEach((p, i) => {
    const y = 8 + i * rowH, d = Number(p.days) || 0;
    out += `<text x="0" y="${y + 15}" class="lbl" style="font-size:11px">${esc(trunc(p.name || `Phase ${i + 1}`, 22))}</text>`;
    out += `<rect x="${x(run).toFixed(1)}" y="${y + 4}" width="${Math.max(2, (d / total) * barW).toFixed(1)}" height="14"
      fill="${PHASE_FILL[p.type] || 'var(--s3)'}" rx="1"/>`;
    out += `<text x="${W}" y="${y + 15}" text-anchor="end" class="val">${days(d)} d</text>`;
    run += d;
  });
  // H-hour a solid rule; the last safe decision a dashed --bad rule
  out += `<line x1="${x(0).toFixed(1)}" y1="4" x2="${x(0).toFixed(1)}" y2="${H - 22}" stroke="var(--ink)" stroke-width="1.5"/>`;
  out += `<text x="${x(0).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="sub">H</text>`;
  const lsd = Math.max(0, total * 0.25);
  out += `<line x1="${x(lsd).toFixed(1)}" y1="4" x2="${x(lsd).toFixed(1)}" y2="${H - 22}" stroke="var(--bad)" stroke-width="1.4" stroke-dasharray="4 3"/>`;
  out += `<text x="${x(lsd).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="sub">last safe decision</text>`;
  return out + '</svg>';
}

/* --- 14. ladderChart — the escalation ladder ----------------------------- */
export function ladderChart(E) {
  const rungs = E?.ladder || [];
  if (!rungs.length) return '';
  const W = 720, H = rungs.length * 32 + 20, labelW = 210;
  const barX = labelW + 10, barW = W - labelW - 80;
  const maxL = Math.max(...rungs.map(r => clean(r.likelihood)), 0.01);
  let out = svgOpen(W, H, `Escalation ladder, ${rungs.length} rungs`);
  // floors and risers, read from the bottom up
  rungs.slice().reverse().forEach((r, i) => {
    const y = 8 + i * 32;
    const isNow = r.rung === E.rung;
    const isThis = r.rung === E.courseRung;
    out += `<line x1="0" y1="${y + 26}" x2="${W}" y2="${y + 26}" class="grid"/>`;
    out += `<text x="0" y="${y + 13}" class="lbl" style="font-size:11px; fill:${isNow ? 'var(--accent)' : 'var(--mute)'}">R${r.rung} ${esc(trunc(r.name, 24))}</text>`;
    out += `<text x="0" y="${y + 24}" class="sub">${esc(r.band)}</text>`;
    out += `<rect x="${barX}" y="${y + 4}" width="${barW}" height="12" class="track" rx="1"/>`;
    out += `<rect x="${barX}" y="${y + 4}" width="${((clean(r.likelihood) / maxL) * barW).toFixed(1)}" height="12"
      fill="${isNow ? 'var(--accent)' : r.band === 'strategic' ? 'var(--bad)' : 'var(--series-now)'}" rx="1"/>`;
    if (isThis) out += `<rect x="${barX - 2}" y="${y + 2}" width="${barW + 4}" height="16" fill="none"
      stroke="var(--warn)" stroke-width="1.4" stroke-dasharray="4 3" rx="1"/>`;
    out += `<text x="${W}" y="${y + 14}" text-anchor="end" class="val">${pct(r.likelihood)}</text>`;
  });
  return out + '</svg>' + legendRow([
    { name: 'Where we are', colour: 'var(--accent)' },
    { name: 'This course', colour: 'var(--warn)', dash: true },
    { name: 'Beyond the threshold', colour: 'var(--bad)' },
  ]);
}

function trunc(s, n) {
  const t = String(s ?? '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
