// A minimal DOM, enough to import and run the real render modules in Node.
// Keep the modules importable under this stub: no top-level DOM access outside
// an init*() function, no top-level await on the network.

class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { for (const x of c) if (x) this.set.add(x); }
  remove(...c) { for (const x of c) this.set.delete(x); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : !!force;
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }
  contains(c) { return this.set.has(c); }
  get value() { return [...this.set].join(' '); }
}

class El {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this.childNodes = [];
    this.dataset = {};
    this.style = { setProperty() {}, getPropertyValue() { return ''; }, cssText: '' };
    this.classList = new ClassList(this);
    this.attributes = {};
    this.hidden = false;
    this._html = '';
    this.scrollTop = 0; this.scrollLeft = 0; this.scrollHeight = 0; this.clientHeight = 0;
    this.offsetWidth = 100;
    this.textContent = '';
  }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  hasAttribute(k) { return k in this.attributes; }
  appendChild(c) { this.children.push(c); this.childNodes.push(c); return c; }
  insertBefore(c) { this.children.unshift(c); return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); }
  remove() {}
  addEventListener() {} removeEventListener() {} dispatchEvent() { return true; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20 }; }
  focus() {} click() {} blur() {}
  contains() { return false; }
  get firstChild() { return this.children[0] || null; }
}

const registry = new Map();
const doc = {
  documentElement: new El('html'),
  body: new El('body'),
  readyState: 'complete',
  hidden: false,
  getElementById(id) {
    if (!registry.has(id)) registry.set(id, new El('div', id));
    return registry.get(id);
  },
  createElement(tag) { return new El(tag); },
  createTreeWalker() { return { nextNode: () => null }; },
  querySelector(sel) {
    const m = /^#([\w-]+)$/.exec(sel);
    return m ? doc.getElementById(m[1]) : null;
  },
  querySelectorAll() { return []; },
  addEventListener() {}, removeEventListener() {},
};
doc.documentElement.dataset = {};

class Store {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

export function installDom() {
  globalThis.document = doc;
  globalThis.window = {
    fetch: globalThis.fetch?.bind(globalThis) || (() => Promise.reject(new Error('no fetch'))),
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame: fn => setTimeout(fn, 0),
    cancelAnimationFrame: id => clearTimeout(id),
    innerWidth: 1600, innerHeight: 900,
    location: { search: '', href: 'http://localhost/' },
    open() {}, postMessage() {},
  };
  globalThis.localStorage = new Store();
  globalThis.sessionStorage = new Store();
  globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame;
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  globalThis.NodeFilter = { SHOW_TEXT: 4 };
  // navigator is a getter-only global in Node, so define it rather than assign.
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: () => Promise.resolve() }, mediaDevices: {} },
    configurable: true, writable: true,
  });
  globalThis.L = new Proxy(function () {}, {
    get: () => globalThis.L,
    apply: () => globalThis.L,
    construct: () => globalThis.L,
  });
  return { doc, registry, El };
}
export { doc, registry, El };
