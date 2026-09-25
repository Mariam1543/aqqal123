// Pop-out windows, synchronised by BroadcastChannel.
import { state, emit, on } from './state.js';

const SRC = Math.random().toString(36).slice(2, 10);
let chan = null;

export function initPop() {
  try { chan = new BroadcastChannel('clp'); } catch (e) { return; }
  chan.onmessage = e => {
    const m = e.data;
    if (!m || m.src === SRC) return;           // guard on a per-window id
    if (m.type === 'select') emit('select-remote', m.payload);
    if (m.type === 'scenario') emit('scenario-at', m.payload);
    if (m.type === 'force') emit('force-request', m.payload);
  };
  on('select', p => publish('select', p));
  on('force', p => publish('force', p));
  on('scenario-changed', p => publish('scenario', p));
}
function publish(type, payload) {
  try { chan?.postMessage({ type, payload, src: SRC }); } catch (e) { /* no channel */ }
}

export function applyPopMode() {
  const q = new URLSearchParams(location.search);
  const pop = q.get('pop');
  if (!pop) return null;
  const [kind, id] = pop.split(':');
  document.body.classList.add('pop', `pop-${kind}`);
  return { kind, id };
}

export function openPop(kind, id) {
  const url = new URL(location.href);
  url.searchParams.set('pop', `${kind}:${id}`);
  window.open(url.toString(), `clp-${kind}-${id}`, 'width=1100,height=820');
}
