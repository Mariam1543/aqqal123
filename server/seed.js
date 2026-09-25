// The theatre. One deterministic seed; the simulation moves it, nothing else invents data.
// Geography sits inside the picture's graticule box (20-40N, 55-85E). Places are fictional.

export const META = {
  command: 'Northern Command',
  subtitle: 'sustainment picture',
  classification: 'EXERCISE — NOT FOR OPERATIONAL USE',
  fillThresholds: { green: 0.9, amber: 0.75, red: 0.5 },
  warReserveDays: 30,
  tickSeconds: 3,
  centre: [32.4, 72.6],
  // Supply classes. `norm` is the days-of-supply a class is judged against.
  classes: {
    I:   { name: 'Rations',            short: 'Rations', norm: 14, unit: 'd', lead: 3 },
    III: { name: 'Fuel',               short: 'Fuel',    norm: 10, unit: 'd', lead: 4 },
    V:   { name: 'Ammunition',         short: 'Ammo',    norm: 12, unit: 'd', lead: 7 },
    PGM: { name: 'Guided munitions',   short: 'Guided',  norm: 8,  unit: 'd', lead: 21 },
    IX:  { name: 'Spares',             short: 'Spares',  norm: 15, unit: 'd', lead: 12 },
    II:  { name: 'Clothing and stores', short: 'Stores', norm: 20, unit: 'd', lead: 9 },
    IV:  { name: 'Fortification',      short: 'Fort',    norm: 18, unit: 'd', lead: 10 },
    VIII:{ name: 'Medical',            short: 'Medical', norm: 16, unit: 'd', lead: 6 },
  },
};

// Planning postures. `required` is the endurance the posture demands of us.
export const SCENARIOS = [
  { id: 'hold',     name: 'Hold the line',        required: 7,  rung: 1, note: 'Current dispositions, no reinforcement.' },
  { id: 'defend',   name: 'Defend forward',       required: 14, rung: 2, note: 'Forward brigades in contact, depth held.' },
  { id: 'counter',  name: 'Counter-attack',       required: 21, rung: 3, note: 'Strike corps committed on one axis.' },
  { id: 'sustain',  name: 'Sustained operations', required: 30, rung: 4, note: 'Theatre-wide, both axes, no pause.' },
];

// Depots and installations. fill = proportion of objective stock held.
export const NODES = [
  { id: 'n-khl', name: 'Khalar Base Depot',    kind: 'base',     echelon: 'theatre', lat: 31.42, lng: 71.20, staff: 640, objective: { I: 9000, III: 14000, V: 11000, PGM: 900, IX: 6400, II: 5200, IV: 4100, VIII: 2600 }, fillSeed: 0.94 },
  { id: 'n-sar', name: 'Sargodh Field Depot',  kind: 'field',    echelon: 'corps',   lat: 32.08, lng: 72.68, staff: 380, objective: { I: 5200, III: 8600, V: 7400, PGM: 520, IX: 3300, II: 2800, IV: 2200, VIII: 1500 }, fillSeed: 0.81 },
  { id: 'n-jhl', name: 'Jhelum Forward Depot', kind: 'forward',  echelon: 'division', lat: 32.94, lng: 73.73, staff: 210, objective: { I: 2600, III: 4200, V: 4800, PGM: 340, IX: 1500, II: 1100, IV: 980, VIII: 720 }, fillSeed: 0.62, forward: true },
  { id: 'n-gjr', name: 'Gujrat Forward Depot', kind: 'forward',  echelon: 'division', lat: 32.57, lng: 74.08, staff: 195, objective: { I: 2400, III: 3900, V: 4500, PGM: 300, IX: 1400, II: 1000, IV: 900, VIII: 660 }, fillSeed: 0.48, forward: true },
  { id: 'n-mln', name: 'Multan Base Depot',    kind: 'base',     echelon: 'theatre', lat: 30.20, lng: 71.47, staff: 520, objective: { I: 7400, III: 11800, V: 9200, PGM: 760, IX: 5100, II: 4300, IV: 3400, VIII: 2100 }, fillSeed: 0.89 },
  { id: 'n-bhw', name: 'Bahawal Field Depot',  kind: 'field',    echelon: 'corps',   lat: 29.39, lng: 71.68, staff: 300, objective: { I: 4100, III: 6800, V: 5600, PGM: 410, IX: 2600, II: 2200, IV: 1700, VIII: 1200 }, fillSeed: 0.76 },
  { id: 'n-rhm', name: 'Rahim Forward Depot',  kind: 'forward',  echelon: 'division', lat: 28.42, lng: 70.30, staff: 160, objective: { I: 1900, III: 3100, V: 3400, PGM: 240, IX: 1100, II: 820, IV: 700, VIII: 520 }, fillSeed: 0.55, forward: true },
  { id: 'n-qta', name: 'Quetta Base Depot',    kind: 'base',     echelon: 'theatre', lat: 30.18, lng: 66.99, staff: 410, objective: { I: 5800, III: 9200, V: 6900, PGM: 520, IX: 3900, II: 3200, IV: 2600, VIII: 1700 }, fillSeed: 0.91 },
  { id: 'n-sib', name: 'Sibi Field Depot',     kind: 'field',    echelon: 'corps',   lat: 29.55, lng: 67.88, staff: 240, objective: { I: 3200, III: 5100, V: 4200, PGM: 300, IX: 2000, II: 1600, IV: 1300, VIII: 900 }, fillSeed: 0.68 },
  { id: 'n-kar', name: 'Karachi Port Depot',   kind: 'port',     echelon: 'theatre', lat: 24.86, lng: 67.01, staff: 720, objective: { I: 11000, III: 19000, V: 8400, PGM: 620, IX: 7200, II: 6100, IV: 4800, VIII: 3100 }, fillSeed: 0.96 },
  { id: 'n-pes', name: 'Peshawar Field Depot', kind: 'field',    echelon: 'corps',   lat: 34.01, lng: 71.58, staff: 330, objective: { I: 4600, III: 7300, V: 6100, PGM: 440, IX: 2900, II: 2400, IV: 1900, VIII: 1300 }, fillSeed: 0.84 },
  { id: 'n-skr', name: 'Sukkur Transit Depot', kind: 'transit',  echelon: 'corps',   lat: 27.70, lng: 68.86, staff: 180, objective: { I: 2800, III: 4600, V: 3200, PGM: 200, IX: 1600, II: 1300, IV: 1000, VIII: 740 }, fillSeed: 0.72 },
  { id: 'n-wrk', name: 'Wah Ordnance Works',   kind: 'works',    echelon: 'theatre', lat: 33.80, lng: 72.71, staff: 1400, objective: { V: 6200, PGM: 1100, IX: 3800 }, fillSeed: 0.87, produces: true },
];

// Formations. `strength` is present-for-duty against establishment.
export const UNITS = [
  { id: 'u-4inf',  name: '4 Infantry Division',   type: 'infantry',   echelon: 'division', lat: 32.86, lng: 73.95, strength: 0.93, estab: 14200, holds: { I: 11.2, III: 7.4, V: 9.1, PGM: 5.2, IX: 12.0 }, parent: 'n-jhl', posture: 'forward' },
  { id: 'u-9inf',  name: '9 Infantry Division',   type: 'infantry',   echelon: 'division', lat: 32.41, lng: 74.22, strength: 0.88, estab: 13800, holds: { I: 8.6, III: 5.1, V: 6.2, PGM: 3.1, IX: 9.4 }, parent: 'n-gjr', posture: 'forward' },
  { id: 'u-1arm',  name: '1 Armoured Division',   type: 'armour',     echelon: 'division', lat: 31.62, lng: 72.94, strength: 0.96, estab: 11600, holds: { I: 13.4, III: 9.8, V: 11.6, PGM: 7.4, IX: 14.2 }, parent: 'n-sar', posture: 'depth' },
  { id: 'u-6arm',  name: '6 Armoured Division',   type: 'armour',     echelon: 'division', lat: 30.88, lng: 71.94, strength: 0.91, estab: 11200, holds: { I: 12.1, III: 8.2, V: 10.4, PGM: 6.1, IX: 13.1 }, parent: 'n-mln', posture: 'depth' },
  { id: 'u-14inf', name: '14 Infantry Division',  type: 'infantry',   echelon: 'division', lat: 28.61, lng: 70.52, strength: 0.84, estab: 13100, holds: { I: 9.2, III: 6.0, V: 7.1, PGM: 2.8, IX: 10.2 }, parent: 'n-rhm', posture: 'forward' },
  { id: 'u-33mec', name: '33 Mechanised Brigade', type: 'mechanised', echelon: 'brigade',  lat: 31.98, lng: 73.42, strength: 0.90, estab: 4900, holds: { I: 10.8, III: 6.8, V: 8.4, PGM: 4.6, IX: 11.1 }, parent: 'n-sar', posture: 'forward' },
  { id: 'u-52mec', name: '52 Mechanised Brigade', type: 'mechanised', echelon: 'brigade',  lat: 29.98, lng: 70.88, strength: 0.86, estab: 4700, holds: { I: 9.4, III: 5.6, V: 7.0, PGM: 3.4, IX: 9.8 }, parent: 'n-bhw', posture: 'forward' },
  { id: 'u-12inf', name: '12 Infantry Division',  type: 'infantry',   echelon: 'division', lat: 34.12, lng: 72.04, strength: 0.89, estab: 13400, holds: { I: 12.6, III: 8.8, V: 9.8, PGM: 4.9, IX: 12.8 }, parent: 'n-pes', posture: 'depth' },
  { id: 'u-41inf', name: '41 Infantry Division',  type: 'infantry',   echelon: 'division', lat: 29.62, lng: 67.62, strength: 0.82, estab: 12900, holds: { I: 10.1, III: 7.2, V: 8.0, PGM: 3.6, IX: 10.6 }, parent: 'n-sib', posture: 'depth' },
  { id: 'u-3arm',  name: '3 Armoured Brigade',    type: 'armour',     echelon: 'brigade',  lat: 32.22, lng: 73.06, strength: 0.94, estab: 4400, holds: { I: 12.8, III: 9.1, V: 10.8, PGM: 6.8, IX: 13.6 }, parent: 'n-sar', posture: 'reserve' },
  { id: 'u-7avn',  name: '7 Aviation Brigade',    type: 'aviation',   echelon: 'brigade',  lat: 31.30, lng: 72.34, strength: 0.87, estab: 2600, holds: { I: 14.0, III: 6.2, V: 9.4, PGM: 4.2, IX: 8.9 }, parent: 'n-sar', posture: 'depth' },
  { id: 'u-21eng', name: '21 Engineer Group',     type: 'engineer',   echelon: 'brigade',  lat: 31.86, lng: 73.12, strength: 0.92, estab: 3800, holds: { I: 13.2, III: 8.0, V: 6.4, PGM: 0, IX: 11.8 }, parent: 'n-sar', posture: 'forward' },
];

// Weapon and effect systems. rangeKm drives the reach rings.
export const ASSETS = [
  { id: 'a-sh1', name: 'Shahin Battery A',    category: 'Fires',      type: 'rocket',    rangeKm: 120,  lat: 32.62, lng: 73.88, held: 18, serviceable: 16, ttpMin: 45,  rounds: { PGM: 96, V: 420 }, dayRate: { PGM: 12, V: 60 }, release: 'Corps commander', control: 'IV Corps' },
  { id: 'a-sh2', name: 'Shahin Battery B',    category: 'Fires',      type: 'rocket',    rangeKm: 120,  lat: 32.18, lng: 74.02, held: 18, serviceable: 11, ttpMin: 45,  rounds: { PGM: 54, V: 300 }, dayRate: { PGM: 12, V: 60 }, release: 'Corps commander', control: 'IV Corps' },
  { id: 'a-nsr', name: 'Nasr Missile Group',  category: 'Strategic missile forces', type: 'missile', rangeKm: 320, lat: 31.74, lng: 72.20, held: 9, serviceable: 9, ttpMin: 120, rounds: { PGM: 36 }, dayRate: { PGM: 4 }, release: 'National authority', control: 'Strategic Forces', strategic: true },
  { id: 'a-btr', name: 'Babur Flight',        category: 'Strategic missile forces', type: 'missile', rangeKm: 700, lat: 30.94, lng: 71.62, held: 6, serviceable: 5, ttpMin: 180, rounds: { PGM: 22 }, dayRate: { PGM: 2 }, release: 'National authority', control: 'Strategic Forces', strategic: true },
  { id: 'a-hq9', name: 'Kestrel AD Regiment', category: 'Air defence', type: 'sam-long', rangeKm: 125, altKm: 27, lat: 32.30, lng: 73.30, held: 12, serviceable: 10, ttpMin: 30, rounds: { PGM: 64 }, dayRate: { PGM: 16 }, release: 'Air defence commander', control: 'ADC North' },
  { id: 'a-hq2', name: 'Merlin AD Regiment',  category: 'Air defence', type: 'sam-med',  rangeKm: 45,  altKm: 12, lat: 31.20, lng: 72.60, held: 16, serviceable: 15, ttpMin: 20, rounds: { PGM: 88 }, dayRate: { PGM: 22 }, release: 'Air defence commander', control: 'ADC Centre' },
  { id: 'a-ad3', name: 'Falcon AD Battery',   category: 'Air defence', type: 'sam-short', rangeKm: 18, altKm: 6, lat: 29.72, lng: 70.64, held: 10, serviceable: 6, ttpMin: 15, rounds: { PGM: 40 }, dayRate: { PGM: 18 }, release: 'Air defence commander', control: 'ADC South' },
  { id: 'a-ew1', name: 'Ibex EW Company',     category: 'Electronic warfare', type: 'jammer', rangeKm: 60, altKm: 5, lat: 32.74, lng: 73.52, held: 6, serviceable: 5, ttpMin: 60, rounds: {}, dayRate: {}, release: 'Corps commander', control: 'IV Corps' },
  { id: 'a-ew2', name: 'Oryx EW Company',     category: 'Electronic warfare', type: 'jammer', rangeKm: 60, altKm: 5, lat: 29.90, lng: 70.92, held: 6, serviceable: 3, ttpMin: 60, rounds: {}, dayRate: {}, release: 'Corps commander', control: 'II Corps' },
  { id: 'a-ab1', name: 'Rafiqui Air Base',    category: 'Air bases',  type: 'airfield', rangeKm: 400, lat: 30.76, lng: 72.28, held: 42, serviceable: 36, ttpMin: 25, rounds: { PGM: 210, V: 640 }, dayRate: { PGM: 34, V: 90 }, release: 'Air component', control: 'Air Command', sorties: 62 },
  { id: 'a-ab2', name: 'Murid Air Base',      category: 'Air bases',  type: 'airfield', rangeKm: 400, lat: 32.91, lng: 72.77, held: 34, serviceable: 31, ttpMin: 25, rounds: { PGM: 180, V: 520 }, dayRate: { PGM: 28, V: 76 }, release: 'Air component', control: 'Air Command', sorties: 54 },
  { id: 'a-ab3', name: 'Shahbaz Air Base',    category: 'Air bases',  type: 'airfield', rangeKm: 400, lat: 28.28, lng: 68.45, held: 28, serviceable: 22, ttpMin: 25, rounds: { PGM: 140, V: 430 }, dayRate: { PGM: 22, V: 60 }, release: 'Air component', control: 'Air Command', sorties: 40 },
  { id: 'a-cst', name: 'Coastal Missile Bty', category: 'Coastal',    type: 'asm',      rangeKm: 280, lat: 25.02, lng: 66.60, held: 8, serviceable: 7, ttpMin: 90, rounds: { PGM: 28 }, dayRate: { PGM: 3 }, release: 'Naval component', control: 'Naval Command' },
  { id: 'a-arm', name: '1 Armd Regt Group',   category: 'Armour',     type: 'tank',     rangeKm: 0,  lat: 31.66, lng: 72.98, held: 124, serviceable: 112, ttpMin: 240, rounds: { V: 3400, III: 980 }, dayRate: { V: 420, III: 190 }, release: 'Formation commander', control: '1 Armd Div' },
  { id: 'a-ar6', name: '6 Armd Regt Group',   category: 'Armour',     type: 'tank',     rangeKm: 0,  lat: 30.92, lng: 71.98, held: 118, serviceable: 96, ttpMin: 240, rounds: { V: 3100, III: 900 }, dayRate: { V: 400, III: 180 }, release: 'Formation commander', control: '6 Armd Div' },
  { id: 'a-mec', name: '33 Mech Regt Group',  category: 'Mechanised', type: 'ifv',      rangeKm: 0,  lat: 32.02, lng: 73.46, held: 96, serviceable: 88, ttpMin: 180, rounds: { V: 2200, III: 640 }, dayRate: { V: 300, III: 130 }, release: 'Formation commander', control: '33 Mech Bde' },
  { id: 'a-avn', name: '7 Avn Rotary Wing',   category: 'Aviation',   type: 'rotary',   rangeKm: 140, lat: 31.32, lng: 72.36, held: 24, serviceable: 19, ttpMin: 40, rounds: { PGM: 72, V: 260 }, dayRate: { PGM: 14, V: 44 }, release: 'Corps commander', control: '7 Avn Bde' },
  { id: 'a-uav', name: 'Shahpar UAV Flight',  category: 'Aviation',   type: 'uav',      rangeKm: 210, lat: 31.10, lng: 72.10, held: 12, serviceable: 9, ttpMin: 55, rounds: { PGM: 30 }, dayRate: { PGM: 6 }, release: 'Corps commander', control: '7 Avn Bde' },
];

// Lines of communication.
export const ROUTES = [
  { id: 'r-n5',   name: 'N-5 Grand Trunk',        cls: 'MSR',  status: 'OPEN',       capacityPerDay: 5200, from: 'n-khl', to: 'n-sar', path: [[31.42,71.20],[31.72,71.86],[32.08,72.68]] },
  { id: 'r-n5b',  name: 'N-5 North',              cls: 'MSR',  status: 'OPEN',       capacityPerDay: 4400, from: 'n-sar', to: 'n-jhl', path: [[32.08,72.68],[32.52,73.16],[32.94,73.73]] },
  { id: 'r-gjr',  name: 'Gujrat Axis',            cls: 'ASR',  status: 'RESTRICTED', capacityPerDay: 1800, from: 'n-sar', to: 'n-gjr', path: [[32.08,72.68],[32.30,73.40],[32.57,74.08]], note: 'Bridge at Chenab on single lane since 23rd.' },
  { id: 'r-m5',   name: 'M-5 Motorway',           cls: 'MSR',  status: 'OPEN',       capacityPerDay: 6100, from: 'n-mln', to: 'n-khl', path: [[30.20,71.47],[30.80,71.30],[31.42,71.20]] },
  { id: 'r-bhw',  name: 'Bahawal Axis',           cls: 'ASR',  status: 'OPEN',       capacityPerDay: 2200, from: 'n-mln', to: 'n-bhw', path: [[30.20,71.47],[29.80,71.58],[29.39,71.68]] },
  { id: 'r-rhm',  name: 'Rahim Axis',             cls: 'ASR',  status: 'CLOSED',     capacityPerDay: 1400, from: 'n-bhw', to: 'n-rhm', path: [[29.39,71.68],[28.92,71.02],[28.42,70.30]], note: 'Culvert failure at km 62; engineer task raised.' },
  { id: 'r-rail', name: 'Main Line 1 (rail)',     cls: 'RAIL', status: 'OPEN',       capacityPerDay: 9800, from: 'n-kar', to: 'n-khl', path: [[24.86,67.01],[27.70,68.86],[29.39,71.68],[31.42,71.20]] },
  { id: 'r-rail2',name: 'Main Line 2 (rail)',     cls: 'RAIL', status: 'RESTRICTED', capacityPerDay: 5600, from: 'n-skr', to: 'n-qta', path: [[27.70,68.86],[28.60,68.10],[29.55,67.88],[30.18,66.99]], note: 'Speed restriction, embankment scour.' },
  { id: 'r-qta',  name: 'Quetta Axis',            cls: 'MSR',  status: 'OPEN',       capacityPerDay: 3200, from: 'n-qta', to: 'n-sib', path: [[30.18,66.99],[29.88,67.44],[29.55,67.88]] },
  { id: 'r-pes',  name: 'Peshawar Axis',          cls: 'MSR',  status: 'OPEN',       capacityPerDay: 3800, from: 'n-khl', to: 'n-pes', path: [[31.42,71.20],[32.70,71.40],[34.01,71.58]] },
  { id: 'r-air',  name: 'Air line of supply',     cls: 'ALOC', status: 'OPEN',       capacityPerDay: 420,  from: 'n-khl', to: 'n-jhl', path: [[31.42,71.20],[32.94,73.73]] },
  { id: 'r-sea',  name: 'Sea line of supply',     cls: 'SLOC', status: 'OPEN',       capacityPerDay: 14000, from: 'n-kar', to: 'n-kar', path: [[23.40,66.20],[24.20,66.70],[24.86,67.01]] },
  { id: 'r-pipe', name: 'Product pipeline',       cls: 'PIPE', status: 'OPEN',       capacityPerDay: 3600, from: 'n-kar', to: 'n-mln', path: [[24.86,67.01],[27.20,68.60],[29.20,70.40],[30.20,71.47]] },
  { id: 'r-skr',  name: 'Sukkur Link',            cls: 'ASR',  status: 'OPEN',       capacityPerDay: 1900, from: 'n-skr', to: 'n-bhw', path: [[27.70,68.86],[28.50,70.20],[29.39,71.68]] },
];

// Serials in motion.
export const CONVOYS = [
  { id: 'c-201', serial: 'SERIAL 201', mode: 'road', route: 'r-n5',   cls: 'III', tonnes: 840,  progress: 0.34, from: 'n-khl', to: 'n-sar' },
  { id: 'c-202', serial: 'SERIAL 202', mode: 'road', route: 'r-n5b',  cls: 'V',   tonnes: 620,  progress: 0.61, from: 'n-sar', to: 'n-jhl' },
  { id: 'c-203', serial: 'SERIAL 203', mode: 'rail', route: 'r-rail', cls: 'III', tonnes: 3200, progress: 0.48, from: 'n-kar', to: 'n-khl' },
  { id: 'c-204', serial: 'SERIAL 204', mode: 'road', route: 'r-bhw',  cls: 'I',   tonnes: 410,  progress: 0.22, from: 'n-mln', to: 'n-bhw' },
  { id: 'c-205', serial: 'SERIAL 205', mode: 'air',  route: 'r-air',  cls: 'PGM', tonnes: 46,   progress: 0.72, from: 'n-khl', to: 'n-jhl' },
  { id: 'c-206', serial: 'SERIAL 206', mode: 'sea',  route: 'r-sea',  cls: 'III', tonnes: 9400, progress: 0.55, from: 'n-kar', to: 'n-kar' },
  { id: 'c-207', serial: 'SERIAL 207', mode: 'road', route: 'r-qta',  cls: 'IX',  tonnes: 260,  progress: 0.41, from: 'n-qta', to: 'n-sib' },
  { id: 'c-208', serial: 'SERIAL 208', mode: 'rail', route: 'r-rail2',cls: 'V',   tonnes: 1800, progress: 0.29, from: 'n-skr', to: 'n-qta' },
];

// War reserve held back for release by decision.
export const RESERVES = [
  { id: 'v-01', name: 'Guided munition reserve', cls: 'PGM', qty: 220, at: 'n-khl', to: 'n-jhl', state: 'held',      effectHours: 14, returnsDays: 21, authority: 'Theatre commander' },
  { id: 'v-02', name: 'Fuel reserve (bulk)',     cls: 'III', qty: 4200, at: 'n-kar', to: 'n-mln', state: 'moving',   effectHours: 38, returnsDays: 30, authority: 'Theatre commander', progress: 0.44 },
  { id: 'v-03', name: 'Tank ammunition reserve', cls: 'V',   qty: 2600, at: 'n-mln', to: 'n-sar', state: 'held',      effectHours: 22, returnsDays: 28, authority: 'Theatre commander' },
  { id: 'v-04', name: 'Bridging reserve',        cls: 'IV',  qty: 14,   at: 'n-sar', to: 'n-gjr', state: 'delivered', effectHours: 0,  returnsDays: 45, authority: 'Chief engineer' },
  { id: 'v-05', name: 'Spares reserve',          cls: 'IX',  qty: 1800, at: 'n-khl', to: 'n-sar', state: 'held',      effectHours: 18, returnsDays: 35, authority: 'Theatre commander' },
  { id: 'v-06', name: 'Medical reserve',         cls: 'VIII',qty: 640,  at: 'n-mln', to: 'n-rhm', state: 'moving',   effectHours: 26, returnsDays: 20, authority: 'Surgeon',            progress: 0.18 },
  { id: 'v-07', name: 'Rations reserve',         cls: 'I',   qty: 3100, at: 'n-kar', to: 'n-skr', state: 'held',      effectHours: 30, returnsDays: 25, authority: 'Theatre commander' },
  { id: 'v-08', name: 'Interceptor reserve',     cls: 'PGM', qty: 96,   at: 'n-wrk', to: 'n-sar', state: 'held',      effectHours: 12, returnsDays: 40, authority: 'National authority' },
];

// Repair and recovery.
export const WORKSHOPS = [
  { id: 'w-01', name: '501 Central Workshop',  at: 'n-khl', lat: 31.38, lng: 71.26, capacityPerWeek: 84, inWork: 62, awaiting: 41, throughput: 0.74 },
  { id: 'w-02', name: '503 Field Workshop',    at: 'n-sar', lat: 32.04, lng: 72.72, capacityPerWeek: 46, inWork: 44, awaiting: 68, throughput: 0.52 },
  { id: 'w-03', name: '507 Field Workshop',    at: 'n-mln', lat: 30.16, lng: 71.52, capacityPerWeek: 52, inWork: 38, awaiting: 29, throughput: 0.81 },
  { id: 'w-04', name: '511 Forward Repair',    at: 'n-gjr', lat: 32.54, lng: 74.12, capacityPerWeek: 22, inWork: 21, awaiting: 47, throughput: 0.41 },
];

// The assessed opposing picture. Everything here is a snapshot, never a return.
export const OPPOSING = {
  meta: { command: 'Eastern Army', confidence: 'medium', asOfHours: 9, note: 'Assessed from all sources; holdings are estimates.' },
  assets: [
    { id: 'oa-br1', name: 'BrahMos Regiment (assessed)', category: 'Strategic missile forces', type: 'missile', rangeKm: 450, lat: 32.28, lng: 75.62, held: 8, confidence: 'high', control: 'Strategic' },
    { id: 'oa-pin', name: 'Pinaka Group (assessed)',     category: 'Fires',      type: 'rocket',  rangeKm: 75,  lat: 32.66, lng: 74.98, held: 16, confidence: 'high', control: 'XVI Corps' },
    { id: 'oa-sm1', name: 'Smerch Group (assessed)',     category: 'Fires',      type: 'rocket',  rangeKm: 90,  lat: 31.98, lng: 75.20, held: 12, confidence: 'medium', control: 'XI Corps' },
    { id: 'oa-s40', name: 'Long-range SAM (assessed)',   category: 'Air defence', type: 'sam-long', rangeKm: 250, altKm: 30, lat: 31.62, lng: 75.88, held: 6, confidence: 'medium', control: 'Western Air' },
    { id: 'oa-akh', name: 'Medium SAM (assessed)',       category: 'Air defence', type: 'sam-med', rangeKm: 70, altKm: 15, lat: 32.44, lng: 75.06, held: 10, confidence: 'high', control: 'Western Air' },
    { id: 'oa-ew',  name: 'EW Battalion (assessed)',     category: 'Electronic warfare', type: 'jammer', rangeKm: 80, altKm: 6, lat: 32.20, lng: 75.34, held: 5, confidence: 'low', control: 'XI Corps' },
    { id: 'oa-ab1', name: 'Adampur Air Base (assessed)', category: 'Air bases',  type: 'airfield', rangeKm: 420, lat: 31.43, lng: 75.76, held: 48, confidence: 'high', control: 'Western Air', sorties: 74 },
    { id: 'oa-ab2', name: 'Pathankot Air Base (assessed)', category: 'Air bases', type: 'airfield', rangeKm: 420, lat: 32.23, lng: 75.63, held: 32, confidence: 'high', control: 'Western Air', sorties: 48 },
    { id: 'oa-arm', name: 'Armoured Bde (assessed)',     category: 'Armour',     type: 'tank',    rangeKm: 0,  lat: 31.80, lng: 75.44, held: 110, confidence: 'medium', control: 'I Corps' },
  ],
  nodes: [
    { id: 'on-jal', name: 'Jalandhar Base Depot (assessed)', kind: 'base',    lat: 31.33, lng: 75.58, echelon: 'theatre', confidence: 'high' },
    { id: 'on-pth', name: 'Pathankot Field Depot (assessed)', kind: 'field',  lat: 32.27, lng: 75.65, echelon: 'corps',   confidence: 'medium' },
    { id: 'on-amr', name: 'Amritsar Forward Depot (assessed)', kind: 'forward', lat: 31.63, lng: 74.87, echelon: 'division', confidence: 'medium' },
    { id: 'on-bkn', name: 'Bikaner Field Depot (assessed)',   kind: 'field',  lat: 28.02, lng: 73.31, echelon: 'corps',   confidence: 'low' },
    { id: 'on-kan', name: 'Kandla Port (assessed)',           kind: 'port',   lat: 23.03, lng: 70.22, echelon: 'theatre', confidence: 'high' },
  ],
  units: [
    { id: 'ou-1str', name: 'I Strike Corps (assessed)',  type: 'armour',     echelon: 'corps',    lat: 31.84, lng: 75.40, strength: 0.92, confidence: 'medium' },
    { id: 'ou-11c',  name: 'XI Corps (assessed)',        type: 'infantry',   echelon: 'corps',    lat: 31.34, lng: 75.10, strength: 0.89, confidence: 'high' },
    { id: 'ou-16c',  name: 'XVI Corps (assessed)',       type: 'infantry',   echelon: 'corps',    lat: 32.72, lng: 74.86, strength: 0.86, confidence: 'high' },
    { id: 'ou-10c',  name: 'X Corps (assessed)',         type: 'mechanised', echelon: 'corps',    lat: 28.34, lng: 73.02, strength: 0.81, confidence: 'low' },
  ],
  routes: [
    { id: 'or-nh1', name: 'NH-44 (assessed)',  cls: 'MSR',  status: 'OPEN', capacityPerDay: 6200, path: [[31.33,75.58],[31.90,75.50],[32.27,75.65]] },
    { id: 'or-amr', name: 'Amritsar Axis (assessed)', cls: 'ASR', status: 'OPEN', capacityPerDay: 2400, path: [[31.33,75.58],[31.48,75.18],[31.63,74.87]] },
    { id: 'or-rail', name: 'Northern Railway (assessed)', cls: 'RAIL', status: 'OPEN', capacityPerDay: 8800, path: [[28.02,73.31],[29.60,74.40],[31.33,75.58]] },
  ],
};
