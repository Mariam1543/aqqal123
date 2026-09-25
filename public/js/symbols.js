// The symbol set. One rule: the frame is the affiliation, the glyph is the type.
//
// Frame shapes follow MIL-STD-2525 — rounded rectangle friendly, diamond hostile,
// square neutral, circle unknown, quatrefoil suspect — but they are drawn flat and
// filled, not as outlines, which is what makes them legible at 20px over imagery
// and on a wall.

const BOX = 28;                 // the canvas
const C = 14;                   // frame centre
// Glyphs live inside a 12x12 square centred at (14,14) — the largest square that
// fits every frame including the diamond, so one glyph renders in all five.
const G = 6;                    // half the glyph box

const AFFIL = {
  friendly: 'var(--sym-friendly)',
  hostile:  'var(--sym-hostile)',
  neutral:  'var(--sym-neutral)',
  unknown:  'var(--sym-unknown)',
  suspect:  'var(--sym-unknown)',
};

/* --- frames --------------------------------------------------------------
   Every frame is drawn twice: a dark halo underneath, then the fill. Imagery is
   not a uniform ground and a flat symbol without a halo disappears over pale
   desert and bright rooftops. */
function framePath(affiliation) {
  switch (affiliation) {
    case 'hostile':  return `M${C} 2 L26 ${C} L${C} 26 L2 ${C} Z`;
    case 'neutral':  return `M3 3 H25 V25 H3 Z`;
    case 'unknown':  return `M${C} 2 A12 12 0 1 1 ${C - 0.01} 2 Z`;
    case 'suspect':  return quatrefoil();
    default:         return `M5 6 H23 A3 3 0 0 1 26 9 V19 A3 3 0 0 1 23 22 H5 A3 3 0 0 1 2 19 V9 A3 3 0 0 1 5 6 Z`;
  }
}
function quatrefoil() {
  const r = 5.2, o = 4.4;
  return [[C, C - o], [C + o, C], [C, C + o], [C - o, C]]
    .map(([x, y], i) => `${i ? 'M' : 'M'}${x - r} ${y} a${r} ${r} 0 1 1 ${r * 2} 0 a${r} ${r} 0 1 1 ${-r * 2} 0 Z`)
    .join(' ');
}

/* --- glyphs --------------------------------------------------------------
   Drawn as shapes, never as text: text does not scale down cleanly and does not
   knock out of a filled frame at 20px. */
const GLYPH = {
  infantry:        () => `M${C - G} ${C - G} L${C + G} ${C + G} M${C + G} ${C - G} L${C - G} ${C + G}`,
  armour:          () => `M${C - G} ${C - 3.4} H${C + G} A3.4 3.4 0 0 1 ${C + G} ${C + 3.4} H${C - G} A3.4 3.4 0 0 1 ${C - G} ${C - 3.4} Z`,
  mechanised:      () => `M${C - G} ${C - 3.4} H${C + G} A3.4 3.4 0 0 1 ${C + G} ${C + 3.4} H${C - G} A3.4 3.4 0 0 1 ${C - G} ${C - 3.4} Z M${C - G} ${C - G} L${C + G} ${C + G}`,
  artillery:       () => `M${C} ${C - G} A${G} ${G} 0 1 1 ${C - 0.01} ${C - G} Z`,
  headquarters:    () => `M${C - G} ${C + G} V${C - G} H${C + G}`,
  'special-forces':() => `M${C - G} ${C + G} L${C} ${C - G} L${C + G} ${C + G} Z`,
  reconnaissance:  () => `M${C - G} ${C + G} L${C + G} ${C - G} M${C - G} ${C - G} L${C + G} ${C + G}`,
  'rotary-wing':   () => `M${C - G} ${C - 3} H${C + G} M${C} ${C - 3} V${C + 3} M${C - 3.4} ${C + 4} H${C + 3.4}`,
  'electronic-warfare': () => `M${C - G} ${C + G} L${C - 2} ${C - G} L${C + 2} ${C + G} L${C + G} ${C - G}`,
  'fixed-wing':    () => `M${C} ${C - G} V${C + G} M${C - G} ${C - 1} L${C} ${C - 4} L${C + G} ${C - 1} M${C - 3} ${C + G} H${C + 3}`,
  uav:             () => `M${C - G} ${C} H${C + G} M${C} ${C - 3.6} V${C + 3.6} M${C - 3} ${C - 3.6} H${C + 3}`,
  'naval-surface': () => `M${C - G} ${C + 1} H${C + G} L${C + 3} ${C + G} H${C - 3} Z M${C} ${C + 1} V${C - G}`,
  submarine:       () => `M${C - G} ${C + 1} A${G} 3.6 0 1 0 ${C + G} ${C + 1} Z M${C} ${C - 2.6} V${C - G}`,
  'civilian-vehicle': () => `M${C - G} ${C + 2.6} H${C + G} V${C - 1} H${C + 1.6} L${C - 1} ${C - 4} H${C - G} Z`,
  'civilian-infrastructure': () => `M${C - G} ${C + G} V${C - 2} L${C} ${C - G} L${C + G} ${C - 2} V${C + G} Z`,
  sensor:          () => `M${C - G} ${C + G} L${C} ${C - G} M${C} ${C - G} L${C + G} ${C + G} M${C - 3.4} ${C + 1.4} H${C + 3.4}`,
  'air-defence':   () => `M${C - G} ${C + G} A${G} ${G} 0 0 1 ${C + G} ${C + G} Z M${C} ${C + G} V${C - G}`,
  missile:         () => `M${C} ${C - G} L${C + 3} ${C} V${C + G} H${C - 3} V${C} Z`,
  airfield:        () => `M${C - G} ${C + G} L${C + G} ${C - G} M${C + 1} ${C - G} H${C + G} V${C - 1}`,
  depot:           () => `M${C - G} ${C - 2.4} H${C + G} V${C + G} H${C - G} Z M${C - G} ${C - 2.4} L${C} ${C - G} L${C + G} ${C - 2.4}`,
  engineer:        () => `M${C - G} ${C + G} V${C - 2} H${C - 1} V${C - G} H${C + G} V${C + G} Z`,
  unknown:         () => `M${C - 3} ${C - 3} A3 3 0 1 1 ${C} ${C + 1} V${C + 2.4} M${C} ${C + G} v0.01`,
};

/* --- echelon -------------------------------------------------------------
   Echelon marks sit ABOVE the frame and grow the viewBox upward, so the symbol
   is never squeezed. Drawn as shapes, not text. */
const ECHELON = {
  squad:     { mark: 'o', n: 1 }, section: { mark: 'o', n: 2 }, platoon: { mark: 'o', n: 3 },
  company:   { mark: '|', n: 1 }, battalion: { mark: '|', n: 2 }, regiment: { mark: '|', n: 3 },
  brigade:   { mark: 'x', n: 1 }, division: { mark: 'x', n: 2 },
  corps:     { mark: 'x', n: 3 }, army: { mark: 'x', n: 4 },
  theatre:   { mark: 'x', n: 4 },
};

function echelonMarks(echelon, ink) {
  const e = ECHELON[echelon];
  if (!e) return '';
  const y = -3.5, gap = e.mark === 'x' ? 5 : 4;
  const total = (e.n - 1) * gap;
  let out = '';
  for (let i = 0; i < e.n; i++) {
    const x = C - total / 2 + i * gap;
    if (e.mark === 'o') out += `<circle cx="${x}" cy="${y}" r="1.7" fill="none" stroke="${ink}" stroke-width="1.2"/>`;
    else if (e.mark === '|') out += `<line x1="${x}" y1="${y - 2.4}" x2="${x}" y2="${y + 2.4}" stroke="${ink}" stroke-width="1.4"/>`;
    else out += `<g stroke="${ink}" stroke-width="1.3"><line x1="${x - 1.9}" y1="${y - 1.9}" x2="${x + 1.9}" y2="${y + 1.9}"/><line x1="${x + 1.9}" y1="${y - 1.9}" x2="${x - 1.9}" y2="${y + 1.9}"/></g>`;
  }
  return out;
}

/* --- 17.5 Cache. assetSymbol memoises by affiliation:type:size. ----------- */
const cache = new Map();

export function symbolSvg(type, affiliation = 'friendly', size = 22, opts = {}) {
  const key = `${affiliation}:${type}:${size}:${opts.echelon || ''}:${opts.damaged ? 1 : 0}`;
  if (cache.has(key)) return cache.get(key);

  const fill = AFFIL[affiliation] || AFFIL.neutral;
  const glyph = (GLYPH[type] || GLYPH.unknown)();
  const hasEch = !!ECHELON[opts.echelon];
  const top = hasEch ? -7 : 0;
  const h = BOX - top;
  const path = framePath(affiliation);
  const scale = size / BOX;

  const svg =
    `<svg class="sym" viewBox="0 ${top} ${BOX} ${h}" width="${size}" height="${(h * scale).toFixed(1)}" ` +
    `aria-hidden="true" focusable="false" overflow="visible">` +
      // the halo, then the fill
      `<path d="${path}" fill="none" stroke="var(--sym-halo)" stroke-width="3" stroke-linejoin="round"/>` +
      `<path d="${path}" fill="${fill}"/>` +
      // the glyph, knocked out of the frame
      `<path d="${glyph}" fill="none" stroke="var(--sym-ink)" stroke-width="1.8" ` +
        `stroke-linecap="round" stroke-linejoin="round"/>` +
      (hasEch ? echelonMarks(opts.echelon, fill) : '') +
      // a struck site carries the standard damage bar under the frame
      (opts.damaged ? `<line x1="${C - 7}" y1="${BOX - 1}" x2="${C + 7}" y2="${BOX - 1}" stroke="var(--sym-damaged)" stroke-width="2.4"/>` : '') +
    `</svg>`;

  cache.set(key, svg);
  return svg;
}

/* --- mapping the data to the set ----------------------------------------- */

export function affiliationFor(side) {
  if (side === 'own' || side === 'friendly' || side === false) return 'friendly';
  if (side === 'opp' || side === 'hostile' || side === true) return 'hostile';
  return 'neutral';
}

export function typeFor(item) {
  const cat = item.category || item.kind || item.type || '';
  const name = (item.name || '').toLowerCase();
  const t = (item.type || '').toLowerCase();

  switch (cat) {
    case 'Air defence': return 'air-defence';
    case 'Electronic warfare': return 'electronic-warfare';
    case 'Air bases': return 'airfield';
    case 'Strategic missile forces': return 'missile';
    case 'Armour': return 'armour';
    case 'Mechanised': return 'mechanised';
    case 'Fires':
      return t === 'missile' || name.includes('missile') ? 'missile' : 'artillery';
    case 'Coastal':
      return t === 'asm' || name.includes('coastal') ? 'missile' : 'naval-surface';
    case 'Aviation':
      if (t === 'uav' || name.includes('uav') || name.includes('shahpar')) return 'uav';
      if (t === 'rotary' || name.includes('rotary') || name.includes('helicopter')) return 'rotary-wing';
      return 'fixed-wing';
    default: break;
  }
  // depots and installations
  if (['base', 'field', 'forward', 'port', 'transit', 'works'].includes(cat)) return 'depot';
  // formations
  if (t === 'infantry') return 'infantry';
  if (t === 'armour') return 'armour';
  if (t === 'mechanised') return 'mechanised';
  if (t === 'aviation') return 'rotary-wing';
  if (t === 'engineer') return 'engineer';
  if (t === 'artillery') return 'artillery';
  return 'unknown';
}

export function assetSymbol(item, { side = 'own', size = 22, echelon = null, damaged = false } = {}) {
  return symbolSvg(typeFor(item), affiliationFor(side), size, { echelon, damaged });
}

/* --- the legend ----------------------------------------------------------
   Returns everything the legend shows, so a legend cannot fall out of step
   with the map. */
export function legend() {
  return {
    affiliations: [
      { id: 'friendly', name: 'Own forces', svg: symbolSvg('infantry', 'friendly', 16) },
      { id: 'hostile',  name: 'Opposing (assessed)', svg: symbolSvg('infantry', 'hostile', 16) },
      { id: 'neutral',  name: 'Neutral', svg: symbolSvg('infantry', 'neutral', 16) },
      { id: 'unknown',  name: 'Unknown', svg: symbolSvg('infantry', 'unknown', 16) },
    ],
    types: Object.keys(GLYPH).map(k => ({
      id: k, name: k.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()),
      svg: symbolSvg(k, 'friendly', 16),
    })),
    echelons: Object.keys(ECHELON).map(k => ({
      id: k, name: k.replace(/^./, c => c.toUpperCase()),
      svg: symbolSvg('infantry', 'friendly', 16, { echelon: k }),
    })),
    rings: [
      { id: 'cov-fires', name: 'Fires' }, { id: 'cov-ad', name: 'Air defence' },
      { id: 'cov-ew', name: 'Electronic warfare' }, { id: 'cov-strat', name: 'Strategic missile forces' },
      { id: 'cov-base', name: 'Air bases' }, { id: 'cov-other', name: 'Coastal and aviation' },
      { id: 'cov-hostile', name: 'Assessed' },
    ],
    routes: [
      { id: 'MSR', name: 'Main supply route', dash: '' }, { id: 'ASR', name: 'Alternate supply route', dash: '10 7' },
      { id: 'RAIL', name: 'Rail', dash: '3 6' }, { id: 'ALOC', name: 'Air line of supply', dash: '12 8' },
      { id: 'SLOC', name: 'Sea line of supply', dash: '16 7' }, { id: 'PIPE', name: 'Pipeline', dash: '2 5' },
    ],
  };
}

export const GLYPH_KEYS = Object.keys(GLYPH);
