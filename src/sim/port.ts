// Port site analysis: shelter from the prevailing swell, slope, flat land, water depth, cost and
// environmental sensitivity, for any point on the player's coastline.

import { BUILDING_MAP } from '../data/catalogue';
import { MASK } from '../geo/terrain';
import { clamp } from './economy';
import { dredgeCost, portDepths, snapToCoast } from './placement';
import type { World } from './world';

export interface PortSiteReport {
  x: number;
  z: number;
  rot: number;
  name: string;
  shelter: number; // 0..1
  exposureDir: string; // worst exposed compass direction
  berthDepth: number; // real metres
  approachDepth: number;
  slope: number; // degrees, land behind the quay
  flatLand: number; // hectares of gentle land within 400 m
  sensitivity: number; // 0..1
  sensitivityNotes: string[];
  roadDistance: number; // game metres to nearest road
  costs: { type: string; name: string; total: number; dredgeStages: number; feasible: boolean; note: string }[];
  score: number; // 0..100
  scoreItems: { label: string; score: number; weight: number }[];
  buildable?: boolean;
  blockers?: string[];
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const PORT_TYPES = ['small_harbour', 'marina', 'commercial_port', 'cruise_terminal', 'container_port', 'deepwater_port'];

/** Fetch (open water distance) toward a compass bearing, in game metres, capped. */
function fetchToward(w: World, x: number, z: number, bearing: number, cap: number): number {
  const t = w.terrain;
  const dx = Math.sin(bearing);
  const dz = -Math.cos(bearing); // north is -z
  const step = Math.max(t.cell, 25);
  for (let d = step; d <= cap; d += step) {
    const px = x + dx * d;
    const pz = z + dz * d;
    if (!t.inBounds(px, pz)) return cap; // open sea beyond the map
    if (t.isLand(px, pz)) return d;
  }
  return cap;
}

export function evaluatePortSite(w: World, x: number, z: number, focusType = 'commercial_port'): PortSiteReport | null {
  const t = w.terrain;
  const c = snapToCoast(w, x, z, 220);
  if (!c) return null;
  const rot = Math.atan2(c.nx, c.nz);
  // shelter: sample 16 bearings from a point just offshore, weighting by how often the wind blows from each
  const ox = c.x + c.nx * 60;
  const oz = c.z + c.nz * 60;
  const cap = 9000 * t.hs; // game metres of fetch that already counts as fully exposed
  const freq = w.scenario.climate.windDir;
  let exposure = 0, worst = 0, worstDir = 0, wsum = 0;
  for (let k = 0; k < 16; k++) {
    const bearing = (k / 16) * Math.PI * 2;
    const f8 = (k / 2) % 8;
    const i0 = Math.floor(f8), i1 = (i0 + 1) % 8;
    const wf = freq[i0] * (1 - (f8 - i0)) + freq[i1] * (f8 - i0);
    const fe = fetchToward(w, ox, oz, bearing, cap) / cap;
    // swell from directions facing the site matters most
    const facing = Math.max(0, Math.sin(bearing) * c.nx + -Math.cos(bearing) * c.nz);
    const e = Math.sqrt(fe) * (0.35 + 0.65 * facing);
    exposure += e * (0.3 + wf * 8);
    wsum += 0.3 + wf * 8;
    if (e * wf > worst) (worst = e * wf), (worstDir = Math.round(k / 2) % 8);
  }
  const shelter = clamp(1 - exposure / wsum, 0, 1);
  // depths along the seaward normal
  const berthDepth = -t.realAt(c.x + c.nx * 70, c.z + c.nz * 70);
  let approach = Infinity;
  for (let d = 120; d <= 600; d += 40) approach = Math.min(approach, -t.realAt(c.x + c.nx * d, c.z + c.nz * d));
  // land behind the quay
  let slope = 0, n = 0;
  for (let d = 20; d <= 160; d += 35) {
    for (const side of [-40, 0, 40]) {
      const px = c.x - c.nx * d + c.nz * side;
      const pz = c.z - c.nz * d - c.nx * side;
      if (t.isTerritory(px, pz)) {
        slope += t.slopeAt(px, pz);
        n++;
      }
    }
  }
  slope = n ? slope / n : 30;
  const sg = t.slopeGrid();
  const [gx, gy] = t.toGrid(c.x, c.z);
  const rc = Math.ceil(400 / t.cell);
  let flat = 0, cells = 0, sens = 0, sensCells = 0;
  const notes = new Set<string>();
  for (let j = Math.floor(gy) - rc; j <= Math.ceil(gy) + rc; j++) {
    for (let i = Math.floor(gx) - rc; i <= Math.ceil(gx) + rc; i++) {
      if (i < 0 || j < 0 || i >= t.W || j >= t.H) continue;
      if ((i - gx) ** 2 + (j - gy) ** 2 > rc * rc) continue;
      const k = j * t.W + i;
      const m = t.mask[k];
      cells++;
      if ((m & 3) === MASK.territory && sg[k] < 6) flat++;
      if ((i - gx) ** 2 + (j - gy) ** 2 <= (rc * 0.75) ** 2) {
        let s = 0;
        if (m & MASK.reef) (s += w.scenario.id === 'moorea' ? 0.7 : 0.4), notes.add(w.scenario.id === 'moorea' ? 'coral reef / lagoon' : 'shallow seabed habitat');
        if (m & MASK.protected) (s += 0.35), notes.add('protected area');
        if (m & MASK.beach) (s += 0.3), notes.add('beach');
        if (m & MASK.community) (s += 0.5), notes.add('community land');
        if (m & MASK.forest && (m & 3) !== 0) (s += 0.2), notes.add('forest');
        sens += Math.min(1, s);
        sensCells++;
      }
    }
  }
  const flatHa = (flat * t.cell * t.cell) / 10000 / (t.hs * t.hs);
  const sensitivity = clamp(sens / Math.max(1, sensCells), 0, 1);
  const road = w.nearestRoad(c.x, c.z, 4000);
  const ci = w.costIndex();
  const reefHere = (t.flagsAt(c.x + c.nx * 40, c.z + c.nz * 40) & MASK.reef) !== 0;
  const protHere = (t.flagsAt(c.x - c.nx * 10, c.z - c.nz * 10) & MASK.protected) !== 0;
  const costs = PORT_TYPES.map((type) => {
    const d = BUILDING_MAP[type];
    const need = d.port!.minDepth;
    const px = c.x + c.nx * d.size[1] * 0.12, pz = c.z + c.nz * d.size[1] * 0.12;
    const depth = portDepths(w, px, pz, c.nx, c.nz, d).berth;
    const stages = depth >= need ? 0 : Math.ceil((need - depth) / 3);
    const dredge = dredgeCost(w, d, stages, reefHere);
    const earth = d.cost * clamp(slope / Math.max(4, d.maxSlope), 0, 1) * 0.3;
    const prot = protHere && w.state.policy.environment !== 'strict' ? (d.cost + dredge + earth) * (w.state.policy.environment === 'lax' ? 0.05 : 0.2) : 0;
    const bw = shelter < 0.55 ? 3_500_000 * (0.6 + (1 - shelter) * 1.2) : 0;
    const link = isFinite(road.dist) ? road.dist / t.hs * 950 : 3_000_000;
    const feasible = stages <= 4 && slope <= d.maxSlope * 1.3 && w.isUnlocked(d) && !(protHere && w.state.policy.environment === 'strict');
    const total = (d.cost + dredge + earth + prot + bw + link) * ci;
    const note = !w.isUnlocked(d) ? 'needs research' : protHere && w.state.policy.environment === 'strict' ? 'protected area (strict policy)' : stages > 4 ? 'too shallow' : slope > d.maxSlope * 1.3 ? 'too steep' : [stages ? `${stages} dredging stage${stages > 1 ? 's' : ''}` : '', bw ? 'breakwater advised' : '', prot ? 'protected-area mitigation' : ''].filter(Boolean).join(', ') || 'good';
    return { type, name: d.name, total, dredgeStages: stages, feasible, note };
  });
  const focus = costs.find((c2) => c2.type === focusType) ?? costs[2];
  const focusDef = BUILDING_MAP[focusType] ?? BUILDING_MAP.commercial_port;
  const scoreItems = [
    { label: 'Shelter', score: shelter * 100, weight: 0.28 },
    { label: 'Depth', score: clamp(Math.min(berthDepth, approach) / focusDef.port!.minDepth, 0, 1) * 100, weight: 0.2 },
    { label: 'Flat land', score: clamp(flatHa / 25, 0, 1) * 100, weight: 0.18 },
    { label: 'Gentle shore', score: clamp(1 - slope / 18, 0, 1) * 100, weight: 0.1 },
    { label: 'Low sensitivity', score: (1 - sensitivity) * 100, weight: 0.16 },
    { label: 'Cost', score: clamp(1 - (focus.total / (focusDef.cost * ci) - 1) / 1.5, 0, 1) * 100, weight: 0.08 },
  ];
  const score = Math.round(scoreItems.reduce((s, i) => s + i.score * i.weight, 0));
  return {
    x: c.x,
    z: c.z,
    rot,
    name: nearestPlaceName(w, c.x, c.z),
    shelter,
    exposureDir: COMPASS[worstDir],
    berthDepth,
    approachDepth: approach,
    slope,
    flatLand: flatHa,
    sensitivity,
    sensitivityNotes: [...notes],
    roadDistance: road.dist,
    costs,
    score,
    scoreItems,
  };
}

export function nearestPlaceName(w: World, x: number, z: number): string {
  const t = w.terrain;
  let best = '', bd = Infinity;
  for (const p of t.meta.osm.places) {
    const [px, pz] = t.osmToWorld(p.p);
    if (!t.isTerritory(px, pz) && !['bay', 'cape', 'beach'].includes(p.kind)) {
      // skip places on foreign land
      if (t.isLand(px, pz)) continue;
    }
    const d = Math.hypot(px - x, pz - z);
    if (d < bd) (bd = d), (best = p.name);
  }
  if (!best || bd > 2500) {
    const [fx, fy] = t.toGrid(x, z);
    const ns = fy < t.H / 3 ? 'North' : fy > (2 * t.H) / 3 ? 'South' : '';
    const ew = fx < t.W / 3 ? 'west' : fx > (2 * t.W) / 3 ? 'east' : '';
    return `${ns}${ns && ew ? '-' : ''}${ns ? ew : ew ? ew[0].toUpperCase() + ew.slice(1) : 'Central'} shore`;
  }
  return bd < 500 ? best : `near ${best}`;
}

/** Scan the coastline and return the best, well-separated candidate sites. */
export function findPortCandidates(w: World, focusType = 'commercial_port', count = 6): PortSiteReport[] {
  const t = w.terrain;
  const coast: [number, number][] = [];
  const stride = Math.max(1, Math.round(90 / t.cell));
  for (let j = 1; j < t.H - 1; j += 1) {
    for (let i = 1; i < t.W - 1; i += 1) {
      if ((i + j * 7) % stride !== 0) continue;
      const k = j * t.W + i;
      if ((t.mask[k] & 3) !== MASK.territory) continue;
      if ((t.mask[k - 1] & 3) && (t.mask[k + 1] & 3) && (t.mask[k - t.W] & 3) && (t.mask[k + t.W] & 3)) continue;
      coast.push(t.toWorld(i, j));
    }
  }
  // thin to at most ~240 evaluations
  const step = Math.max(1, Math.floor(coast.length / 240));
  const reports: PortSiteReport[] = [];
  for (let i = 0; i < coast.length; i += step) {
    const r = evaluatePortSite(w, coast[i][0], coast[i][1], focusType);
    if (r) reports.push(r);
  }
  reports.sort((a, b) => b.score - a.score);
  const out: PortSiteReport[] = [];
  const minSep = Math.max(500, t.widthM / 14);
  // verify the best sites with the real placement rules, so every suggestion can actually be built
  for (const r of reports) {
    if (!out.every((o) => Math.hypot(o.x - r.x, o.z - r.z) > minSep)) continue;
    const ev = w.evaluate(focusType, r.x, r.z, r.rot);
    r.buildable = ev.errors.filter((e) => !e.startsWith('Costs') && !e.startsWith('Needs research') && !e.startsWith('Only one')).length === 0;
    r.blockers = ev.errors;
    if (!r.buildable) continue;
    out.push(r);
    if (out.length >= count) break;
  }
  return out;
}
