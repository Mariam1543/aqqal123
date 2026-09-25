// The guided brief, the intro card, and the storyline runner.
import { state, emit, esc, days, setHtml, store, byId } from './state.js';

const STEPS = [
  { title: 'What this screen is', text: 'A standing readiness picture, not a battle simulation. It answers three questions: what do we hold, how long would it last, and what needs a decision.', act: null },
  { title: 'The measured posture', text: 'Everything is judged against one planning posture. The rail’s ladder shows every posture and what each requires.', act: { rail: true } },
  { title: 'The figure that matters', text: 'The command holds one figure and the forward depots hold another. The gap between them is the whole problem: the stock exists, it is not where the fighting is.', act: { board: 'sustainability' } },
  { title: 'What can reach us', text: 'Assessed systems carry a reach ring and a confidence, never a status. An assessment is a snapshot, not a return.', act: { force: 'both', preset: 'Non-contact' } },
  { title: 'The decision', text: 'Decide runs the estimate only when it is asked. It ranks courses by effect, cost and risk, and every hard decision carries its warnings.', act: { side: 'options' } },
  { title: 'Ask it', text: 'The agent answers from this picture and nothing else. Ask for courses of action, a strike option, or how long we last.', act: { side: 'assistant' } },
];

let step = 0, mode = null, story = null;

export function startBrief() { mode = 'brief'; step = 0; render(); }
export async function startCase() {
  try {
    const r = await fetch('/api/case');
    story = await r.json();
    state.caseStudy = story;
    mode = 'case'; step = 0; render();
  } catch (e) { /* nothing to run */ }
}
export function closeBrief() {
  mode = null;
  const host = document.getElementById('brief');
  if (host) host.hidden = true;
  emit('scenario-leave');
  state.scenario = null;
}
export const briefOpen = () => !!mode;
export function stepBrief(d) {
  const list = mode === 'case' ? story.steps : STEPS;
  step = Math.max(0, Math.min(list.length - 1, step + d));
  render();
}

function render() {
  const host = document.getElementById('brief');
  if (!host || !mode) return;
  const list = mode === 'case' ? story.steps : STEPS;
  const s = list[step];
  host.hidden = false;
  setHtml(host, `<div class="brief-b">
      <span class="lbl">${esc(mode === 'case' ? story.title : 'The brief')}</span>
      <b>${esc(s.title)}</b><p>${esc(s.text)}</p>
      ${mode === 'case' && step === list.length - 1 ? `<p style="margin-top:8px;color:var(--ink)">${esc(story.lesson)}</p>` : ''}
    </div>
    <div class="brief-f">
      <span class="step">${step + 1} of ${list.length}</span>
      <button class="btn-sm quiet" data-brief="prev" ${step === 0 ? 'disabled' : ''}>Back</button>
      <button class="btn btn-sm primary" data-brief="${step === list.length - 1 ? 'close' : 'next'}">
        ${step === list.length - 1 ? 'Done' : 'Next'}</button>
      <button class="btn-sm quiet" data-brief="close">Close</button>
    </div>`);

  // move the screen to match the step
  if (mode === 'case') {
    state.scenario = s;
    emit('scenario-at', s);
  } else if (s.act) {
    emit('brief-act', s.act);
  }
}

/* --- the intro ----------------------------------------------------------- */
export function showIntro() {
  const host = document.getElementById('intro');
  if (!host) return;
  host.hidden = false;
  host.innerHTML = `<div class="ov" role="dialog" aria-label="Welcome">
    <div class="ov-h"><span class="lbl eyebrow">Common Logistics Picture</span>
      <h2>What do we hold, and how long would it last?</h2></div>
    <div class="ov-b">
      <div class="intro-n"><span class="i">1</span><span>One screen. The map is the picture; everything else is a rail, a pane or an overlay around it.</span></div>
      <div class="intro-n"><span class="i">2</span><span>The map opens with nothing on it. Layers come on from the panel, a preset, a selection, or what the agent draws.</span></div>
      <div class="intro-n"><span class="i">3</span><span>Colour is spent on exceptions. A screen where everything is fine has almost no colour on it.</span></div>
    </div>
    <div class="ov-f">
      <button class="btn btn-sm primary" data-intro="brief">Start the brief</button>
      <button class="btn btn-sm" data-intro="case">Case study</button>
      <button class="btn btn-sm" data-intro="tour">Show me around</button>
      <button class="btn btn-sm quiet" data-intro="close">Go to the picture</button>
    </div></div>`;
}
export function closeIntro() {
  const host = document.getElementById('intro');
  if (host) { host.hidden = true; host.innerHTML = ''; }
  store('introSeen', '1');
}
