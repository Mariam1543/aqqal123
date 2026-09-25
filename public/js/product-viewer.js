// Opens a product in an in-app panel with Print / Window / Close.
import { esc } from './state.js';

let el = null;

export function openProduct(kind = 'brief', params = {}) {
  close();
  const q = new URLSearchParams({ kind, ...params });
  el = document.createElement('div');
  el.className = 'prodv';
  el.innerHTML = `<button class="back" aria-label="Close"></button>
    <div class="win">
      <div class="prodv-bar">
        <span class="lbl" id="pv-mark"></span><b id="pv-title">Product</b>
        <span class="sp">
          <button class="btn-sm" data-pv="print">Print</button>
          <button class="btn-sm" data-pv="window">Window</button>
          <button class="btn-sm quiet" data-pv="close">Close</button>
        </span>
      </div>
      <iframe src="/product.html?${q}" title="Product"></iframe>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('.back').addEventListener('click', close);
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-pv]');
    if (!b) return;
    const frame = el.querySelector('iframe');
    if (b.dataset.pv === 'print') frame.contentWindow?.print();
    if (b.dataset.pv === 'window') window.open(frame.src, '_blank', 'width=900,height=1100');
    if (b.dataset.pv === 'close') close();
  });
  window.addEventListener('message', onMessage);
  document.addEventListener('keydown', onKey, true);
}

function onMessage(e) {
  if (e.data?.type === 'product' && el) {
    el.querySelector('#pv-title').textContent = e.data.title || 'Product';
    el.querySelector('#pv-mark').textContent = e.data.marking || '';
  }
  if (e.data?.type === 'product-close') close();
}
// Escape is captured at the window level and also bound inside the frame.
function onKey(e) { if (e.key === 'Escape' && el) { e.stopPropagation(); close(); } }

export function close() {
  if (!el) return;
  window.removeEventListener('message', onMessage);
  document.removeEventListener('keydown', onKey, true);
  el.remove(); el = null;
}
export const productOpen = () => !!el;
