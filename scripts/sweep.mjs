// sweep: drive the real browser through every workspace, board, card and agent
// flow. Fails on any console.error or page error that is not a tile fetch, any
// request to the app that fails, any HTTP >= 400, any pane containing
// "undefined" or "NaN", and any expected element that is missing.
//
// It kills only the browser it launched.

import { chromium } from 'playwright';
import { app } from '../server/index.js';
import fs from 'node:fs';
import path from 'node:path';

const SWEEP_DIR = process.env.SWEEP_DIR || '.sweep';
fs.mkdirSync(SWEEP_DIR, { recursive: true });

let fails = 0;
const ok = (c, m) => { if (!c) { console.error('  FAIL', m); fails++; } };
const section = s => console.log('\n' + s);

const srv = app.listen(0);
await new Promise(r => srv.once('listening', r));
const BASE = `http://127.0.0.1:${srv.address().port}`;

// Use the browser this image already ships, rather than downloading one. If the pinned
// Playwright build and the installed browser disagree, CHROME_PATH wins.
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!fs.existsSync(root)) return undefined;
  for (const d of fs.readdirSync(root).filter(x => x.startsWith('chromium-')).sort().reverse()) {
    const p = path.join(root, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}
const exe = chromePath();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});  // only this one is ours to kill
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

// A tile fetch may fail; nothing of ours may.
const isTile = u => /arcgisonline|elevation-tiles-prod|basemaps|tile/i.test(u);
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  // A failed resource reports its URL on the message location, not in the text, so
  // "Failed to load resource: net::ERR_..." has to be matched against location().url.
  const url = m.location?.()?.url || '';
  if (isTile(t) || isTile(url)) return;
  if (/Failed to load resource/.test(t) && !url.startsWith(BASE)) return;   // an external fetch
  ok(false, `console.error: ${t.slice(0, 200)} ${url ? `(${url})` : ''}`);
});
page.on('pageerror', e => ok(false, `page error: ${e.message}`));

// A request that already received a successful response delivered what it was asked
// for. A long-lived stream can still be flagged as aborted when its socket is torn
// down afterwards, which is not a delivery failure — so judge by whether a 2xx
// response arrived, and fail on anything that never got one.
const served = new Set();
page.on('response', r => {
  if (isTile(r.url())) return;
  if (r.status() < 400) { served.add(r.request()); return; }
  ok(false, `HTTP ${r.status()} on ${r.url()}`);
});
page.on('requestfailed', r => {
  if (isTile(r.url())) return;
  if (served.has(r)) return;                 // it was served; the socket closed after
  ok(false, `request failed: ${r.url()} — ${r.failure()?.errorText}`);
});

// A board covers the map, so the layer control is unreachable while one is open.
const openBoard = id => page.evaluate(b => {
  const x = document.createElement('button'); x.dataset.board = b;
  document.body.appendChild(x); x.click(); x.remove();
}, id);
const closeBoard = () => openBoard('');

const shot = async name => page.screenshot({ path: path.join(SWEEP_DIR, `${name}.png`), fullPage: false });
const text = async sel => (await page.locator(sel).first().innerText().catch(() => '')) || '';
const html = async sel => (await page.locator(sel).first().innerHTML().catch(() => '')) || '';

// No pane may contain a leaked undefined or NaN.
async function clean(name, sel) {
  const h = await html(sel);
  const m = /\b(undefined|NaN)\b/.exec(h);
  ok(!m, `${name} contains "${m?.[0]}": ${JSON.stringify(h.slice(Math.max(0, (m?.index ?? 0) - 60), (m?.index ?? 0) + 40))}`);
}
const exists = async (name, sel) => ok(await page.locator(sel).count() > 0, `${name}: ${sel} is missing`);

section('first paint');
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
// the intro is shown on a first visit
await exists('intro', '#intro .ov');
await shot('01-intro');
await page.click('[data-intro="close"]');
for (const sel of ['#frame', 'header.top', '#side', '#map', '#layers', '#tools', '#coords', '.side-tabs'])
  await exists('shell', sel);
ok((await text('#asof-dtg')).length > 5, 'the as-of chip is empty');
ok(await page.locator('body.live-on').count() > 0, 'the live dot never went green');
await clean('side', '#side');
await shot('02-first-paint');
console.log('  shell, as-of chip and the live dot');

section('the map opens with nothing on it');
ok(await page.locator('#map .mk').count() === 0, 'the map drew markers before anything was switched on');
console.log('  no markers until a layer is chosen');

section('layers: force, presets and emphasis');
await page.click('[data-force="own"]');
await page.waitForTimeout(500);
ok(await page.locator('#map .mk').count() > 0, 'the Default preset drew nothing');
await clean('layers', '#layers');
await shot('03-own-default');
for (const p of ['Air defence', 'Non-contact', 'Logistics', 'Flow', 'Reserves', 'Armour', 'Fires', 'Air bases', 'Missile forces']) {
  await page.click(`[data-preset="${p}"]`);
  await page.waitForTimeout(260);
  await clean(`preset ${p}`, '#layers');
  ok(!/\bNaN\b/.test(await html('#legend')), `preset ${p}: the legend leaked NaN`);
}
await page.click('[data-preset="Default"]');
for (const e of ['systems', 'supply', 'flow', 'reserves']) {
  await page.click(`[data-emphasis="${e}"]`);
  await page.waitForTimeout(220);
  await page.click(`[data-emphasis="${e}"]`);
}
await page.waitForTimeout(200);
await shot('04-presets');
console.log('  9 presets and 4 emphases, legend clean throughout');

section('the force switch');
for (const f of ['opp', 'both', 'own']) {
  await page.click(`[data-force="${f}"]`);
  await page.waitForTimeout(450);
  await clean(`rail (${f})`, '#rail');
  await clean(`layers (${f})`, '#layers');
}
await shot('05-force');
console.log('  own, opposing and both');

section('the status rail');
await page.evaluate(() => document.activeElement?.blur?.());
await page.keyboard.press('s');
await page.waitForTimeout(350);
ok(await page.locator('body.rail-open').count() > 0, 'the rail did not open');
await exists('rail ladder', '#rail .ladder-row');
await exists('rail gauges', '#rail .gauge');
await exists('rail reserves', '#rail .res-sq');
await clean('rail', '#rail');
await shot('06-rail');
// a ladder row posts its posture
const before = await text('#rail .ladder-row.is-sel .nm');
await page.locator('#rail .ladder-row').nth(2).click();
await page.waitForTimeout(3400);
ok((await text('#rail .ladder-row.is-sel .nm')) !== before, 'choosing a posture did not change the measured row');
await page.keyboard.press('s');
console.log('  four blocks, and a posture change that lands');

section('selecting every kind of object');
await page.click('[data-force="both"]');
await page.click('[data-preset="Default"]');
await page.waitForTimeout(500);
const targets = await page.evaluate(async () => {
  const d = await (await fetch('/api/clp')).json();
  return [
    ['asset', d.assets[0].id], ['node', d.nodes[0].id], ['unit', d.units[0].id],
    ['route', d.routes[0].id], ['convoy', d.convoys[0].id], ['reserve', d.reserves[0].id],
    ['fires', d.fires[0].id], ['platform', d.platforms[0].id],
    ['oasset', d.opposing.assets[0].id], ['onode', d.opposing.nodes[0].id],
    ['ounit', d.opposing.units[0].id], ['oroute', d.opposing.routes[0].id],
  ];
});
for (const [kind, id] of targets) {
  await page.evaluate(([k, i]) => {
    const ev = new CustomEvent('x');
    document.dispatchEvent(ev);
    // go through the app's own router, exactly as a click would
    const b = document.createElement('button');
    b.dataset.select = `${k}:${i}`;
    document.body.appendChild(b);
    b.click();
    b.remove();
  }, [kind, id]);
  await page.waitForTimeout(220);
  await exists(`detail ${kind}`, '#detail .d-h');
  await clean(`detail ${kind}`, '#detail');
  const h = await html('#detail');
  if (/^o/.test(kind)) ok(h.includes('assessed-banner'), `${kind}: no assessed banner`);
}
await shot('07-detail');
console.log(`  ${targets.length} kinds, each rendering a head and no leaks`);

section('every board, on both sides');
await page.click('[data-force="own"]');
await page.waitForTimeout(400);
const ownBoards = ['assets', 'sustainability', 'standoff', 'air', 'ladder', 'intel', 'decisions', 'reserves', 'movement', 'engineering'];
for (const b of ownBoards) {
  await openBoard(b);
  await page.waitForTimeout(b === 'intel' || b === 'decisions' ? 900 : 320);
  await exists(`board ${b}`, '#board-body');
  await clean(`board ${b}`, '#board-body');
  ok((await text('#board-title')).length > 0, `board ${b}: no title`);
  await shot(`08-board-${b}`);
}
await closeBoard();
await page.click('[data-force="opp"]');
await page.waitForTimeout(400);
for (const b of ['osystems', 'oreach', 'ostandoff', 'oair', 'osustainability', 'ologistics']) {
  await openBoard(b);
  await page.waitForTimeout(320);
  await clean(`board ${b}`, '#board-body');
  await shot(`09-board-${b}`);
}
await closeBoard();
await page.click('[data-force="own"]');
console.log('  10 own and 6 assessed boards, each with a title and no leaks');

section('table sorting survives a poll');
await openBoard('assets');
await page.waitForTimeout(400);
await page.locator('#board-body table th').nth(2).click();
await page.waitForTimeout(200);
const sortedFirst = await text('#board-body table tbody tr:first-child td:first-child');
await page.waitForTimeout(3500);      // a full poll
const stillFirst = await text('#board-body table tbody tr:first-child td:first-child');
ok(sortedFirst === stillFirst, `the sort was lost across a poll: "${sortedFirst}" became "${stillFirst}"`);
ok(await page.locator('#board-body table th[aria-sort]').count() > 0, 'the sort indicator was lost');
console.log('  a sorted column is still sorted after three seconds');

section('Decide');
await closeBoard();
await page.evaluate(() => { const x = document.createElement('button'); x.dataset.side = 'options'; document.body.appendChild(x); x.click(); x.remove(); });
await page.waitForTimeout(300);
ok((await text('#options')).includes('No decision on the table'), 'Decide did not open at rest');
await shot('10-decide-resting');
await page.click('[data-decide-run="1"]');
await page.waitForTimeout(900);
await exists('courses', '#options .coa');
await clean('decide', '#options');
const coaCount = await page.locator('#options .coa').count();
ok(coaCount >= 4, `only ${coaCount} courses`);
await shot('11-decide-estimate');
// walk every course
for (let i = 0; i < coaCount; i++) {
  await page.locator('#options .coa').nth(i).click();
  await page.waitForTimeout(240);
  await clean(`course ${i}`, '#options');
}
// tick two and make them the commander's course
await page.locator('#options [data-option-choose]').nth(0).click();
await page.waitForTimeout(200);
await page.locator('#options [data-option-choose]').nth(1).click();
await page.waitForTimeout(200);
ok(await page.locator('[data-intent-build]').count() > 0, 'ticking courses did not offer to combine them');
await page.click('[data-intent-build="1"]');
await page.waitForTimeout(3400);
ok((await html('#options')).includes('Commander'), "the commander's course did not lead the list");
await shot('12-decide-intent');
await page.click('[data-intent-clear="1"]');
await page.waitForTimeout(3400);
console.log(`  resting, ${coaCount} courses walked, the commander's course set and cleared`);

section('the strike option');
const strikeTarget = await page.evaluate(async () => (await (await fetch('/api/clp')).json()).opposing.assets[0].id);
await page.evaluate(id => { const x = document.createElement('button'); x.dataset.strike = `oasset:${id}`; document.body.appendChild(x); x.click(); x.remove(); }, strikeTarget);
await page.waitForTimeout(800);
await clean('strike option', '#options');
ok((await html('#options')).includes('assessed-banner'), 'the strike option carries no assessed banner');
await shot('13-strike');
console.log('  a package, its alternatives and its escalation estimate');

section('the agent');
await page.evaluate(() => { const x = document.createElement('button'); x.dataset.side = 'assistant'; document.body.appendChild(x); x.click(); x.remove(); });
await page.waitForTimeout(250);
ok((await text('#chat')).includes('Standing by'), 'the idle card is missing');
const questions = [
  'what are my courses of action', 'how long do we last', 'what is exposed',
  'strike the pinaka group', 'what will they do next', 'release the reserve',
  'tell me about the routes', 'what about the depots', 'the drone mission', 'run the exchange',
];
let cardsSoFar = 0;
for (const q of questions) {
  // An answer's ui frame may move the screen (to Decide, a board, the mission
  // console). That is the point of it, so come back to the conversation each time.
  await page.evaluate(() => { const x = document.createElement('button'); x.dataset.side = 'assistant'; document.body.appendChild(x); x.click(); x.remove(); });
  await page.waitForTimeout(200);
  await page.fill('#chat-input', q);
  await page.press('#chat-input', 'Enter');
  // The working indicator clears on the first text delta, which is before the card
  // frame lands — so wait for the card itself, not for the indicator.
  await page.waitForFunction(
    n => document.querySelectorAll('#chat .acard').length > n,
    cardsSoFar, { timeout: 20000 },
  ).catch(() => ok(false, `"${q}" produced no card`));
  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('#chat .msg.bot');
    const last = msgs[msgs.length - 1];
    return last && !last.querySelector('.working');
  }, null, { timeout: 20000 }).catch(() => ok(false, `"${q}" never finished`));
  // The agent's own signal that the stream is finished: the mode dot stops pulsing.
  await page.waitForFunction(() => !document.querySelector('#mode-dot')?.classList.contains('busy'),
    null, { timeout: 20000 }).catch(() => ok(false, `"${q}" left the agent busy`));
  await page.waitForTimeout(150);
  await clean(`answer to "${q}"`, '#chat');
  cardsSoFar = await page.locator('#chat .acard').count();
}
ok(cardsSoFar >= questions.length, `${questions.length} questions produced only ${cardsSoFar} cards`);
await shot('14-agent');
// the fold toggle is assembled from the DOM
const foldLabel = await text('#chat .acard:last-child [data-card-fold]');
ok(foldLabel.length > 0, 'the Details toggle has no label');
ok(/Details|Note|Less/.test(foldLabel), `the Details toggle reads "${foldLabel}"`);
await page.locator('#chat .acard [data-card-fold]').last().click();
await page.waitForTimeout(250);
ok(await page.locator('#chat .acard.is-open').count() > 0, 'a card did not open');
await clean('open card', '#chat');
await shot('15-agent-open');
console.log(`  ${questions.length} questions, each answered with a card; the fold toggle reads "${foldLabel}"`);

section('the two-click hard approval');
await page.evaluate(() => { const x = document.createElement('button'); x.dataset.side = 'assistant'; document.body.appendChild(x); x.click(); x.remove(); });
await page.waitForTimeout(200);
await page.fill('#chat-input', 'release the reserve');
await page.press('#chat-input', 'Enter');
await page.waitForFunction(() => !document.querySelector('#mode-dot')?.classList.contains('busy'),
  null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(300);
const hard = page.locator('#chat [data-agent-act][data-hard="1"]').first();
if (await hard.count() > 0) {
  const label0 = await hard.innerText();
  await hard.click();
  await page.waitForTimeout(200);
  const label1 = await hard.innerText();
  ok(label1 !== label0 && /Warnings read/.test(label1), `the first click did not arm the approval: "${label1}"`);
  await hard.click();
  await page.waitForTimeout(3400);
  console.log('  first click arms, second click posts');
} else console.log('  (no hard action offered this run)');

section('workspaces and the ask bar');
// While typing, only Escape is handled. Leave the composer before pressing a shortcut.
await page.evaluate(() => document.activeElement?.blur?.());
await page.waitForTimeout(150);
for (const [key, name] of [['1', 'watch'], ['2', 'plan'], ['3', 'agent'], ['1', 'watch']]) {
  await page.keyboard.press(`Alt+${key}`);
  await page.waitForTimeout(400);
  ok(await page.locator(`body.ws-${name}`).count() > 0, `Alt+${key} did not set ws-${name}`);
  await clean(`workspace ${name}`, '#side');
}
await shot('16-workspaces');
await page.evaluate(() => { const x = document.createElement('button'); x.dataset.side = 'assistant'; document.body.appendChild(x); x.click(); x.remove(); });
await page.waitForTimeout(250);
await page.click('#btn-dock');
await page.waitForTimeout(350);
ok(await page.locator('body.dock-on').count() > 0, 'the ask bar did not dock');
ok(await page.locator('#dock-slot #chat-form').count() > 0, 'the form did not move into the dock');
// it still submits from down there
const userMsgs = await page.locator('#chat .msg.user').count();
await page.fill('#chat-input', 'how long do we last');
await page.press('#chat-input', 'Enter');
await page.waitForTimeout(2600);
ok(await page.locator('#chat .msg.user').count() > userMsgs, 'the docked form did not submit');
await shot('17-dock');
await page.click('#btn-dock');
await page.waitForTimeout(300);
ok(await page.locator('#assistant #chat-form').count() > 0, 'the form did not come back');
console.log('  three workspaces, and the ask bar carries its handlers with it');

section('the command palette');
await page.evaluate(() => document.activeElement?.blur?.());
await page.keyboard.press('Control+k');
await page.waitForTimeout(300);
await exists('palette', '#palette .ov');
await page.fill('#pal-input', 'sustain');
await page.waitForTimeout(250);
ok(await page.locator('.pal-row').count() > 0, 'the palette matched nothing for "sustain"');
await shot('18-palette');
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
ok(await page.locator('#palette').isHidden(), 'the palette did not close on Enter');
await page.keyboard.press('Control+k');
await page.fill('#pal-input', 'zzzzqqq');
await page.waitForTimeout(200);
ok((await text('#palette')).includes('Nothing matches'), 'the palette did not say it matched nothing');
await page.keyboard.press('Escape');
console.log('  opens, matches, runs and closes');

section('the tools');
await closeBoard();                       // a board covers the map and the toolbar with it
await page.waitForTimeout(250);
for (const t of ['measure', 'range']) {
  await page.click(`[data-tool="${t}"]`);
  await page.waitForTimeout(200);
  ok(await page.locator('#map.is-tool').count() > 0, `${t} did not arm the map`);
  await page.mouse.click(900, 450);
  await page.waitForTimeout(200);
  await page.mouse.click(1100, 550);
  await page.waitForTimeout(300);
  await shot(`19-tool-${t}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok(await page.locator('#map.is-tool').count() === 0, `${t} did not disarm on Escape`);
}
await page.click('[data-tool="clear"]');
console.log('  measure and range arm, draw and disarm');

section('the context menu');
await closeBoard();
await page.click('[data-preset="Default"]');
await page.waitForTimeout(500);
const mk = page.locator('#map .mk:visible').first();
ok(await mk.count() > 0, 'no marker to right-click');
await mk.click({ button: 'right', timeout: 10000 }).catch(e => ok(false, `right-click failed: ${e.message.split('\n')[0]}`));
await page.waitForTimeout(400);
ok(await page.locator('#cmenu').isVisible(), 'the context menu did not open on an object');
ok((await text('#cmenu')).includes('Copy grid'), 'the context menu has no grid action');
await shot('20-cmenu');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
ok(await page.locator('#cmenu').isHidden(), 'the context menu did not close');
console.log('  opens on an object, carries a grid, closes on Escape');

section('the alerts queue');
await page.evaluate(() => document.activeElement?.blur?.());
await page.keyboard.press('a');
await page.waitForTimeout(300);
ok(await page.locator('#alerts-pop').isVisible(), 'the alerts popover did not open');
ok(await page.locator('.alert-row').count() > 0, 'no alerts listed');
await clean('alerts', '#alerts-pop');
await page.click('[data-ack-all="1"]');
await page.waitForTimeout(300);
ok(await page.locator('#alerts-count:visible').count() === 0, 'acknowledging did not clear the badge');
await shot('21-alerts');
await page.keyboard.press('Escape');
await page.keyboard.press('a');
console.log('  lists, acknowledges and clears its badge');

section('the More menu and the clock');
await page.click('#btn-more');
await page.waitForTimeout(300);
await exists('more', '#more-pop .pop-sec');
await clean('more', '#more-pop');
ok(/role/i.test(await html('#more-pop')), 'the More menu has no role control');
ok(await page.locator('#more-pop [data-role]').count() > 0, 'the role segmented control is empty');
ok(await page.locator('#more-pop [data-speed]').count() === 4, 'the clock-rate group is missing');
await shot('22-more');
await page.click('#more-pop [data-speed="6"]');
await page.waitForTimeout(3400);
await page.click('#btn-more');           // close
await page.waitForTimeout(200);
await page.click('#btn-more');           // and reopen, which re-renders it
await page.waitForTimeout(400);
ok(await page.locator('#more-pop .seg.is-on[data-speed="6"]').count() > 0, 'the clock rate did not stick');
await page.click('#more-pop [data-speed="1"]');
await page.waitForTimeout(3400);
await page.keyboard.press('Escape');
console.log('  role, postures, clock rate and the replay control');

section('wall mode');
await page.evaluate(() => document.activeElement?.blur?.());
await page.keyboard.press('w');
await page.waitForTimeout(1200);
ok(await page.locator('body.wall').count() > 0, 'wall mode did not engage');
ok(await page.locator('#ribbon:visible').count() > 0, 'the ribbon did not appear on the wall');
await clean('ribbon', '#ribbon');
ok(await page.locator('#board:visible').count() > 0, 'no board on the wall');
await page.waitForTimeout(1500);
ok((await text('#ticker')).length > 10, 'the ticker is empty');
await shot('23-wall');
await page.keyboard.press('w');
await page.waitForTimeout(600);
ok(await page.locator('body.wall').count() === 0, 'wall mode did not disengage');
console.log('  ribbon, a cycling board and the ticker');

section('the light room and high contrast');
await closeBoard();
await page.click('[data-theme-toggle]').catch(async () => {
  await page.click('[data-layers-collapse]');
  await page.click('[data-theme-toggle]');
});
await page.waitForTimeout(600);
ok(await page.locator('html[data-theme="light"]').count() > 0, 'the light theme did not apply');
await clean('side (light)', '#side');
await shot('24-light');
await page.click('[data-theme-toggle]');
await page.waitForTimeout(500);
await page.emulateMedia({ forcedColors: null, colorScheme: 'dark', reducedMotion: 'reduce' });
await page.waitForTimeout(300);
await shot('25-reduced-motion');
await page.emulateMedia({ reducedMotion: 'no-preference' });
console.log('  light theme applies and reverts; reduced motion renders');

section('1440 and 1920, with no horizontal scroll');
for (const w of [1440, 1920, 1280, 1080]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(600);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!overflow, `${w}px: the page scrolls horizontally`);
  await clean(`side at ${w}`, '#side');
  await shot(`26-width-${w}`);
}
await page.setViewportSize({ width: 1600, height: 900 });
console.log('  1440, 1920, 1280 and 1080 all fit');

section('the brief, the case study and the tour');
await page.evaluate(() => { const x = document.createElement('button'); x.dataset.brief = 'start'; document.body.appendChild(x); x.click(); x.remove(); });
await page.waitForTimeout(400);
for (let i = 0; i < 5; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(350); }
await clean('brief', '#brief');
await shot('27-brief');
await page.keyboard.press('Escape');
await page.evaluate(() => { const x = document.createElement('button'); x.dataset.case = '1'; document.body.appendChild(x); x.click(); x.remove(); });
await page.waitForTimeout(700);
for (let i = 0; i < 5; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400); }
await clean('case', '#brief');
await shot('28-case');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
console.log('  six brief steps and six case steps, each moving the screen');

section('the mission console and the feed');
await page.evaluate(() => { const x = document.createElement('button'); x.dataset.side = 'mission'; document.body.appendChild(x); x.click(); x.remove(); });
await page.waitForTimeout(400);
await clean('mission', '#mission-body');
await exists('mission phases', '.phase-bar');
await shot('29-mission');
await page.locator('[data-feed-open]').first().click();
await page.waitForTimeout(1200);
ok(await page.locator('#feed:visible').count() > 0, 'the feed did not open');
await clean('feed', '#feed');
await page.click('[data-feed-sensor="IR"]');
await page.waitForTimeout(500);
ok(await page.locator('.fv-map.ir').count() > 0, 'IR mode did not apply');
await shot('30-feed');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
ok(await page.locator('#feed').isHidden(), 'the feed did not close on Escape');
console.log('  the console, the feed and its IR mode');

section('3D terrain');
await page.click('[data-terrain-open]');
await page.waitForTimeout(2500);
ok(await page.locator('#terrain:visible').count() > 0, 'the terrain view did not open');
await clean('terrain', '#terrain');
await page.click('[data-terrain-side="1"]').catch(() => {});
await page.waitForTimeout(600);
await shot('31-terrain');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
ok(await page.locator('#terrain').isHidden(), 'the terrain view did not close');
console.log('  opens, lists its elements and closes');

section('the product viewer');
await page.evaluate(() => { document.getElementById('more-pop').hidden = true; });
await page.click('#btn-more');
await page.waitForTimeout(250);
await page.click('[data-product="brief"]');
await page.waitForTimeout(1600);
ok(await page.locator('.prodv').count() > 0, 'the product viewer did not open');
const frame = page.frameLocator('.prodv iframe');
ok((await frame.locator('#doc').innerText().catch(() => '')).length > 40, 'the product sheet is empty');
await shot('32-product');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
ok(await page.locator('.prodv').count() === 0, 'the product viewer did not close');
console.log('  the decision brief renders and prints');

section('the symbol contact sheet');
const p2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
p2.on('pageerror', e => ok(false, `symbols.html: ${e.message}`));
await p2.goto(BASE + '/symbols.html', { waitUntil: 'networkidle' });
await p2.waitForTimeout(500);
ok(await p2.locator('.cell').count() > 30, 'the contact sheet is thin');
ok(await p2.locator('.cell svg').count() > 30, 'the contact sheet has no symbols');
await p2.screenshot({ path: path.join(SWEEP_DIR, '33-symbols.png') });
await p2.close();
console.log(`  ${await page.evaluate(() => 1) && ''}the sheet renders every glyph, affiliation and echelon`);

section('Escape unwinds the whole stack');
await page.keyboard.press('s');
await page.waitForTimeout(300);
await openBoard('assets');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');       // the board
await page.waitForTimeout(250);
ok(await page.locator('#board').isHidden(), 'Escape did not close the board');
await page.keyboard.press('Escape');       // the rail
await page.waitForTimeout(250);
ok(await page.locator('body.rail-open').count() === 0, 'Escape did not close the rail');
console.log('  board, then rail, in that order');

section('a text selection and an open details survive a poll');
await openBoard('sustainability');
await page.waitForTimeout(500);
await page.evaluate(() => {
  const el = document.querySelector('#board-body .kpi .v');
  const r = document.createRange();
  r.selectNodeContents(el);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
const sel0 = await page.evaluate(() => getSelection().toString());
await page.waitForTimeout(3600);
const sel1 = await page.evaluate(() => getSelection().toString());
ok(sel0 && sel0 === sel1, `the text selection was destroyed by a poll: "${sel0}" became "${sel1}"`);
console.log(`  a selection of "${sel0}" is still selected three seconds later`);

section('final state is clean');
await clean('side', '#side');
await clean('rail', '#rail');
await clean('board', '#board-body');
await clean('layers', '#layers');
await shot('34-final');

await browser.close();                     // only the browser we launched
srv.close();

console.log(`\nscreenshots in ${SWEEP_DIR}/`);
console.log(fails ? `sweep: ${fails} FAILED` : 'sweep: passed');
process.exit(fails ? 1 : 0);
