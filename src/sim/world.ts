// World = terrain + game state + derived indices, with the player actions. The UI talks only to this class.

import { BUILDING_MAP, PORT_UPGRADE_MAP, ROAD_CLASSES, ZONE_CODES, ZONE_COST_PER_CELL, type BuildingDef, type ZoneId } from '../data/catalogue';
import { TECH_MAP, type TechBonus } from '../data/research';
import { SCENARIO_MAP, type Scenario } from '../data/scenarios';
import { MASK, type Terrain } from '../geo/terrain';
import { dateOf, formatDate } from './calendar';
import { Rng } from './rng';
import { BucketGrid, distPointPolyline, type OBB } from './spatial';
import type { Building, GameState, Notification, Policy, RoadSeg } from './types';
import { evaluatePlacement, type PlacementResult } from './placement';
import { planRoad, type RoadPlan } from './roads';
import { dredgeCost } from './placement';
import { evaluatePortSite, type PortSiteReport } from './port';

export type Listener = () => void;

export class World {
  readonly scenario: Scenario;
  rng: Rng;
  private bIndex = new BucketGrid(64);
  private rIndex = new BucketGrid(48);
  private byId = new Map<number, Building>();
  private listeners = new Set<Listener>();
  /** Bumped whenever anything changes, for React subscriptions and render invalidation. */
  version = 0;
  /** Bumped when buildings/roads/zones change (render geometry). */
  structureVersion = 0;
  zonesVersion = 0;
  vegetationVersion = 0;
  roadComponents = new Map<number, number>(); // road id -> component id
  hubComponents = new Set<number>();

  constructor(readonly terrain: Terrain, public state: GameState) {
    this.scenario = SCENARIO_MAP[state.scenario];
    this.rng = new Rng(state.rng);
    this.reindex();
  }

  // ------------------------------------------------------------ subscriptions
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(structure = false) {
    this.version++;
    if (structure) this.structureVersion++;
    this.state.rng = this.rng.state;
    for (const l of this.listeners) l();
  }

  // ------------------------------------------------------------ indices
  reindex() {
    this.bIndex.clear();
    this.rIndex.clear();
    this.byId.clear();
    for (const b of this.state.buildings) this.indexBuilding(b);
    for (const r of this.state.roads) this.indexRoad(r);
    this.computeRoadComponents();
  }

  private indexBuilding(b: Building) {
    this.byId.set(b.id, b);
    const o = this.obbOf(b);
    const r = Math.hypot(o.hw, o.hd);
    this.bIndex.insertRect(b.id, b.x - r, b.z - r, b.x + r, b.z + r);
  }

  private indexRoad(r: RoadSeg) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of r.pts) {
      x0 = Math.min(x0, x);
      z0 = Math.min(z0, z);
      x1 = Math.max(x1, x);
      z1 = Math.max(z1, z);
    }
    // insert per segment for tighter buckets
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i];
      const [bx, bz] = r.pts[i + 1];
      this.rIndex.insertRect(r.id, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
    }
  }

  def(b: Building | string): BuildingDef {
    return BUILDING_MAP[typeof b === 'string' ? b : b.type];
  }

  building(id: number): Building | undefined {
    return this.byId.get(id);
  }

  obbOf(b: { type: string; x: number; z: number; rot: number }): OBB {
    const d = BUILDING_MAP[b.type];
    return { x: b.x, z: b.z, hw: d.size[0] / 2, hd: d.size[1] / 2, rot: b.rot };
  }

  buildingsNear(x: number, z: number, r: number): Building[] {
    const ids = this.bIndex.query(x - r, z - r, x + r, z + r);
    const out: Building[] = [];
    for (const id of ids) {
      const b = this.byId.get(id);
      if (b && Math.hypot(b.x - x, b.z - z) <= r + 1e-6) out.push(b);
    }
    return out;
  }

  buildingCandidates(x0: number, z0: number, x1: number, z1: number): Building[] {
    const out: Building[] = [];
    for (const id of this.bIndex.query(x0, z0, x1, z1)) {
      const b = this.byId.get(id);
      if (b) out.push(b);
    }
    return out;
  }

  roadsNear(x: number, z: number, r: number): RoadSeg[] {
    const ids = this.rIndex.query(x - r, z - r, x + r, z + r);
    const out: RoadSeg[] = [];
    for (const r0 of this.state.roads) if (ids.has(r0.id)) out.push(r0);
    return out;
  }

  /** Distance to the nearest road (any status) and that road. */
  nearestRoad(x: number, z: number, r = 200, activeOnly = false): { road: RoadSeg | null; dist: number } {
    let best: RoadSeg | null = null;
    let bd = Infinity;
    for (const rd of this.roadsNear(x, z, r)) {
      if (activeOnly && rd.status !== 'active') continue;
      const d = distPointPolyline(x, z, rd.pts);
      if (d < bd) {
        bd = d;
        best = rd;
      }
    }
    return { road: best, dist: bd };
  }

  /** Union-find over active roads: two roads join if an end of one lies within 14 m of the other. */
  computeRoadComponents() {
    const roads = this.state.roads.filter((r) => r.status === 'active');
    const parent = new Map<number, number>();
    const find = (a: number): number => {
      let p = parent.get(a)!;
      while (p !== parent.get(p)) p = parent.get(p)!;
      parent.set(a, p);
      return p;
    };
    for (const r of roads) parent.set(r.id, r.id);
    for (const r of roads) {
      for (const end of [r.pts[0], r.pts[r.pts.length - 1]]) {
        for (const o of this.roadsNear(end[0], end[1], 16)) {
          if (o.id === r.id || o.status !== 'active') continue;
          if (distPointPolyline(end[0], end[1], o.pts) < 14) {
            const a = find(r.id);
            const b = find(o.id);
            if (a !== b) parent.set(a, b);
          }
        }
      }
    }
    this.roadComponents.clear();
    for (const r of roads) this.roadComponents.set(r.id, find(r.id));
    // hubs: components touching a port or the town hall (or the largest component when there is neither)
    this.hubComponents.clear();
    for (const b of this.state.buildings) {
      const d = this.def(b);
      if (b.status === 'construction' || !(d.port || d.id === 'town_hall')) continue;
      const near = this.accessRoad(b);
      if (near) this.hubComponents.add(this.roadComponents.get(near.id)!);
    }
    if (this.hubComponents.size === 0 && roads.length) {
      const sizes = new Map<number, number>();
      for (const r of roads) sizes.set(this.roadComponents.get(r.id)!, (sizes.get(this.roadComponents.get(r.id)!) ?? 0) + r.length);
      let best = -1, bl = -1;
      for (const [c, l] of sizes) if (l > bl) (bl = l), (best = c);
      this.hubComponents.add(best);
    }
  }

  /** Access distance for a building: half its diagonal plus a driveway. */
  accessReach(b: { type: string }): number {
    const d = BUILDING_MAP[b.type];
    return Math.hypot(d.size[0], d.size[1]) / 2 + (d.site === 'sea' ? 400 : 45);
  }

  accessRoad(b: Building): RoadSeg | null {
    const reach = this.accessReach(b);
    const { road, dist } = this.nearestRoad(b.x, b.z, reach + 10, true);
    return road && dist <= reach ? road : null;
  }

  /** 'hub' = road network reaching a port/town hall, 'local' = some road, 'none'. */
  roadStatus(b: Building): 'hub' | 'local' | 'none' {
    const d = this.def(b);
    if (d.site === 'sea') {
      // fish farms are reached by boat from any port or harbour
      return this.ports().some((p) => p.status === 'active') || this.roadStatusNearShore(b) ? 'hub' : 'local';
    }
    const r = this.accessRoad(b);
    if (!r) return 'none';
    return this.hubComponents.has(this.roadComponents.get(r.id)!) ? 'hub' : 'local';
  }

  private roadStatusNearShore(b: Building): boolean {
    return this.nearestRoad(b.x, b.z, 600, true).dist < 600;
  }

  ports(): Building[] {
    return this.state.buildings.filter((b) => !!this.def(b).port);
  }

  activePorts(): Building[] {
    return this.ports().filter((b) => b.status === 'active');
  }

  maxPortTier(): number {
    let t = 0;
    for (const p of this.activePorts()) t = Math.max(t, this.def(p).port!.tier);
    return t;
  }

  // ------------------------------------------------------------ research helpers
  hasTech(id: string): boolean {
    return this.state.research.completed.includes(id);
  }

  techBonus(k: TechBonus): number {
    let v = 0;
    for (const id of this.state.research.completed) v += TECH_MAP[id]?.bonus?.[k] ?? 0;
    return v;
  }

  isUnlocked(def: BuildingDef): boolean {
    if (def.only && !def.only.includes(this.state.scenario)) return false;
    if (def.id === 'heritage_restoration' && !this.scenario.landmark) return false;
    return !def.needs || this.hasTech(def.needs);
  }

  // ------------------------------------------------------------ notifications
  notify(kind: Notification['kind'], title: string, text?: string, at?: [number, number]) {
    const n: Notification = { id: this.state.nextNote++, day: this.state.day, kind, title, text, at };
    this.state.notifications.unshift(n);
    if (this.state.notifications.length > 120) this.state.notifications.length = 120;
  }

  dateString(): string {
    return formatDate(this.state.day, this.state.startYear);
  }

  month(): number {
    return dateOf(this.state.day, this.state.startYear).month;
  }

  regionAt(x: number, z: number): number {
    let best = 0, bd = Infinity;
    for (const r of this.state.regions) {
      const d = Math.hypot(r.seed[0] - x, r.seed[1] - z);
      if (d < bd) (bd = d), (best = r.id);
    }
    return best;
  }

  lastMonth() {
    return this.state.history[this.state.history.length - 1];
  }

  /** Construction cost index: inflation and remoteness raise what everything costs. */
  costIndex(): number {
    const remote = 1 + (this.scenario.remoteness - 1) * 0.5 * Math.max(0.3, 1 - 0.2 * this.maxPortTier());
    return this.state.priceIndex * remote;
  }

  // ------------------------------------------------------------ actions: buildings
  evaluate(type: string, x: number, z: number, rot: number): PlacementResult {
    return evaluatePlacement(this, type, x, z, rot);
  }

  placeBuilding(type: string, x: number, z: number, rot: number, opts: { free?: boolean; owner?: Building['owner']; instant?: boolean; force?: boolean } = {}): { ok: boolean; building?: Building; error?: string } {
    const res = this.evaluate(type, opts.force ? x : x, z, rot);
    if (!opts.force && !res.ok) return { ok: false, error: res.errors[0] ?? 'Cannot build here' };
    const cost = opts.free ? 0 : res.cost;
    if (!opts.free && cost > this.state.treasury) return { ok: false, error: 'Not enough money in the treasury' };
    const def = this.def(type);
    const b: Building = {
      id: this.state.nextId++,
      type,
      x: res.snap ? res.snap.x : x,
      z: res.snap ? res.snap.z : z,
      rot: res.snap ? res.snap.rot : rot,
      style: this.styleFor(def, x, z),
      status: opts.instant ? 'active' : 'construction',
      progress: opts.instant ? 1 : 0,
      startDay: this.state.day,
      doneDay: opts.instant ? this.state.day : -1,
      condition: 1,
      owner: opts.owner ?? 'state',
      region: this.regionAt(x, z),
      cost,
      consultDays: res.consultDays || undefined,
    };
    if (def.port) {
      b.depth = res.port?.berthDepth ?? def.port.minDepth;
      b.shelter = res.port?.shelter ?? 0.5;
      b.upgrades = {};
      b.pending = [];
      if (res.port && res.port.dredgeStages > 0) b.upgrades.dredging = 0; // dredging included in the price
      if (res.port && res.port.dredgeStages > 0) b.depth = Math.max(b.depth, def.port.minDepth);
    }
    if (!opts.free) {
      this.state.treasury -= cost;
      this.state.monthAcc.constructionSpend += cost * 0.3;
    }
    this.state.buildings.push(b);
    this.indexBuilding(b);
    this.clearVegetation(b);
    if (!opts.free || b.owner === 'private') {
      if (def.landImpact || res.landDamage) this.state.env.quality = Math.max(0, this.state.env.quality - (def.landImpact ?? 0) * 0.3 - res.landDamage);
      if (res.envDamage) this.state.env.marine = Math.max(0, this.state.env.marine - res.envDamage);
      if (res.landDamage) this.state.reputation = Math.max(0, this.state.reputation - 0.5);
    }
    if (b.status === 'active' && !opts.instant) this.computeRoadComponents();
    this.emit(true);
    return { ok: true, building: b };
  }

  styleFor(def: BuildingDef, x: number, z: number) {
    if (def.cat === 'industrial' && !['olive_grove', 'vineyard', 'fruit_plantation', 'sheep_farm', 'farm'].includes(def.id)) return 'industrial';
    if (def.cat === 'utility' || def.cat === 'port' || def.cat === 'transport') return 'industrial';
    if (['farm', 'sheep_farm'].includes(def.id)) return 'rural';
    if (def.id === 'tower' || def.id === 'offices') return this.state.policy.style === 'futuristic' ? 'futuristic' : 'highrise';
    const reg = this.state.regions[this.regionAt(x, z)];
    return reg?.style ?? this.state.policy.style;
  }

  clearVegetation(b: Building) {
    const t = this.terrain;
    const o = this.obbOf(b);
    const r = Math.hypot(o.hw, o.hd) + 6;
    const [fx0, fy0] = t.toGrid(b.x - r, b.z - r);
    const [fx1, fy1] = t.toGrid(b.x + r, b.z + r);
    for (let j = Math.max(0, Math.floor(fy0)); j <= Math.min(t.H - 1, Math.ceil(fy1)); j++) {
      for (let i = Math.max(0, Math.floor(fx0)); i <= Math.min(t.W - 1, Math.ceil(fx1)); i++) {
        const [wx, wz] = t.toWorld(i, j);
        const [lx, lz] = [(wx - b.x) * Math.cos(b.rot) - (wz - b.z) * Math.sin(b.rot), (wx - b.x) * Math.sin(b.rot) + (wz - b.z) * Math.cos(b.rot)];
        if (Math.abs(lx) <= o.hw + t.cell * 0.6 && Math.abs(lz) <= o.hd + t.cell * 0.6) {
          const k = j * t.W + i;
          if (!this.state.cleared[k]) {
            this.state.cleared[k] = 1;
            if (t.mask[k] & MASK.forest) this.state.env.forestLost++;
          }
        }
      }
    }
    this.vegetationVersion++;
  }

  bulldoze(id: number): { ok: boolean; refund: number; error?: string } {
    const b = this.byId.get(id);
    if (!b) return { ok: false, refund: 0, error: 'No such building' };
    const refund = b.status === 'construction' ? Math.round(b.cost * (1 - b.progress) * 0.5) : 0;
    this.state.treasury += refund;
    this.state.buildings = this.state.buildings.filter((x) => x.id !== id);
    this.reindex();
    this.emit(true);
    return { ok: true, refund };
  }

  /** Restore damaged buildings to full condition. */
  repairCost(b: Building): number {
    return Math.round(this.def(b).cost * (1 - b.condition) * 0.6 * this.costIndex());
  }

  repair(id: number): boolean {
    const b = this.byId.get(id);
    if (!b || b.condition >= 0.999) return false;
    const c = this.repairCost(b);
    if (c > this.state.treasury) return false;
    this.state.treasury -= c;
    this.state.monthAcc.constructionSpend += c;
    b.condition = 1;
    if (b.status === 'damaged') b.status = 'active';
    this.emit(true);
    return true;
  }

  // ------------------------------------------------------------ ports
  portSite(x: number, z: number, type = 'commercial_port'): PortSiteReport | null {
    return evaluatePortSite(this, x, z, type);
  }

  portUpgradeCost(port: Building, upg: string): number {
    const u = PORT_UPGRADE_MAP[upg];
    const def = this.def(port);
    let c = u.cost;
    if (upg === 'breakwater') c *= 0.6 + (1 - (port.shelter ?? 0.5)) * 1.2 * (this.hasTech('harbour_eng') ? 0.8 : 1);
    if (upg === 'dredging') c = dredgeCost(this, def, 1, (this.terrain.flagsAt(port.x, port.z) & MASK.reef) !== 0);
    if (upg === 'quay') c *= 0.5 + def.port!.tier * 0.5;
    if (upg === 'road_link') {
      const plan = this.portRoadLinkPlan(port);
      return plan ? plan.cost : Infinity;
    }
    return Math.round(c * this.costIndex());
  }

  portRoadLinkPlan(port: Building): RoadPlan | null {
    // nearest active road point within 3 km
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (const r of this.state.roads) {
      for (const p of r.pts) {
        const d = Math.hypot(p[0] - port.x, p[1] - port.z);
        if (d < bd) (bd = d), (best = p);
      }
    }
    if (!best || bd > 6000) return null;
    const def = this.def(port);
    // start from the landward edge of the port
    const lx = port.x - Math.sin(port.rot) * def.size[1] * 0.45;
    const lz = port.z - Math.cos(port.rot) * def.size[1] * 0.45;
    const plan = planRoad(this, 'road', [lx, lz], best, { ignoreBuildings: [port.id] });
    return plan.ok ? plan : planRoad(this, 'track', [lx, lz], best, { ignoreBuildings: [port.id] });
  }

  startPortUpgrade(portId: number, upg: string): { ok: boolean; error?: string } {
    const port = this.byId.get(portId);
    if (!port || !this.def(port).port) return { ok: false, error: 'Not a port' };
    const u = PORT_UPGRADE_MAP[upg];
    if (u.needs && !this.hasTech(u.needs)) return { ok: false, error: `Needs research: ${TECH_MAP[u.needs].name}` };
    if (u.minTier && this.def(port).port!.tier < u.minTier) return { ok: false, error: 'Port too small' };
    const done = (port.upgrades?.[upg] ?? 0) + (port.pending?.filter((p) => p.id === upg).length ?? 0);
    if (done >= (u.repeatable ?? 1)) return { ok: false, error: 'Already built' };
    if (upg === 'road_link') {
      const plan = this.portRoadLinkPlan(port);
      if (!plan) return { ok: false, error: 'No road within reach to link to' };
      const r = this.buildRoad(plan);
      if (!r.ok) return r;
      port.upgrades = { ...port.upgrades, road_link: 1 };
      this.emit(true);
      return { ok: true };
    }
    const cost = this.portUpgradeCost(port, upg);
    if (cost > this.state.treasury) return { ok: false, error: 'Not enough money' };
    this.state.treasury -= cost;
    this.state.monthAcc.constructionSpend += cost * 0.3;
    port.pending = [...(port.pending ?? []), { id: upg, progress: 0, days: u.days }];
    if (upg === 'dredging') {
      const reef = this.terrain.flagsAt(port.x, port.z) & MASK.reef || this.terrain.coastDistAt(port.x, port.z) < 800 && this.scenario.id === 'moorea';
      this.state.env.marine = Math.max(0, this.state.env.marine - (reef ? 6 : 2.5));
      this.notify('warn', 'Dredging started', reef ? 'Dredging near the reef is damaging coral and stirring up sediment.' : 'Sediment plumes will affect marine life for a while.', [port.x, port.z]);
    }
    this.emit(true);
    return { ok: true };
  }

  // ------------------------------------------------------------ roads
  planRoad(cls: RoadSeg['cls'], a: [number, number], b: [number, number]): RoadPlan {
    return planRoad(this, cls, a, b);
  }

  buildRoad(plan: RoadPlan): { ok: boolean; error?: string } {
    if (!plan.ok) return { ok: false, error: plan.reason };
    if (plan.cost > this.state.treasury) return { ok: false, error: 'Not enough money' };
    if (ROAD_CLASSES[plan.cls].needs && !this.hasTech(ROAD_CLASSES[plan.cls].needs!)) return { ok: false, error: 'Needs research' };
    this.state.treasury -= plan.cost;
    this.state.monthAcc.constructionSpend += plan.cost * 0.3;
    const r: RoadSeg = { id: this.state.nextId++, cls: plan.cls, pts: plan.pts, length: plan.length, progress: 0, status: 'construction', cost: plan.cost };
    this.state.roads.push(r);
    this.indexRoad(r);
    // clear trees along the road
    const t = this.terrain;
    for (const [x, z] of plan.pts) {
      const k = t.idx(x, z);
      if (!this.state.cleared[k]) {
        this.state.cleared[k] = 1;
        if (t.mask[k] & MASK.forest) this.state.env.forestLost += 0.5;
      }
    }
    this.vegetationVersion++;
    this.emit(true);
    return { ok: true };
  }

  removeRoad(id: number) {
    this.state.roads = this.state.roads.filter((r) => r.id !== id);
    this.reindex();
    this.emit(true);
  }

  // ------------------------------------------------------------ zones
  /** Paint (or clear with zone=null) a circular brush. Returns cells changed and the cost. */
  paintZone(zone: ZoneId | null, x: number, z: number, radius: number, dryRun = false): { cells: number; cost: number; rejected: number } {
    const t = this.terrain;
    const code = zone ? ZONE_CODES[zone] : 0;
    const [cx, cy] = t.toGrid(x, z);
    const rc = radius / t.cell;
    const slope = t.slopeGrid();
    let cells = 0, rejected = 0;
    for (let j = Math.floor(cy - rc); j <= Math.ceil(cy + rc); j++) {
      for (let i = Math.floor(cx - rc); i <= Math.ceil(cx + rc); i++) {
        if (i < 0 || j < 0 || i >= t.W || j >= t.H) continue;
        if ((i - cx) ** 2 + (j - cy) ** 2 > rc * rc) continue;
        const k = j * t.W + i;
        if (this.state.zones[k] === code) continue;
        if (code) {
          const m = t.mask[k];
          const strict = this.state.policy.environment === 'strict';
          if ((m & 3) !== MASK.territory || slope[k] > 14 || (strict && m & MASK.protected)) {
            rejected++;
            continue;
          }
        }
        cells++;
        if (!dryRun) this.state.zones[k] = code;
      }
    }
    const cost = code ? Math.round(cells * ZONE_COST_PER_CELL * this.state.priceIndex) : 0;
    if (!dryRun && cells) {
      this.state.treasury -= cost;
      this.zonesVersion++;
      this.emit();
    }
    return { cells, cost, rejected };
  }

  // ------------------------------------------------------------ policy, finance, research
  setPolicy(p: Partial<Policy>) {
    const prev = this.state.policy;
    this.state.policy = { ...prev, ...p, budget: { ...prev.budget, ...(p.budget ?? {}) } };
    this.emit();
  }

  borrowLimit(): number {
    const lm = this.lastMonth();
    const gdpAnnual = Math.max(lm?.gdpAnnual ?? 0, this.state.pop * 30000, 20_000_000);
    return Math.max(0, gdpAnnual * this.state.policy.maxDebtRatio - this.state.debt);
  }

  borrow(amount: number): boolean {
    const a = Math.min(amount, this.borrowLimit());
    if (a <= 0) return false;
    this.state.debt += a;
    this.state.treasury += a;
    this.notify('info', `Borrowed ${money(a)}`, `Public debt is now ${money(this.state.debt)}.`);
    this.emit();
    return true;
  }

  repay(amount: number): boolean {
    const a = Math.min(amount, this.state.debt, this.state.treasury);
    if (a <= 0) return false;
    this.state.debt -= a;
    this.state.treasury -= a;
    this.emit();
    return true;
  }

  setResearch(id: string | null) {
    if (id && !TECH_MAP[id]) return;
    if (id && TECH_MAP[id].prereq.some((p) => !this.hasTech(p))) return;
    if (id && this.hasTech(id)) return;
    if (this.state.research.current !== id) this.state.research.progress = 0;
    this.state.research.current = id;
    this.emit();
  }
}

export function money(v: number, digits = 1): string {
  const s = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(digits === 0 ? 0 : Math.max(0, digits - 1))}k`;
  return `${s}$${Math.round(a)}`;
}
