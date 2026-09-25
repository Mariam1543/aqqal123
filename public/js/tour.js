// The spotlight tour: an SVG scrim with a hole over the element being described.
import { esc, setHtml } from './state.js';

const STEPS = [
  { sel: '#btn-more', title: 'Everything else', text: 'The brief, the boards, the clock, your role, the layout and the reset all live behind this one button. The header has no room to give.' },
  { sel: '#layers', title: 'Layers', text: 'The map opens empty. This is where you say what you want to see: a force, a preset, an emphasis, or one system at a time.' },
  { sel: '#tools', title: 'Tools', text: 'Draw a plan, measure a distance, or put range rings on a point. While a tool is live, a click belongs to the tool and not to what sits under it.' },
  { sel: '.side-tabs', title: 'The panes', text: 'Decide and the conversation always stand. Selected, Plan and Mission come and go with their contents.' },
  { sel: '#map', title: 'The picture', text: 'Click to select, right-click for actions, hover for the figures. Every point on this screen has a grid reference.' },
];

let i = 0, open = false;

export function startTour() { i = 0; open = true; render(); }
export function closeTour() {
  open = false;
  const host = document.getElementById('tour');
  if (host) { host.hidden = true; host.innerHTML = ''; }
}
export const tourOpen = () => open;
export function stepTour(d) {
  i += d;
  // A step whose target is not visible is skipped.
  while (i >= 0 && i < STEPS.length && !visible(STEPS[i].sel)) i += d || 1;
  if (i < 0 || i >= STEPS.length) return closeTour();
  render();
}
function visible(sel) {
  const el = document.querySelector(sel);
  if (!el || el.hidden) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function render() {
  const host = document.getElementById('tour');
  if (!host || !open) return;
  while (i < STEPS.length && !visible(STEPS[i].sel)) i++;
  if (i >= STEPS.length) return closeTour();
  const s = STEPS[i];
  const el = document.querySelector(s.sel);
  const r = el.getBoundingClientRect();
  const pad = 6;
  const W = window.innerWidth, H = window.innerHeight;
  host.hidden = false;

  // the card flies to the best free side
  const cardW = 340, cardH = 180;
  let left = r.right + 16, top = r.top;
  if (left + cardW > W - 12) left = r.left - cardW - 16;
  if (left < 12) { left = Math.min(Math.max(12, r.left), W - cardW - 12); top = r.bottom + 16; }
  if (top + cardH > H - 12) top = Math.max(12, H - cardH - 12);

  host.innerHTML = `<svg aria-hidden="true"><defs><mask id="tour-mask">
      <rect width="100%" height="100%" fill="#fff"/>
      <rect x="${r.left - pad}" y="${r.top - pad}" width="${r.width + pad * 2}" height="${r.height + pad * 2}"
        rx="4" fill="#000"/></mask></defs>
    <rect width="100%" height="100%" fill="rgba(4,6,9,.62)" mask="url(#tour-mask)"/>
    <rect x="${r.left - pad}" y="${r.top - pad}" width="${r.width + pad * 2}" height="${r.height + pad * 2}"
      rx="4" fill="none" stroke="var(--accent)" stroke-width="1.5"/></svg>
    <div class="tour-card" style="left:${left}px;top:${top}px">
      <span class="lbl">${i + 1} of ${STEPS.length}</span>
      <b>${esc(s.title)}</b><p>${esc(s.text)}</p>
      <div class="ov-f">
        <button class="btn-sm quiet" data-tour="prev" ${i === 0 ? 'disabled' : ''}>Back</button>
        <button class="btn btn-sm primary" data-tour="next">${i === STEPS.length - 1 ? 'Done' : 'Next'}</button>
        <button class="btn-sm quiet" data-tour="close" style="margin-left:auto">Skip</button>
      </div></div>`;
}
