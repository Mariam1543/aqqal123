// The simulation. One snapshot object, advanced by tick(). Every figure on the screen
// is derived here so the front end owns no maths it could get wrong on its own.

import { META, SCENARIOS, NODES, UNITS, ASSETS, ROUTES, CONVOYS, RESERVES, WORKSHOPS, OPPOSING } from './seed.js';

const CLASS_IDS = Object.keys(META.classes);

// What each posture does to consumption.
const POSTURE_DEMAND = { hold: 1.0, defend: 1.65, counter: 2.45, sustain: 2.9 };

// The endurance the picture is calibrated to show at the *defend* posture, per class, in days.
// Demand is solved from the seeded stock so the ladder breaks where it should: comfortable at
// hold, marginal at defend, short at counter and sustain, with guided munitions limiting.
const CALIBRATION_DAYS = { I: 21, III: 13, V: 14.5, PGM: 11.5, IX: 18, II: 25, IV: 23, VIII: 12.5 };
const CALIBRATION_POSTURE = 1.65;

// A small deterministic noise source, so a reload does not reshuffle the theatre.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function statusOfFill(f, t = META.fillThresholds) {
  if (f >= t.green) return 'GREEN';
  if (f >= t.amber) return 'AMBER';
  if (f >= t.red) return 'RED';
  return 'BLACK';
}
export function statusOfDos(d, cls) {
  const norm = META.classes[cls]?.norm || 10;
  const r = d / norm;
  if (r >= 1) return 'GREEN';
  if (r >= 0.7) return 'AMBER';
  if (r >= 0.4) return 'RED';
  return 'BLACK';
}
export function statusOfRoute(s) {
  return s === 'OPEN' ? 'GREEN' : s === 'RESTRICTED' ? 'AMBER' : 'RED';
}
export function verdictStatus(v) {
  return v === 'ADEQUATE' ? 'GREEN' : v === 'MARGINAL' ? 'AMBER' : 'RED';
}
const ORDER = { GREEN: 0, AMBER: 1, RED: 2, BLACK: 3 };
export function worst(...sts) {
  return sts.filter(Boolean).reduce((a, b) => (ORDER[b] > ORDER[a] ? b : a), 'GREEN');
}

export class Sim {
  constructor() { this.reset(); }

  reset() {
    const r = rng(20260925);
    this.startedAt = Date.now();
    this.simTime = new Date('2026-09-25T09:00:00Z').getTime();
    this.tickCount = 0;
    this.speed = 1;
    this.selectedScenario = 'defend';
    this.posture = 'Defend forward';
    this.intent = null;
    this.works = [];
    this.nextEventId = 1;

    // Node stock: objective x a per-class fill wobble around the node's seed fill.
    this.nodes = NODES.map(n => {
      const stock = {};
      for (const c of Object.keys(n.objective)) {
        const wobble = 0.86 + r() * 0.3;
        stock[c] = Math.round(n.objective[c] * clamp(n.fillSeed * wobble, 0.08, 1.06));
      }
      return { ...n, stock, throughputPerDay: Math.round(400 + r() * 1800), staffPresent: Math.round(n.staff * (0.88 + r() * 0.1)) };
    });

    this.units = UNITS.map(u => ({ ...u, holds: { ...u.holds }, casualties: Math.round((1 - u.strength) * u.estab) }));
    this.assets = ASSETS.map(a => ({ ...a, rounds: { ...a.rounds }, struck: false }));
    this.routes = ROUTES.map(rt => ({ ...rt }));
    this.convoys = CONVOYS.map(c => ({ ...c, state: 'moving' }));
    this.reserves = RESERVES.map(v => ({ ...v }));
    this.workshops = WORKSHOPS.map(w => ({ ...w }));
    this.missions = this.seedMissions();
    this.events = [];
    this.calibrate();
    this.history = this.seedHistory();
    this.seedEvents();
  }

  // --- derived quantities -------------------------------------------------

  // Solve the baseline daily demand once, from the stock actually seeded into the depots.
  calibrate() {
    const stock = this.stockTotals();
    this.baseDemand = {};
    for (const c of CLASS_IDS) {
      const target = CALIBRATION_DAYS[c] || 14;
      this.baseDemand[c] = stock[c] / (target * CALIBRATION_POSTURE) || 1;
    }
  }

  demandFor(scenarioId) {
    const m = POSTURE_DEMAND[scenarioId] ?? 1;
    const out = {};
    for (const c of CLASS_IDS) out[c] = (this.baseDemand[c] || 100) * m;
    return out;
  }

  stockTotals(filterFn = () => true) {
    const out = {};
    for (const c of CLASS_IDS) out[c] = 0;
    for (const n of this.nodes) {
      if (!filterFn(n)) continue;
      for (const c of CLASS_IDS) out[c] += n.stock[c] || 0;
    }
    return out;
  }

  // Days of supply held, command-wide and forward, at a given posture.
  daysOfSupply(scenarioId, forwardOnly = false) {
    const demand = this.demandFor(scenarioId);
    const stock = this.stockTotals(n => (forwardOnly ? !!n.forward : true));
    // Forward demand is the share consumed by the formations actually in contact.
    const share = forwardOnly ? 0.17 : 1;
    const out = {};
    for (const c of CLASS_IDS) {
      const d = demand[c] * share;
      out[c] = d > 0 ? stock[c] / d : 0;
    }
    return out;
  }

  // The class that runs out first — the same class that sets sustainableDays. Judging this
  // by ratio-to-norm instead would name a class the endurance figure does not come from.
  limitingClass(dos) {
    let lim = null, least = Infinity;
    for (const c of CLASS_IDS) {
      if (dos[c] < least) { least = dos[c]; lim = c; }
    }
    return lim;
  }

  // The row the whole rail is judged against.
  scenarioRow(sc) {
    const dos = this.daysOfSupply(sc.id, false);
    const fwd = this.daysOfSupply(sc.id, true);
    const classes = CLASS_IDS.map(c => ({
      cls: c,
      name: META.classes[c].name,
      short: META.classes[c].short,
      days: dos[c],
      forwardDays: fwd[c],
      norm: META.classes[c].norm,
      lead: META.classes[c].lead,
      status: statusOfDos(dos[c], c),
      forwardStatus: statusOfDos(fwd[c], c),
    }));
    // Endurance is set by the class that runs out first.
    const sustainableDays = Math.min(...classes.map(c => c.days));
    const forwardDays = Math.min(...classes.map(c => c.forwardDays));
    const verdict = sustainableDays >= sc.required ? 'ADEQUATE'
      : sustainableDays >= sc.required * 0.75 ? 'MARGINAL' : 'INADEQUATE';
    const forwardVerdict = forwardDays >= sc.required ? 'ADEQUATE'
      : forwardDays >= sc.required * 0.75 ? 'MARGINAL' : 'INADEQUATE';
    return {
      id: sc.id, name: sc.name, rung: sc.rung, note: sc.note,
      requiredDays: sc.required,
      sustainableDays, forwardDays, verdict, forwardVerdict,
      limitingClass: this.limitingClass(dos),
      forwardLimitingClass: this.limitingClass(fwd),
      classes,
    };
  }

  scenarioMatrix() { return SCENARIOS.map(sc => this.scenarioRow(sc)); }

  gate() {
    const sc = SCENARIOS.find(s => s.id === this.selectedScenario) || SCENARIOS[1];
    return this.scenarioRow(sc);
  }

  nodeFill(n) {
    const keys = Object.keys(n.objective);
    if (!keys.length) return 1;
    let held = 0, obj = 0;
    for (const c of keys) { held += Math.min(n.stock[c] || 0, n.objective[c]); obj += n.objective[c]; }
    return obj > 0 ? held / obj : 1;
  }

  nodeView(n) {
    const fill = this.nodeFill(n);
    const classes = Object.keys(n.objective).map(c => {
      const f = (n.stock[c] || 0) / n.objective[c];
      return { cls: c, name: META.classes[c].name, short: META.classes[c].short, held: n.stock[c] || 0, objective: n.objective[c], fill: f, status: statusOfFill(f) };
    });
    const lowest = classes.slice().sort((a, b) => a.fill - b.fill)[0];
    return {
      ...n, fill, classes,
      status: statusOfFill(fill),
      lowestClass: lowest ? lowest.cls : null,
      lowestStatus: lowest ? lowest.status : 'GREEN',
      routesIn: this.routes.filter(r => r.to === n.id).map(r => r.id),
      routesOut: this.routes.filter(r => r.from === n.id).map(r => r.id),
      serves: this.units.filter(u => u.parent === n.id).map(u => u.id),
    };
  }

  unitView(u) {
    const classes = Object.keys(u.holds).map(c => ({
      cls: c, name: META.classes[c].name, short: META.classes[c].short,
      days: u.holds[c], norm: META.classes[c].norm, status: statusOfDos(u.holds[c], c),
    }));
    const lowest = classes.slice().sort((a, b) => a.days / a.norm - b.days / b.norm)[0];
    return {
      ...u, classes,
      status: lowest ? lowest.status : 'GREEN',
      limitingClass: lowest ? lowest.cls : null,
      sustainableDays: Math.min(...classes.map(c => c.days)),
      fedBy: u.parent,
      strengthStatus: u.strength >= 0.9 ? 'GREEN' : u.strength >= 0.8 ? 'AMBER' : 'RED',
    };
  }

  assetView(a) {
    const serviceability = a.held > 0 ? a.serviceable / a.held : 0;
    const rounds = Object.keys(a.rounds).map(c => {
      const rate = a.dayRate[c] || 0;
      const days = rate > 0 ? a.rounds[c] / rate : Infinity;
      return {
        cls: c, name: META.classes[c].name, short: META.classes[c].short,
        held: a.rounds[c], perDay: rate,
        days: Number.isFinite(days) ? days : null,
        norm: META.classes[c].norm, lead: META.classes[c].lead,
        status: Number.isFinite(days) ? statusOfDos(days, c) : 'GREEN',
      };
    });
    const worstRound = rounds.slice().sort((a2, b) => (a2.days ?? 99) / a2.norm - (b.days ?? 99) / b.norm)[0];
    return {
      ...a, serviceability, rounds,
      status: worst(
        serviceability >= 0.9 ? 'GREEN' : serviceability >= 0.75 ? 'AMBER' : serviceability >= 0.5 ? 'RED' : 'BLACK',
        worstRound ? worstRound.status : 'GREEN'
      ),
      daysOfFire: worstRound ? worstRound.days : null,
      limitingClass: worstRound ? worstRound.cls : null,
    };
  }

  routeView(r) {
    const conv = this.convoys.filter(c => c.route === r.id);
    const used = conv.reduce((s, c) => s + c.tonnes, 0);
    return {
      ...r,
      status: r.status,
      statusColour: statusOfRoute(r.status),
      effectiveCapacity: r.status === 'OPEN' ? r.capacityPerDay : r.status === 'RESTRICTED' ? Math.round(r.capacityPerDay * 0.45) : 0,
      inUse: used,
      serials: conv.map(c => c.id),
      lengthKm: pathLength(r.path),
    };
  }

  convoyView(c) {
    const rt = this.routes.find(r => r.id === c.route);
    const pos = rt ? pointAlong(rt.path, c.progress) : [0, 0];
    const rtv = rt ? this.routeView(rt) : null;
    const speed = c.mode === 'air' ? 520 : c.mode === 'rail' ? 48 : c.mode === 'sea' ? 32 : 36;
    const remainKm = rtv ? rtv.lengthKm * (1 - c.progress) : 0;
    return {
      ...c, lat: pos[0], lng: pos[1],
      etaHours: speed > 0 ? remainKm / speed : 0,
      remainKm,
      status: rt && rt.status === 'CLOSED' ? 'RED' : rt && rt.status === 'RESTRICTED' ? 'AMBER' : 'GREEN',
      routeName: rt ? rt.name : '—',
    };
  }

  reserveView(v) {
    const at = this.nodes.find(n => n.id === v.at);
    const to = this.nodes.find(n => n.id === v.to);
    let lat = at ? at.lat : 0, lng = at ? at.lng : 0;
    if (v.state === 'moving' && at && to) {
      const p = v.progress || 0;
      lat = at.lat + (to.lat - at.lat) * p;
      lng = at.lng + (to.lng - at.lng) * p;
    } else if (v.state === 'delivered' && to) { lat = to.lat; lng = to.lng; }
    return {
      ...v, lat, lng,
      atName: at ? at.name : '—', toName: to ? to.name : '—',
      status: v.state === 'delivered' ? 'GREEN' : v.state === 'moving' ? 'AMBER' : 'GREEN',
      className: META.classes[v.cls]?.name || v.cls,
    };
  }

  // --- the non-contact picture -------------------------------------------

  standoff() {
    const own = this.assets.filter(a => a.rangeKm >= 60 && a.category !== 'Air bases').map(a => {
      const v = this.assetView(a);
      const reaches = OPPOSING.nodes.concat(OPPOSING.assets)
        .filter(t => distKm(a.lat, a.lng, t.lat, t.lng) <= a.rangeKm).length;
      return {
        id: a.id, name: a.name, category: a.category, rangeKm: a.rangeKm,
        held: a.held, serviceable: a.serviceable, daysOfFire: v.daysOfFire,
        status: v.status, reaches, ttpMin: a.ttpMin, lat: a.lat, lng: a.lng,
        release: a.release,
      };
    }).sort((a, b) => b.rangeKm - a.rangeKm);

    const theirs = OPPOSING.assets.filter(a => a.rangeKm >= 60 && a.category !== 'Air bases').map(a => {
      const exposed = this.nodes.concat(this.assets)
        .filter(t => distKm(a.lat, a.lng, t.lat, t.lng) <= a.rangeKm);
      return {
        id: a.id, name: a.name, category: a.category, rangeKm: a.rangeKm,
        held: a.held, confidence: a.confidence, lat: a.lat, lng: a.lng,
        exposes: exposed.length,
        exposesNames: exposed.slice(0, 6).map(t => t.name),
      };
    }).sort((a, b) => b.rangeKm - a.rangeKm);

    // Which of our locations sit under their reach, and by how many systems.
    const exposure = this.nodes.map(n => {
      const by = OPPOSING.assets.filter(a => a.rangeKm > 0 && distKm(a.lat, a.lng, n.lat, n.lng) <= a.rangeKm);
      const deepest = by.reduce((m, a) => Math.max(m, a.rangeKm - distKm(a.lat, a.lng, n.lat, n.lng)), 0);
      return {
        kind: 'node', id: n.id, name: n.name, lat: n.lat, lng: n.lng,
        systems: by.length, depthKm: Math.round(deepest),
        by: by.map(a => ({ id: a.id, name: a.name, rangeKm: a.rangeKm })),
        status: by.length >= 3 ? 'RED' : by.length >= 1 ? 'AMBER' : 'GREEN',
        holds: Math.round(this.nodeFill(n) * 100),
      };
    }).filter(e => e.systems > 0).sort((a, b) => b.systems - a.systems || b.depthKm - a.depthKm);

    return {
      own, theirs, exposure,
      summary: {
        ourLongest: own.length ? own[0].rangeKm : 0,
        theirLongest: theirs.length ? theirs[0].rangeKm : 0,
        ourSystems: own.length,
        theirSystems: theirs.length,
        locationsExposed: exposure.length,
        locationsExposedRed: exposure.filter(e => e.status === 'RED').length,
        guidedDaysOfFire: Math.min(...own.filter(o => o.daysOfFire != null).map(o => o.daysOfFire), 99),
      },
    };
  }

  // --- history, events, missions -----------------------------------------

  seedHistory() {
    const r = rng(77002);
    const out = [];
    const hours = 72;
    for (let h = hours; h >= 0; h--) {
      const t = this.simTime - h * 3600 * 1000;
      const drift = 1 + (h / hours) * 0.16;
      const dos = {}, fwd = {};
      const baseDos = this.daysOfSupply(this.selectedScenario, false);
      const baseFwd = this.daysOfSupply(this.selectedScenario, true);
      for (const c of CLASS_IDS) {
        dos[c] = baseDos[c] * drift * (0.97 + r() * 0.06);
        fwd[c] = baseFwd[c] * drift * (0.95 + r() * 0.1);
      }
      const nodeFill = {}, unitFill = {};
      for (const n of this.nodes) nodeFill[n.id] = clamp(this.nodeFill(n) * drift * (0.97 + r() * 0.06), 0, 1.05);
      for (const u of this.units) unitFill[u.id] = clamp(u.strength * (0.98 + r() * 0.03), 0, 1);
      out.push({ t: new Date(t).toISOString(), dos, fwd, nodeFill, unitFill });
    }
    return out;
  }

  seedEvents() {
    const base = this.simTime;
    const mk = (mins, level, text) => ({
      id: `e-${this.nextEventId++}`, t: new Date(base - mins * 60000).toISOString(), level, text,
    });
    this.events = [
      mk(4, 'ANALYSIS', 'Gujrat Forward Depot fill fell below 50 per cent; guided munitions limiting.'),
      mk(18, 'INFO', 'Rahim Axis reported closed — culvert failure at km 62.'),
      mk(26, 'DELIVERY', 'SERIAL 203 cleared Sukkur; 3 200 t fuel for Khalar.'),
      mk(41, 'ORDER', 'Bridging reserve released to Gujrat by chief engineer.'),
      mk(58, 'ANALYSIS', 'Assessed Pinaka Group moved 14 km west; Jhelum now inside its reach.'),
      mk(77, 'INFO', 'Main Line 2 under speed restriction, embankment scour.'),
      mk(96, 'DELIVERY', 'Bridging reserve delivered to Gujrat Forward Depot.'),
      mk(124, 'ANALYSIS', '9 Infantry Division fuel below seven days at the measured posture.'),
      mk(152, 'INFO', 'Shahin Battery B serviceability fell to 11 of 18.'),
      mk(181, 'ORDER', 'Measured posture set to Defend forward.'),
    ];
  }

  seedMissions() {
    return [
      {
        id: 'm-01', name: 'SHAHPAR 01', callsign: 'FALCON 21', state: 'airborne',
        asset: 'a-uav', sensor: 'EO', endurance: 9.4, elapsed: 3.2,
        target: { name: 'Assessed Pinaka Group', lat: 32.66, lng: 74.98, kind: 'oasset', id: 'oa-pin' },
        phase: 'on-station', leg: 3,
        route: [
          { name: 'Launch', lat: 31.10, lng: 72.10, phase: 'launch', minutes: 0 },
          { name: 'Transit 1', lat: 31.72, lng: 73.10, phase: 'transit', minutes: 48 },
          { name: 'Holding', lat: 32.20, lng: 74.10, phase: 'transit', minutes: 96 },
          { name: 'On station', lat: 32.60, lng: 74.82, phase: 'on-station', minutes: 132 },
          { name: 'Recovery', lat: 31.10, lng: 72.10, phase: 'recovery', minutes: 300 },
        ],
        detections: [
          { id: 'd-1', t: '2026-09-25T07:41:00Z', kind: 'vehicle', label: 'Wheeled launcher, revetted', conf: 0.82, lat: 32.661, lng: 74.979, status: 'new' },
          { id: 'd-2', t: '2026-09-25T07:48:00Z', kind: 'vehicle', label: 'Resupply vehicle x3', conf: 0.66, lat: 32.658, lng: 74.991, status: 'new' },
          { id: 'd-3', t: '2026-09-25T08:02:00Z', kind: 'structure', label: 'Camouflaged shelter', conf: 0.54, lat: 32.670, lng: 74.975, status: 'reviewed' },
          { id: 'd-4', t: '2026-09-25T08:19:00Z', kind: 'emission', label: 'Fire-control emitter, intermittent', conf: 0.71, lat: 32.664, lng: 74.968, status: 'new' },
        ],
      },
      {
        id: 'm-02', name: 'SHAHPAR 02', callsign: 'FALCON 22', state: 'ready',
        asset: 'a-uav', sensor: 'IR', endurance: 9.4, elapsed: 0,
        target: { name: 'Amritsar Forward Depot (assessed)', lat: 31.63, lng: 74.87, kind: 'onode', id: 'on-amr' },
        phase: 'ready', leg: 0,
        route: [
          { name: 'Launch', lat: 31.10, lng: 72.10, phase: 'launch', minutes: 0 },
          { name: 'Transit', lat: 31.40, lng: 73.50, phase: 'transit', minutes: 54 },
          { name: 'On station', lat: 31.62, lng: 74.80, phase: 'on-station', minutes: 110 },
          { name: 'Recovery', lat: 31.10, lng: 72.10, phase: 'recovery', minutes: 280 },
        ],
        detections: [],
      },
    ];
  }

  // --- the tick -----------------------------------------------------------

  tick() {
    this.tickCount++;
    const step = META.tickSeconds * 1000 * this.speed;
    this.simTime += step;
    const t = this.tickCount;
    const r = rng(t * 7919);

    // Depots draw down against demand and take in what arrives.
    const demand = this.demandFor(this.selectedScenario);
    const hoursElapsed = (step / 3600000);
    for (const n of this.nodes) {
      for (const c of Object.keys(n.objective)) {
        const share = n.forward ? 0.09 : 0.055;
        let d = (demand[c] || 0) * share * (hoursElapsed / 24);
        if (n.produces) d -= (n.objective[c] * 0.0006) * (hoursElapsed / 24) * 24;
        n.stock[c] = Math.max(0, n.stock[c] - d);
      }
    }

    // Serials run, deliver and turn round.
    for (const c of this.convoys) {
      const rt = this.routes.find(x => x.id === c.route);
      if (!rt || rt.status === 'CLOSED') { c.state = 'held'; continue; }
      const rate = (c.mode === 'air' ? 0.020 : c.mode === 'rail' ? 0.006 : c.mode === 'sea' ? 0.004 : 0.005)
        * (rt.status === 'RESTRICTED' ? 0.45 : 1) * this.speed;
      c.state = 'moving';
      c.progress += rate;
      if (c.progress >= 1) {
        c.progress = 0;
        const dest = this.nodes.find(n => n.id === c.to);
        if (dest && dest.objective[c.cls] != null) {
          dest.stock[c.cls] = Math.min(dest.objective[c.cls] * 1.05, dest.stock[c.cls] + c.tonnes);
          this.log('DELIVERY', `${c.serial} delivered ${Math.round(c.tonnes)} t ${META.classes[c.cls].name.toLowerCase()} to ${dest.name}.`);
        }
      }
    }

    // Released reserves move and land.
    for (const v of this.reserves) {
      if (v.state !== 'moving') continue;
      v.progress = (v.progress || 0) + 0.004 * this.speed;
      if (v.progress >= 1) {
        v.state = 'delivered'; v.progress = 1;
        const dest = this.nodes.find(n => n.id === v.to);
        if (dest && dest.objective[v.cls] != null) {
          dest.stock[v.cls] = Math.min(dest.objective[v.cls] * 1.1, dest.stock[v.cls] + v.qty);
        }
        this.log('DELIVERY', `${v.name} delivered to ${dest ? dest.name : v.to}.`);
      }
    }

    // Formations consume their own first line; repair returns equipment.
    for (const u of this.units) {
      for (const c of Object.keys(u.holds)) {
        u.holds[c] = Math.max(0, u.holds[c] - 0.0016 * (POSTURE_DEMAND[this.selectedScenario] || 1) * this.speed);
      }
    }
    if (t % 40 === 0) {
      for (const a of this.assets) {
        if (a.serviceable < a.held && r() > 0.6) a.serviceable++;
        else if (a.serviceable > a.held * 0.4 && r() > 0.86) a.serviceable--;
      }
    }

    // Missions advance.
    for (const m of this.missions) {
      if (m.state !== 'airborne') continue;
      m.elapsed = Math.min(m.endurance, m.elapsed + (step / 3600000) * 6);
      const total = m.route[m.route.length - 1].minutes;
      const mins = (m.elapsed / m.endurance) * total;
      let leg = 0;
      for (let i = 0; i < m.route.length; i++) if (m.route[i].minutes <= mins) leg = i;
      m.leg = leg;
      m.phase = m.route[leg].phase;
    }

    // An hourly return lands on the history.
    if (t % 20 === 0) this.pushHistory();
    return this;
  }

  pushHistory() {
    const dos = this.daysOfSupply(this.selectedScenario, false);
    const fwd = this.daysOfSupply(this.selectedScenario, true);
    const nodeFill = {}, unitFill = {};
    for (const n of this.nodes) nodeFill[n.id] = this.nodeFill(n);
    for (const u of this.units) unitFill[u.id] = u.strength;
    this.history.push({ t: new Date(this.simTime).toISOString(), dos, fwd, nodeFill, unitFill });
    if (this.history.length > 240) this.history.shift();
  }

  log(level, text) {
    this.events.unshift({ id: `e-${this.nextEventId++}`, t: new Date(this.simTime).toISOString(), level, text });
    if (this.events.length > 120) this.events.pop();
  }

  // --- the payload --------------------------------------------------------

  snapshot() {
    const nodes = this.nodes.map(n => this.nodeView(n));
    const units = this.units.map(u => this.unitView(u));
    const assets = this.assets.map(a => this.assetView(a));
    const routes = this.routes.map(r => this.routeView(r));
    const convoys = this.convoys.map(c => this.convoyView(c));
    const reserves = this.reserves.map(v => this.reserveView(v));
    const gate = this.gate();
    const matrix = this.scenarioMatrix();
    const standoff = this.standoff();

    const issues = [];
    for (const n of nodes) if (n.status === 'RED' || n.status === 'BLACK')
      issues.push({ kind: 'node', id: n.id, name: n.name, status: n.status, text: `${n.name} holds ${Math.round(n.fill * 100)} per cent of objective; ${META.classes[n.lowestClass]?.short || ''} limiting.` });
    for (const u of units) if (u.status === 'RED' || u.status === 'BLACK')
      issues.push({ kind: 'unit', id: u.id, name: u.name, status: u.status, text: `${u.name} holds ${u.sustainableDays.toFixed(1)} days; ${META.classes[u.limitingClass]?.short || ''} limiting.` });
    for (const r of routes) if (r.status !== 'OPEN')
      issues.push({ kind: 'route', id: r.id, name: r.name, status: statusOfRoute(r.status), text: `${r.name} ${r.status.toLowerCase()}${r.note ? ' — ' + r.note : ''}` });
    for (const a of assets) if (a.status === 'RED' || a.status === 'BLACK')
      issues.push({ kind: 'asset', id: a.id, name: a.name, status: a.status, text: `${a.name}: ${a.serviceable} of ${a.held} serviceable${a.daysOfFire != null ? `, ${a.daysOfFire.toFixed(1)} days of fire` : ''}.` });

    const counts = {
      nodes: nodes.length, units: units.length, routes: routes.length,
      assets: assets.length, convoys: convoys.length, reserves: reserves.length,
      routesOpen: routes.filter(r => r.status === 'OPEN').length,
      routesClosed: routes.filter(r => r.status === 'CLOSED').length,
      reservesHeld: reserves.filter(v => v.state === 'held').length,
      reservesMoving: reserves.filter(v => v.state === 'moving').length,
      reservesDelivered: reserves.filter(v => v.state === 'delivered').length,
      oppAssets: OPPOSING.assets.length, oppNodes: OPPOSING.nodes.length, oppUnits: OPPOSING.units.length,
    };

    // What a release of everything held would buy.
    const potential = this.potential(gate);

    return {
      meta: { ...META, classes: META.classes },
      simTime: new Date(this.simTime).toISOString(),
      tick: this.tickCount,
      posture: (SCENARIOS.find(s => s.id === this.selectedScenario) || SCENARIOS[1]).name,
      scenarios: SCENARIOS.map(s => ({ ...s, requiredDays: s.required })),
      selectedScenario: this.selectedScenario,
      nodes, units, routes, convoys, reserves, assets,
      platforms: this.platforms(),
      fires: this.fires(),
      workshops: this.workshops.map(w => ({ ...w, status: w.throughput >= 0.7 ? 'GREEN' : w.throughput >= 0.5 ? 'AMBER' : 'RED' })),
      opposing: this.opposingView(),
      standoff,
      air: this.air(),
      engineeringPicture: this.engineeringPicture(),
      medical: this.medical(),
      movement: this.movement(routes, convoys),
      engineering: this.engineering(),
      personnel: this.personnel(units),
      fieldServices: this.fieldServices(),
      hostNation: this.hostNation(),
      demands: this.demands(),
      retrograde: this.retrograde(),
      history: this.history.slice(-120),
      events: this.events.slice(0, 60),
      missions: this.missions,
      clock: { speed: this.speed, tickSeconds: META.tickSeconds, stepMinutes: (META.tickSeconds * this.speed) / 60 },
      intent: this.intent,
      summary: {
        classes: gate.classes,
        forwardClasses: gate.classes.map(c => ({ ...c, days: c.forwardDays, status: c.forwardStatus })),
        echelons: this.echelons(nodes, units),
        gate,
        scenarioMatrix: matrix,
        issues: issues.slice(0, 24),
        potential,
        projection: this.projection(gate, false),
        forwardProjection: this.projection(gate, true),
        water: this.water(),
        reporting: this.reporting(nodes, units),
        readiness: this.readiness(units, assets),
        watchlist: issues.slice(0, 6).map(i => ({ ...i })),
        functions: this.functions(nodes, routes, assets, units),
        counts,
        liftBonus: this.liftBonus(routes),
      },
    };
  }

  platforms() {
    // Equipment fleets, rolled up from the systems that hold them.
    const byType = new Map();
    for (const a of this.assets) {
      const k = a.type;
      if (!byType.has(k)) byType.set(k, { id: `p-${k}`, name: labelForType(k), type: k, held: 0, serviceable: 0, systems: [] });
      const p = byType.get(k);
      p.held += a.held; p.serviceable += a.serviceable; p.systems.push({ id: a.id, name: a.name });
    }
    return [...byType.values()].map(p => {
      const s = p.held ? p.serviceable / p.held : 0;
      return {
        ...p, serviceability: s,
        awaitingRepair: Math.max(0, p.held - p.serviceable),
        status: s >= 0.9 ? 'GREEN' : s >= 0.75 ? 'AMBER' : s >= 0.5 ? 'RED' : 'BLACK',
      };
    }).sort((a, b) => b.held - a.held);
  }

  fires() {
    // Days of fire by nature — the question a gunner actually asks.
    const natures = [
      { id: 'f-rkt', name: 'Rocket, guided', cls: 'PGM', systems: ['a-sh1', 'a-sh2'] },
      { id: 'f-msl', name: 'Missile, strategic', cls: 'PGM', systems: ['a-nsr', 'a-btr'] },
      { id: 'f-sam', name: 'Surface-to-air', cls: 'PGM', systems: ['a-hq9', 'a-hq2', 'a-ad3'] },
      { id: 'f-tnk', name: 'Tank natures', cls: 'V', systems: ['a-arm', 'a-ar6', 'a-mec'] },
      { id: 'f-air', name: 'Air-delivered', cls: 'PGM', systems: ['a-ab1', 'a-ab2', 'a-ab3'] },
      { id: 'f-avn', name: 'Aviation natures', cls: 'PGM', systems: ['a-avn', 'a-uav'] },
    ];
    return natures.map(n => {
      const sys = n.systems.map(id => this.assets.find(a => a.id === id)).filter(Boolean);
      const held = sys.reduce((s, a) => s + (a.rounds[n.cls] || 0), 0);
      const perDay = sys.reduce((s, a) => s + (a.dayRate[n.cls] || 0), 0);
      const days = perDay > 0 ? held / perDay : null;
      const norm = META.classes[n.cls].norm;
      return {
        ...n, className: META.classes[n.cls].name, held, perDay, days, norm,
        lead: META.classes[n.cls].lead,
        status: days != null ? statusOfDos(days, n.cls) : 'GREEN',
        systems: sys.map(a => ({ id: a.id, name: a.name, held: a.rounds[n.cls] || 0 })),
      };
    });
  }

  opposingView() {
    const assets = OPPOSING.assets.map(a => ({ ...a, side: 'opp', status: 'HOSTILE' }));
    const nodes = OPPOSING.nodes.map(n => ({ ...n, side: 'opp', status: 'HOSTILE' }));
    const units = OPPOSING.units.map(u => ({ ...u, side: 'opp', status: 'HOSTILE' }));
    const routes = OPPOSING.routes.map(r => ({ ...r, side: 'opp', status: r.status, lengthKm: pathLength(r.path) }));
    const strike = units.filter(u => u.type === 'armour');
    return {
      meta: OPPOSING.meta, assets, nodes, units, routes,
      summary: {
        strikeCorps: strike.length,
        strikeCorpsName: strike.length ? strike[0].name : '—',
        fastestArmourHours: 26,
        longestReachKm: Math.max(...assets.map(a => a.rangeKm)),
        longestReachName: assets.slice().sort((a, b) => b.rangeKm - a.rangeKm)[0]?.name || '—',
        formations: units.length,
        systems: assets.length,
        depots: nodes.length,
        confidence: OPPOSING.meta.confidence,
        asOfHours: OPPOSING.meta.asOfHours,
        sustainmentDays: 18,
        sustainmentVerdict: 'MARGINAL',
      },
    };
  }

  air() {
    const bases = this.assets.filter(a => a.category === 'Air bases');
    const sorties = bases.reduce((s, b) => s + (b.sorties || 0), 0);
    const oppSorties = OPPOSING.assets.filter(a => a.category === 'Air bases').reduce((s, b) => s + (b.sorties || 0), 0);
    return {
      bases: bases.map(b => {
        const v = this.assetView(b);
        return {
          id: b.id, name: b.name, lat: b.lat, lng: b.lng,
          aircraft: b.held, serviceable: b.serviceable, sortiesPerDay: b.sorties,
          status: v.status, daysOfFire: v.daysOfFire, pgm: b.rounds.PGM || 0,
        };
      }),
      sortiesPerDay: sorties,
      theirSortiesPerDay: oppSorties,
      ratio: oppSorties > 0 ? sorties / oppSorties : 0,
      interceptorsHeld: this.assets.filter(a => a.category === 'Air defence').reduce((s, a) => s + (a.rounds.PGM || 0), 0),
      interceptorDays: (() => {
        const ad = this.assets.filter(a => a.category === 'Air defence');
        const held = ad.reduce((s, a) => s + (a.rounds.PGM || 0), 0);
        const rate = ad.reduce((s, a) => s + (a.dayRate.PGM || 0), 0);
        return rate > 0 ? held / rate : null;
      })(),
    };
  }

  engineeringPicture() {
    return {
      tasks: this.engineering().tasks,
      bridgingHeld: 14, bridgingCommitted: 6,
      gapsHeld: 3, routesUnderRepair: this.routes.filter(r => r.status !== 'OPEN').length,
    };
  }

  engineering() {
    const base = [
      { id: 'eg-1', name: 'Culvert repair, Rahim Axis km 62', route: 'r-rhm', priority: 1, daysToComplete: 2.5, effect: 'Reopens Rahim Axis, 1 400 t/day', status: 'AMBER', started: true },
      { id: 'eg-2', name: 'Chenab bridge second lane', route: 'r-gjr', priority: 2, daysToComplete: 6, effect: 'Gujrat Axis to full 1 800 t/day', status: 'RED', started: false },
      { id: 'eg-3', name: 'Embankment scour, Main Line 2', route: 'r-rail2', priority: 3, daysToComplete: 4, effect: 'Lifts speed restriction, +3 100 t/day', status: 'AMBER', started: true },
      { id: 'eg-4', name: 'Hardened shelter, Gujrat depot', route: null, priority: 4, daysToComplete: 9, effect: 'Reduces exposure of forward guided stock', status: 'GREEN', started: false },
    ].filter(t => !this.works.includes(t.id));
    return { tasks: base, completed: this.works.slice() };
  }

  medical() {
    return {
      beds: 1840, occupied: 412, holdingDays: 7,
      evacuationChain: [
        { level: 'Role 1', sites: 22, capacity: 440, status: 'GREEN' },
        { level: 'Role 2', sites: 8, capacity: 620, status: 'GREEN' },
        { level: 'Role 3', sites: 3, capacity: 780, status: 'AMBER' },
      ],
      bloodDays: 6.2, bloodNorm: 10, status: 'AMBER',
    };
  }

  movement(routes, convoys) {
    const lift = routes.reduce((s, r) => s + r.effectiveCapacity, 0);
    const committed = convoys.reduce((s, c) => s + c.tonnes, 0);
    return {
      liftPerDay: lift, committed,
      spare: Math.max(0, lift - committed),
      utilisation: lift > 0 ? committed / lift : 0,
      serialsMoving: convoys.filter(c => c.state === 'moving').length,
      serialsHeld: convoys.filter(c => c.state === 'held').length,
      status: lift > 0 && committed / lift > 0.9 ? 'RED' : committed / lift > 0.75 ? 'AMBER' : 'GREEN',
    };
  }

  personnel(units) {
    const estab = units.reduce((s, u) => s + u.estab, 0);
    const present = units.reduce((s, u) => s + Math.round(u.estab * u.strength), 0);
    return {
      establishment: estab, present,
      strength: estab > 0 ? present / estab : 0,
      casualties: units.reduce((s, u) => s + u.casualties, 0),
      replacements: 1840,
      status: present / estab >= 0.9 ? 'GREEN' : present / estab >= 0.82 ? 'AMBER' : 'RED',
    };
  }

  fieldServices() {
    return [
      { id: 'fs-1', name: 'Water production', figure: 1.42, unit: 'M l/day', norm: 1.6, status: 'AMBER' },
      { id: 'fs-2', name: 'Bakery', figure: 96, unit: 'k rations/day', norm: 90, status: 'GREEN' },
      { id: 'fs-3', name: 'Laundry and bath', figure: 68, unit: 'k persons/week', norm: 80, status: 'AMBER' },
      { id: 'fs-4', name: 'Mortuary affairs', figure: 4, unit: 'sites', norm: 4, status: 'GREEN' },
    ];
  }

  hostNation() {
    return {
      contractsLive: 34, valueMonthly: 2.4,
      transportHired: 620, transportNorm: 800,
      fuelLocal: 0.38, status: 'AMBER',
      note: 'Hired transport short by 180 vehicles against the counter-attack posture.',
    };
  }

  demands() {
    return [
      { id: 'dm-1', from: 'u-9inf', fromName: '9 Infantry Division', cls: 'III', qty: 620, raised: '2026-09-25T05:10:00Z', priority: 'IMMEDIATE', status: 'AMBER', met: 0.42 },
      { id: 'dm-2', from: 'u-4inf', fromName: '4 Infantry Division', cls: 'V', qty: 480, raised: '2026-09-25T04:20:00Z', priority: 'PRIORITY', status: 'GREEN', met: 0.88 },
      { id: 'dm-3', from: 'u-14inf', fromName: '14 Infantry Division', cls: 'PGM', qty: 64, raised: '2026-09-25T02:55:00Z', priority: 'IMMEDIATE', status: 'RED', met: 0.18 },
      { id: 'dm-4', from: 'u-52mec', fromName: '52 Mechanised Brigade', cls: 'IX', qty: 210, raised: '2026-09-24T22:40:00Z', priority: 'ROUTINE', status: 'GREEN', met: 0.94 },
      { id: 'dm-5', from: 'u-33mec', fromName: '33 Mechanised Brigade', cls: 'III', qty: 380, raised: '2026-09-24T20:05:00Z', priority: 'PRIORITY', status: 'AMBER', met: 0.61 },
    ];
  }

  retrograde() {
    return {
      awaitingBackload: 1240, backloadedWeek: 860,
      repairableForward: 214, beyondRepair: 68,
      status: 'AMBER',
    };
  }

  echelons(nodes, units) {
    const byEch = {};
    for (const n of nodes) {
      const k = n.echelon;
      byEch[k] = byEch[k] || { echelon: k, nodes: 0, fill: 0, units: 0, days: 0 };
      byEch[k].nodes++; byEch[k].fill += n.fill;
    }
    for (const u of units) {
      const k = u.echelon;
      byEch[k] = byEch[k] || { echelon: k, nodes: 0, fill: 0, units: 0, days: 0 };
      byEch[k].units++; byEch[k].days += u.sustainableDays;
    }
    return Object.values(byEch).map(e => ({
      ...e,
      fill: e.nodes ? e.fill / e.nodes : null,
      days: e.units ? e.days / e.units : null,
      status: e.nodes ? statusOfFill(e.fill / e.nodes) : 'GREEN',
    }));
  }

  potential(gate) {
    // What releasing everything held would buy, in days, by class.
    const demand = this.demandFor(this.selectedScenario);
    const held = {};
    for (const v of this.reserves) if (v.state === 'held') held[v.cls] = (held[v.cls] || 0) + v.qty;
    return gate.classes.map(c => {
      const add = (held[c.cls] || 0) / (demand[c.cls] || 1);
      return {
        cls: c.cls, short: c.short, name: c.name,
        now: c.days, potential: c.days + add, target: c.norm,
        gain: add, status: c.status,
      };
    });
  }

  projection(gate, forward) {
    // Share of today's holding remaining across the horizon, per class.
    const horizon = 30;
    return gate.classes.map(c => {
      const start = forward ? c.forwardDays : c.days;
      const series = [];
      for (let d = 0; d <= horizon; d++) series.push({ day: d, days: Math.max(0, start - d) });
      return { cls: c.cls, short: c.short, norm: c.norm, start, series, status: forward ? c.forwardStatus : c.status };
    });
  }

  water() {
    return { producedMl: 1.42, requiredMl: 1.6, status: 'AMBER', sites: 18, note: 'Two reverse-osmosis sets awaiting spares at Gujrat.' };
  }

  reporting(nodes, units) {
    const total = nodes.length + units.length;
    const late = 3;
    return {
      reporting: total - late, total, late,
      lastReturn: new Date(this.simTime - 42 * 60000).toISOString(),
      status: late === 0 ? 'GREEN' : late <= 3 ? 'AMBER' : 'RED',
      lateNames: ['14 Infantry Division', 'Rahim Forward Depot', '511 Forward Repair'],
    };
  }

  readiness(units, assets) {
    return units.map(u => {
      const assigned = assets.filter(a => a.control && a.control.includes(u.name.split(' ').slice(-2).join(' ')));
      return {
        id: u.id, name: u.name, echelon: u.echelon,
        strength: u.strength, strengthStatus: u.strengthStatus,
        days: u.sustainableDays, status: u.status,
        limitingClass: u.limitingClass,
        equipment: assigned.length ? assigned.reduce((s, a) => s + a.serviceable, 0) / assigned.reduce((s, a) => s + a.held, 0) : null,
      };
    });
  }

  functions(nodes, routes, assets, units) {
    const mk = (id, name, status, figure, note) => ({ id, name, status, figure, note });
    const mov = this.movement(routes, this.convoys.map(c => this.convoyView(c)));
    const per = this.personnel(units);
    const gate = this.gate();
    return [
      mk('supply', 'Supply', gate.classes.map(c => c.status).reduce((a, b) => worst(a, b), 'GREEN'),
        `${gate.sustainableDays.toFixed(1)} d`, `Limited by ${META.classes[gate.limitingClass]?.name.toLowerCase()}.`),
      mk('movement', 'Movement', mov.status, `${Math.round(mov.utilisation * 100)}%`, `${routes.filter(r => r.status !== 'OPEN').length} of ${routes.length} routes not fully open.`),
      mk('maintenance', 'Maintenance', this.workshops.some(w => w.throughput < 0.5) ? 'RED' : 'AMBER',
        `${Math.round(this.workshops.reduce((s, w) => s + w.throughput, 0) / this.workshops.length * 100)}%`, 'Forward repair is the constraint.'),
      mk('medical', 'Medical', this.medical().status, `${this.medical().bloodDays.toFixed(1)} d`, 'Blood products below norm.'),
      mk('personnel', 'Personnel', per.status, `${Math.round(per.strength * 100)}%`, `${per.casualties.toLocaleString('en')} against establishment.`),
      mk('infrastructure', 'Infrastructure', 'AMBER', `${this.engineering().tasks.length}`, 'Engineer tasks outstanding on two axes.'),
    ];
  }

  liftBonus(routes) {
    const closed = routes.filter(r => r.status === 'CLOSED');
    const restricted = routes.filter(r => r.status === 'RESTRICTED');
    return {
      lostToClosure: closed.reduce((s, r) => s + r.capacityPerDay, 0),
      lostToRestriction: restricted.reduce((s, r) => s + Math.round(r.capacityPerDay * 0.55), 0),
      recoverable: closed.concat(restricted).reduce((s, r) => s + Math.round(r.capacityPerDay * 0.7), 0),
      tasks: this.engineering().tasks.length,
    };
  }
}

// --- geometry -------------------------------------------------------------

export function distKm(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
export function pathLength(path) {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += distKm(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
  return d;
}
export function pointAlong(path, frac) {
  const total = pathLength(path);
  if (total === 0) return path[0];
  let target = total * Math.max(0, Math.min(1, frac)), run = 0;
  for (let i = 1; i < path.length; i++) {
    const seg = distKm(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
    if (run + seg >= target) {
      const t = seg === 0 ? 0 : (target - run) / seg;
      return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t];
    }
    run += seg;
  }
  return path[path.length - 1];
}
function labelForType(t) {
  return ({
    rocket: 'Rocket launchers', missile: 'Missile launchers', 'sam-long': 'Long-range SAM',
    'sam-med': 'Medium SAM', 'sam-short': 'Short-range SAM', jammer: 'Jamming sets',
    airfield: 'Combat aircraft', asm: 'Coastal launchers', tank: 'Main battle tanks',
    ifv: 'Infantry fighting vehicles', rotary: 'Rotary wing', uav: 'Unmanned aircraft',
  })[t] || t;
}
