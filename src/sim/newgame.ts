// New game setup: starting state from a scenario and the real terrain (OSM roads, settlements, landmark).

import { BUILDING_MAP } from '../data/catalogue';
import { SCENARIO_MAP } from '../data/scenarios';
import { MASK, type Terrain } from '../geo/terrain';
import { generateCountries } from './diplomacy';
import { Rng, hashString } from './rng';
import { initialWeather } from './weather';
import { SAVE_VERSION, type FlagSpec, type GameState, type Region } from './types';
import { World } from './world';
import { monthlyUpdate } from './engine';

export interface NewGameOptions {
  scenario: string;
  nationName: string;
  flag: FlagSpec;
  motto?: string;
  seed?: number;
  tutorial?: boolean;
}

export function defaultPolicy(style: GameState['policy']['style']): GameState['policy'] {
  return {
    incomeTax: 0.2,
    corporateTax: 0.18,
    salesTax: 0.12,
    tourismTax: 0.05,
    propertyTax: 0.005,
    tariff: 0.06,
    budget: { education: 1, health: 1, safety: 1, infrastructure: 1, environment: 1, culture: 1 },
    housing: 'market',
    immigration: 'open',
    environment: 'balanced',
    energy: 'mixed',
    maxDebtRatio: 0.6,
    autoBorrow: true,
    style,
    regionFocus: -1,
  };
}

export function createGame(terrain: Terrain, o: NewGameOptions): World {
  const sc = SCENARIO_MAP[o.scenario];
  const seed = o.seed ?? hashString(`${o.nationName}|${o.scenario}|${Date.now()}`);
  const cells = terrain.W * terrain.H;
  let forest = 0;
  for (let k = 0; k < cells; k++) if (terrain.mask[k] & MASK.forest && (terrain.mask[k] & 3) === MASK.territory) forest++;
  if (forest === 0 && (sc.vegetation === 'rainforest' || sc.vegetation === 'tropical')) {
    // no mapped woodland: count the cells the vegetation model treats as forest (steep or high ground)
    const sg = terrain.slopeGrid();
    for (let k = 0; k < cells; k++) if ((terrain.mask[k] & 3) === MASK.territory && (sg[k] > 8 || terrain.real[k] > 60)) forest++;
  }
  const state: GameState = {
    version: SAVE_VERSION,
    seed,
    rng: seed ^ 0x9e3779b9,
    scenario: sc.id,
    nation: { name: o.nationName || sc.name, flag: o.flag, motto: o.motto ?? '', currency: 'dollar' },
    day: 0,
    startYear: 2031,
    treasury: sc.startFunds,
    debt: sc.startDebt,
    creditRating: 'A',
    buildings: [],
    roads: [],
    nextId: 1,
    zones: new Uint8Array(cells),
    cleared: new Uint8Array(cells),
    pop: sc.startPop,
    popFrac: 0,
    policy: defaultPolicy(sc.style),
    research: { completed: [], current: null, progress: 0, points: 0 },
    countries: generateCountries(seed, sc.id),
    reputation: 50,
    approval: 60,
    stability: 0.65,
    env: { quality: 85, marine: 88, pollution: 0, forestStart: Math.max(1, forest), forestLost: 0 },
    priceIndex: 1,
    wageLevel: sc.baseWage,
    rentIndex: 1,
    weather: initialWeather(sc.climate, 0),
    weatherHistory: { rain: 0, dryDays: 0, stormDays: 0, constructionLoss: 0 },
    monthAcc: { portClosedDays: 0, days: 0, windSum: 0, sunSum: 0, rainSum: 0, constructionSpend: 0, stormDays: 0, fogDays: 0 },
    history: [],
    regions: [],
    notifications: [],
    nextNote: 1,
    pendingEvents: [],
    eventLog: [],
    disasters: [],
    modifiers: [],
    objectives: {},
    surplusStreak: 0,
    exportsTotal: {},
    stats: { builtCount: 0, disasterCount: 0, touristsTotal: 0, peakPop: sc.startPop },
    tutorialStep: o.tutorial === false ? -1 : 0,
    scenarioComplete: false,
    lastAutosaveDay: 0,
    legacy: { power: 0, water: 0, jobs: 0 },
  };
  state.regions = makeRegions(terrain, sc.regionCount, sc.regionNames, seed, sc.regionAnchors);
  const w = new World(terrain, state);
  const rng = new Rng(seed);

  // real roads from OpenStreetMap become the starting network
  const keep = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'track', 'living_street', 'trunk']);
  for (const r of terrain.meta.osm.roads) {
    if (!keep.has(r.cls)) continue;
    const pts = r.pts.map((p) => terrain.osmToWorld(p));
    let len = 0;
    for (let i = 0; i + 1 < pts.length; i++) len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (len < terrain.cell * 0.8) continue;
    const cls = r.cls === 'track' ? 'track' : ['primary', 'secondary', 'trunk'].includes(r.cls) ? 'road' : 'road';
    state.roads.push({ id: state.nextId++, cls, pts, length: len, progress: 1, status: 'active', osm: true, cost: 0 });
  }
  w.reindex();

  // scenario starting buildings (snapped to the nearest valid site)
  for (const sb of sc.startBuildings) {
    const [x, z] = terrain.toWorld(sb.p[0], sb.p[1]);
    placeNear(w, sb.type, x, z, sb.rot ?? 0, rng);
  }
  // existing homes on real OSM building locations
  if (sc.startFromOsmHousing) {
    let housing = state.buildings.reduce((s, b) => s + (BUILDING_MAP[b.type].housing ?? 0), 0);
    const target = sc.startPop * 1.06;
    const pts = [...terrain.meta.osm.buildings];
    // spread evenly over the list (it is ordered spatially by OSM id, roughly)
    for (let i = pts.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [pts[i], pts[j]] = [pts[j], pts[i]];
    }
    for (const p of pts) {
      if (housing >= target) break;
      const [x, z] = terrain.osmToWorld(p);
      const type = housing < target * 0.6 && rng.chance(0.5) ? 'houses' : 'cottage';
      const near = w.nearestRoad(x, z, 120, true);
      let rot = rng.range(0, Math.PI);
      if (near.road) {
        const pp = near.road.pts;
        const a = pp[0], b = pp[pp.length - 1];
        rot = Math.atan2(b[0] - a[0], b[1] - a[1]);
      }
      const r = w.evaluate(type, x, z, rot);
      if (r.errors.some((e) => !e.startsWith('Costs') && !e.startsWith('Too steep'))) continue;
      const res = w.placeBuilding(type, x, z, rot, { free: true, instant: true, owner: 'community', force: true });
      if (res.building) housing += BUILDING_MAP[type].housing!;
    }
  }
  for (const b of state.buildings) {
    b.status = 'active';
    b.progress = 1;
    b.doneDay = 0;
    b.cost = 0;
    if (BUILDING_MAP[b.type].housing && b.owner === 'state') b.owner = 'community';
    if (BUILDING_MAP[b.type].port) b.upgrades = { utility_link: 1, road_link: 1 };
  }
  state.env.forestLost = 0;
  w.reindex();
  // estate tracks: give every starting building a free gravel track to the nearest road
  for (const b of [...state.buildings]) {
    const d = BUILDING_MAP[b.type];
    if (d.site === 'sea' || w.roadStatus(b) !== 'none') continue;
    const target = nearestRoadPoint(w, b.x, b.z);
    const from: [number, number] = [b.x + Math.sin(b.rot) * (d.size[1] / 2 + 6), b.z + Math.cos(b.rot) * (d.size[1] / 2 + 6)];
    if (!target) continue;
    const plan = w.planRoad('track', from, target);
    if (!plan.ok) continue;
    state.roads.push({ id: state.nextId++, cls: 'track', pts: plan.pts, length: plan.length, progress: 1, status: 'active', cost: 0 });
    w.reindex();
  }
  // the existing local economy: enough power, water and work for the people already living here
  {
    let pd = 0, ps = 0, wd = 0, ws = 0, jb = 0;
    for (const b of state.buildings) {
      const d = BUILDING_MAP[b.type];
      if ((d.power ?? 0) < 0) pd += -d.power!;
      if ((d.power ?? 0) > 0) ps += d.power! * (d.powerKind === 'diesel' ? 1 : 0.3);
      if ((d.water ?? 0) < 0) wd += -d.water!;
      if ((d.water ?? 0) > 0) ws += d.water! * (d.waterKind === 'well' ? sc.groundwater : 0.6);
      jb += d.jobs ?? 0;
    }
    state.legacy = {
      power: Math.max(0.02, pd * 1.2 - ps),
      water: Math.max(30, wd * 1.2 - ws),
      jobs: Math.max(0, sc.startPop * 0.64 * 0.74 * 0.96 - jb),
    };
  }
  // prime the economy so the first screen has numbers, without letting a month pass
  const snap = { pop: state.pop, treasury: state.treasury, debt: state.debt, priceIndex: state.priceIndex, approval: state.approval, stability: state.stability, env: { ...state.env }, research: { ...state.research }, rng: state.rng, reputation: state.reputation };
  monthlyUpdate(w);
  Object.assign(state, snap, { popFrac: 0, surplusStreak: 0, exportsTotal: {} });
  w.rng.state = snap.rng;
  state.buildings = state.buildings.filter((b) => b.owner !== 'private');
  w.reindex();
  state.history[0].explain.unshift(`Welcome to ${state.nation.name}. ${sc.tagline}`);
  state.notifications = [];
  state.pendingEvents = [];
  state.eventLog = [];
  state.modifiers = [];
  w.notify('info', `Welcome to ${state.nation.name}`, sc.intro);
  if (sc.ethics) w.notify('info', 'About this scenario', sc.ethics);
  w.emit(true);
  return w;
}

function nearestRoadPoint(w: World, x: number, z: number): [number, number] | null {
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (const r of w.state.roads) {
    for (const p of r.pts) {
      const d = Math.hypot(p[0] - x, p[1] - z);
      if (d < bd) (bd = d), (best = p);
    }
  }
  return best && bd < 4000 ? best : null;
}

function placeNear(w: World, type: string, x: number, z: number, rot: number, rng: Rng) {
  const def = BUILDING_MAP[type];
  for (let ring = 0; ring < 30; ring++) {
    const n = ring === 0 ? 1 : 10;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng.next() * 0.3;
      const r = ring * Math.max(12, def.size[0] * 0.5);
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const res = w.evaluate(type, px, pz, rot);
      const blocking = res.errors.filter((e) => !e.startsWith('Costs') && !e.startsWith('Only one'));
      if (!blocking.length) {
        w.placeBuilding(type, px, pz, rot, { free: true, instant: true, force: true });
        return;
      }
    }
  }
}

/** k-means regions over territory cells, named after the nearest OSM settlement. */
export function makeRegions(t: Terrain, k: number, fallback: string[], seed: number, anchors?: [number, number][]): Region[] {
  const rng = new Rng(seed ^ 0x1234567);
  const pts: [number, number][] = [];
  const step = Math.max(1, Math.floor(Math.sqrt((t.W * t.H) / 6000)));
  for (let j = 0; j < t.H; j += step) for (let i = 0; i < t.W; i += step) if ((t.mask[j * t.W + i] & 3) === MASK.territory) pts.push(t.toWorld(i, j));
  if (!pts.length) return [{ id: 0, name: fallback[0] ?? 'Island', seed: [0, 0], stats: { pop: 0, jobs: 0, gdp: 0, income: 0, landValue: 0, housing: 0, buildings: 0 } }];
  let centres: [number, number][] = [];
  if (anchors && anchors.length === k) centres = anchors.map((a) => t.toWorld(a[0], a[1]));
  else for (let i = 0; i < k; i++) centres.push(pts[Math.floor(((i + 0.5) / k) * pts.length)]);
  for (let it = 0; it < 12; it++) {
    const sum = centres.map(() => [0, 0, 0]);
    for (const p of pts) {
      let best = 0, bd = Infinity;
      centres.forEach((c, i) => {
        const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2;
        if (d < bd) (bd = d), (best = i);
      });
      sum[best][0] += p[0];
      sum[best][1] += p[1];
      sum[best][2]++;
    }
    centres = centres.map((c, i) => (sum[i][2] ? [sum[i][0] / sum[i][2], sum[i][1] / sum[i][2]] : pts[rng.int(0, pts.length - 1)]));
  }
  const settlements = t.meta.osm.places.filter((p) => ['town', 'village', 'hamlet', 'suburb'].includes(p.kind));
  const used = new Set<string>();
  if (anchors && anchors.length === k) {
    return centres.map((c, i) => ({ id: i, name: fallback[i] ?? `District ${i + 1}`, seed: c, stats: { pop: 0, jobs: 0, gdp: 0, income: 0, landValue: 0, housing: 0, buildings: 0 } }));
  }
  return centres.map((c, i) => {
    let name = '';
    let bd = Infinity;
    for (const p of settlements) {
      const [px, pz] = t.osmToWorld(p.p);
      if (!t.isTerritory(px, pz)) continue;
      const d = Math.hypot(px - c[0], pz - c[1]);
      if (d < bd && !used.has(p.name)) (bd = d), (name = p.name);
    }
    if (!name || bd > Math.max(t.widthM, t.depthM) / (k + 1)) name = fallback[i] ?? `District ${i + 1}`;
    used.add(name);
    return { id: i, name, seed: c, stats: { pop: 0, jobs: 0, gdp: 0, income: 0, landValue: 0, housing: 0, buildings: 0 } };
  });
}
