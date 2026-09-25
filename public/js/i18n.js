// Urdu labels on the chrome. Content is never translated; the picture reports
// what it reports. The English is kept in a WeakMap so it can switch back.

import { store, emit } from './state.js';

const UR = {
  'Status': 'صورتحال', 'Alerts': 'اطلاعات', 'Layers': 'تہیں', 'Legend': 'کلید',
  'Plan': 'منصوبہ', 'Measure': 'پیمائش', 'Range': 'فاصلہ', 'Clear': 'صاف',
  'Selected': 'منتخب', 'Decide': 'فیصلہ', 'Mission': 'مہم', 'Agent': 'معاون',
  'Own forces': 'اپنی افواج', 'Opposing': 'مخالف', 'Both': 'دونوں',
  'Systems': 'نظام', 'Sustainability': 'استحکام', 'Non-contact': 'غیر رابطہ',
  'Air': 'فضائی', 'Escalation ladder': 'شدت کی سیڑھی', 'Indicators': 'اشارے',
  'Decisions': 'فیصلے', 'Reserves': 'ذخائر', 'Movement': 'نقل و حرکت',
  'Engineering': 'انجینئری', 'Holdings': 'ذخیرہ', 'Force': 'قوت',
  'Presets': 'ترتیبات', 'Emphasis': 'زور', 'Logistics': 'رسد', 'Chart': 'نقشہ',
  'Supply': 'رسد', 'Flow': 'بہاؤ', 'Ask': 'پوچھیں', 'Close': 'بند',
  'Depots': 'ڈپو', 'Routes': 'راستے', 'Formations': 'تشکیلات', 'Serials': 'قافلے',
  'Imagery': 'تصویری', 'Dark canvas': 'تاریک', 'Light canvas': 'روشن', 'Relief': 'ابھار',
};

const SELECTORS = [
  '.lbl', '.btn', '.btn-sm', '.seg', '.chip', '.side-tabs .tb',
  '.board-nav button', '.blk-h h2', '.panel-h b', '.board-h > b', '.legend-h b',
  '.tools .btn-sm', '.layers-h b', '.pop-item',
];

const original = new WeakMap();
let observer = null, raf = null;

export function setLang(lang) {
  const ur = lang === 'ur';
  document.body.classList.toggle('lang-ur', ur);
  store('lang', ur ? 'ur' : 'en');
  if (ur) { translate(); watch(); } else { restore(); unwatch(); }
  emit('lang', ur ? 'ur' : 'en');
}
export const currentLang = () => (store('lang') === 'ur' ? 'ur' : 'en');

// The translator walks a fixed selector list and replaces only text nodes.
function translate(root = document.body) {
  for (const sel of SELECTORS) {
    for (const el of root.querySelectorAll(sel)) {
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE) continue;
        const text = node.nodeValue.trim();
        if (!text) continue;
        const hit = UR[text];
        if (!hit) continue;
        if (!original.has(node)) original.set(node, node.nodeValue);
        node.nodeValue = node.nodeValue.replace(text, hit);
      }
    }
  }
}
function restore() {
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) if (original.has(n)) n.nodeValue = original.get(n);
}
function watch() {
  if (observer) return;
  observer = new MutationObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => translate());
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
function unwatch() { observer?.disconnect(); observer = null; }
