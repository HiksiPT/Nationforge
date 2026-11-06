// Placement validation, cost and suitability for one building at one spot.

import { BUILDING_MAP, type BuildingDef } from '../data/catalogue';
import { TECH_MAP } from '../data/research';
import { MASK } from '../geo/terrain';
import { obbOverlap, pointInObb, type OBB } from './spatial';
import type { World } from './world';
import { clamp } from './economy';

export interface Check {
  label: string;
  state: 'ok' | 'warn' | 'fail';
  detail: string;
}

export interface PlacementResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  checks: Check[];
  cost: number;
  costItems: { label: string; amount: number }[];
  suitability: number; // 0..100
  suitItems: { label: string; score: number }[];
  snap?: { x: number; z: number; rot: number };
  consultDays: number;
  envDamage: number; // marine health damage
  landDamage: number; // environment quality damage
  port?: { berthDepth: number; approachDepth: number; shelter: number; dredgeStages: number };
}

/** Find the nearest territory coastline point to (x, z) and the seaward direction there. */
export function snapToCoast(w: World, x: number, z: number, maxR = 160): { x: number; z: number; nx: number; nz: number } | null {
  const t = w.terrain;
  const [cx, cy] = t.toGrid(x, z);
  const rc = Math.ceil(maxR / t.cell);
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (let j = Math.floor(cy) - rc; j <= Math.ceil(cy) + rc; j++) {
    for (let i = Math.floor(cx) - rc; i <= Math.ceil(cx) + rc; i++) {
      if (i < 1 || j < 1 || i >= t.W - 1 || j >= t.H - 1) continue;
      const k = j * t.W + i;
      if ((t.mask[k] & 3) !== MASK.territory) continue;
      if ((t.mask[k - 1] & 3) && (t.mask[k + 1] & 3) && (t.mask[k - t.W] & 3) && (t.mask[k + t.W] & 3)) continue;
      const d = (i - cx) ** 2 + (j - cy) ** 2;
      if (d < bd) (bd = d), (best = [i, j]);
    }
  }
  if (!best) return null;
  // seaward normal: average direction to sea cells nearby
  let nx = 0, ny = 0;
  const R = 4;
  for (let j = best[1] - R; j <= best[1] + R; j++) {
    for (let i = best[0] - R; i <= best[0] + R; i++) {
      if (i < 0 || j < 0 || i >= t.W || j >= t.H) continue;
      if ((t.mask[j * t.W + i] & 3) === MASK.sea) {
        const dx = i - best[0], dy = j - best[1];
        const l = Math.hypot(dx, dy) || 1;
        nx += dx / l;
        ny += dy / l;
      }
    }
  }
  const l = Math.hypot(nx, ny);
  if (l < 1e-6) return null;
  const [wx, wz] = t.toWorld(best[0], best[1]);
  return { x: wx, z: wz, nx: nx / l, nz: ny / l };
}

function footprintSamples(o: OBB, n = 5): [number, number][] {
  const out: [number, number][] = [];
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const lx = (a / (n - 1) - 0.5) * 2 * o.hw;
      const lz = (b / (n - 1) - 0.5) * 2 * o.hd;
      out.push([o.x + lx * c + lz * s, o.z - lx * s + lz * c]);
    }
  }
  return out;
}

export function evaluatePlacement(w: World, type: string, x: number, z: number, rot: number): PlacementResult {
  const def = BUILDING_MAP[type];
  const t = w.terrain;
  const st = w.state;
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: Check[] = [];
  const costItems: { label: string; amount: number }[] = [];
  let consultDays = 0;
  let envDamage = 0;
  let landDamage = 0;
  let snap: PlacementResult['snap'];
  let port: PlacementResult['port'];
  const ci = w.costIndex();
  let cost = def.cost * ci;
  costItems.push({ label: 'Construction', amount: def.cost * ci });

  if (!def) return { ok: false, errors: ['Unknown building'], warnings, checks, cost: 0, costItems, suitability: 0, suitItems: [], consultDays, envDamage, landDamage };
  if (!w.isUnlocked(def)) {
    errors.push(def.needs ? `Needs research: ${TECH_MAP[def.needs]?.name}` : 'Not available on this island');
  }
  if (def.unique && st.buildings.some((b) => b.type === type)) errors.push('Only one can be built');
  if (!t.inBounds(x, z)) errors.push('Outside the map');

  // ---- site snapping and geometry
  if (def.site === 'coast') {
    const c = snapToCoast(w, x, z);
    if (!c) {
      errors.push('Must be built on your own coastline');
    } else {
      rot = Math.atan2(c.nx, c.nz);
      const off = def.port ? def.size[1] * 0.12 : def.size[1] * 0.1;
      x = c.x + c.nx * off;
      z = c.z + c.nz * off;
      snap = { x, z, rot };
    }
  }
  const o: OBB = { x, z, hw: def.size[0] / 2, hd: def.size[1] / 2, rot };
  const samples = footprintSamples(o, def.size[0] > 200 || def.size[1] > 200 ? 9 : 5);
  let maxSlope = 0;
  let hmin = Infinity, hmax = -Infinity;
  let flags = 0;
  let landCount = 0, seaCount = 0, foreign = 0;
  for (const [sx, sz] of samples) {
    const cls = t.classAt(sx, sz);
    flags |= t.flagsAt(sx, sz);
    if (cls === MASK.territory) landCount++;
    else if (cls === MASK.sea) seaCount++;
    else foreign++;
  }
  const landSamples = samples.filter(([sx, sz]) => t.classAt(sx, sz) !== MASK.sea);
  for (const [sx, sz] of landSamples) {
    maxSlope = Math.max(maxSlope, t.slopeAt(sx, sz));
    const h = t.heightAt(sx, sz);
    hmin = Math.min(hmin, h);
    hmax = Math.max(hmax, h);
  }
  if (foreign > 0) errors.push('Crosses into land that is not part of your territory');

  if (def.site === 'sea') {
    const depth = -t.realAt(x, z);
    if (t.classAt(x, z) !== MASK.sea || landCount > 0) errors.push('Must be placed in open water');
    else if (depth < 2) errors.push(`Water too shallow (${depth.toFixed(1)} m, needs 2 m)`);
    else if (depth > 45) errors.push(`Water too deep for moorings (${depth.toFixed(0)} m)`);
    if (t.coastDistAt(x, z) > 1500) errors.push('Too far from the coast');
    checks.push({ label: 'Water depth', state: depth >= 2 && depth <= 45 ? 'ok' : 'fail', detail: `${depth.toFixed(1)} m` });
  } else if (def.site === 'coast') {
    const sea = seaCount / samples.length;
    const land = landCount / samples.length;
    if (land < 0.2) errors.push('Needs solid ground on the landward side');
    if (sea < 0.15) errors.push('Needs open water on the seaward side');
    // quays are cut into the shore, so ports are judged on the average slope of the land they sit on
    const landSlope = landSamples.length ? landSamples.reduce((a, [sx, sz]) => a + t.slopeAt(sx, sz), 0) / landSamples.length : maxSlope;
    maxSlope = landSlope;
    if (landSlope > def.maxSlope) errors.push(`Shore too steep (${landSlope.toFixed(0)}°, max ${def.maxSlope}°)`);
    checks.push({ label: 'Shore slope', state: landSlope <= def.maxSlope ? 'ok' : 'fail', detail: `${landSlope.toFixed(1)}° (max ${def.maxSlope}°)` });
    if (def.port) {
      const nx = Math.sin(rot), nz = Math.cos(rot);
      const { berth, approach } = portDepths(w, x, z, nx, nz, def);
      const depth = berth;
      const need = def.port.minDepth;
      const stages = depth >= need ? 0 : Math.ceil((need - depth) / 3);
      const site = w.portSite(x, z, type);
      port = { berthDepth: depth, approachDepth: approach, shelter: site?.shelter ?? 0.5, dredgeStages: stages };
      checks.push({ label: 'Water depth at berth', state: stages === 0 ? 'ok' : stages <= 4 ? 'warn' : 'fail', detail: `${Math.max(0, depth).toFixed(1)} m real (needs ${need} m)` });
      if (stages > 4) errors.push(`Far too shallow: ${Math.max(0, depth).toFixed(1)} m, needs ${need} m`);
      else if (stages > 0) {
        const reef = (flags & MASK.reef) !== 0;
        const dc = dredgeCost(w, def, stages, reef) * ci;
        cost += dc;
        costItems.push({ label: `Dredging ${stages} × 3 m`, amount: dc });
        warnings.push(`Needs ${stages} dredging stage${stages > 1 ? 's' : ''} to reach ${need} m`);
        envDamage += stages * (reef ? 4 : 1.5);
      }
      const sh = port.shelter;
      checks.push({ label: 'Shelter', state: sh >= 0.55 ? 'ok' : 'warn', detail: `${Math.round(sh * 100)}% ${sh < 0.55 ? '(exposed: add a breakwater)' : ''}` });
      if (sh < 0.4) warnings.push('Exposed to prevailing swell: frequent weather closures until a breakwater is built');
    }
  } else {
    if (landCount < samples.length && foreign === 0) errors.push('Footprint reaches the sea');
    if (maxSlope > def.maxSlope) errors.push(`Too steep (${maxSlope.toFixed(0)}°, max ${def.maxSlope}°)`);
    checks.push({ label: 'Slope', state: maxSlope <= def.maxSlope ? 'ok' : 'fail', detail: `${maxSlope.toFixed(1)}° (max ${def.maxSlope}°)` });
  }
  if (def.minElev != null) {
    const e = t.realAt(x, z);
    if (e < def.minElev) errors.push(`Needs at least ${def.minElev} m elevation (here ${e.toFixed(0)} m)`);
  }
  if (def.id === 'heritage_restoration' && w.scenario.landmark) {
    const [lx, lz] = t.toWorld(...w.scenario.landmark.p);
    if (Math.hypot(lx - x, lz - z) > 160) errors.push(`Place it at ${w.scenario.landmark.name} (marked on the map)`);
  }

  // ---- earthworks cost from slope
  if (landSamples.length && def.site !== 'sea') {
    const relief = isFinite(hmax) ? hmax - hmin : 0;
    const ew = def.cost * ci * clamp(maxSlope / Math.max(4, def.maxSlope), 0, 1) * 0.3 + relief * 2500 * (def.size[0] * def.size[1]) / 2000;
    if (ew > 1000) {
      cost += ew;
      costItems.push({ label: 'Earthworks & foundations', amount: ew });
    }
  }

  // ---- overlap with buildings and roads
  const r = Math.hypot(o.hw, o.hd);
  for (const b of w.buildingCandidates(x - r - 300, z - r - 300, x + r + 300, z + r + 300)) {
    if (obbOverlap(o, w.obbOf(b), 2)) {
      errors.push(`Overlaps ${w.def(b).name}`);
      break;
    }
  }
  if (def.site !== 'sea') {
    let hit = false;
    for (const rd of w.roadsNear(x, z, r + 10)) {
      for (let i = 0; i + 1 < rd.pts.length && !hit; i++) {
        const [ax, az] = rd.pts[i];
        const [bx, bz] = rd.pts[i + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 4));
        for (let k = 0; k <= n; k++) {
          if (pointInObb(o, ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, rd.cls === 'track' ? 1 : 3)) {
            hit = true;
            break;
          }
        }
      }
      if (hit) break;
    }
    if (hit) errors.push('Overlaps a road');
  }

  // ---- proximity rules
  if (def.site === 'port-near') {
    const near = w.ports().filter((p) => Math.hypot(p.x - x, p.z - z) <= (def.nearPort ?? 400) + w.def(p).size[0] / 2);
    if (!near.length) errors.push(`Must be within ${def.nearPort} m of a harbour or port`);
    checks.push({ label: 'Near a port', state: near.length ? 'ok' : 'fail', detail: near.length ? w.def(near[0]).name : 'none in range' });
  }

  // ---- protected land, community land, reefs
  const strict = st.policy.environment === 'strict';
  if (flags & MASK.protected) {
    if (strict) errors.push('Protected area: forbidden under the strict environment policy');
    else {
      const extra = cost * (st.policy.environment === 'lax' ? 0.05 : 0.2);
      cost += extra;
      costItems.push({ label: 'Protected-area assessment & mitigation', amount: extra });
      warnings.push('Inside a protected area: environment quality and reputation will suffer');
      landDamage += 1.5;
    }
  }
  if (flags & MASK.community && def.cat !== 'public') {
    consultDays = 60;
    warnings.push('Community land: 60 days of consultation before work can start; nobody will be moved');
  }
  if ((def.site === 'coast' || def.site === 'sea') && flags & MASK.reef) {
    envDamage += def.port ? 3 : 1.5;
    warnings.push(`On sensitive ${w.scenario.id === 'moorea' ? 'reef' : 'shallow marine habitat'}: ${w.scenario.marineName.toLowerCase()} will drop`);
  }
  if (flags & MASK.forest && def.site !== 'sea') warnings.push('Clears forest');

  // ---- road access
  const reach = w.accessReach({ type });
  const near = w.nearestRoad(x, z, reach + 60);
  const roadOk = def.site === 'sea' || near.dist <= reach;
  checks.push({
    label: 'Road access',
    state: roadOk ? 'ok' : 'warn',
    detail: def.site === 'sea' ? 'reached by boat' : roadOk ? `road ${Math.round(near.dist)} m away` : 'no road within reach',
  });
  if (!roadOk) warnings.push(def.port ? 'No road access yet: add a road link from the port panel' : 'No road access: it will not operate until a road reaches it');

  // ---- utilities
  const lm = w.lastMonth();
  const pMargin = lm ? lm.powerSupply - lm.powerDemand : 0;
  const wMargin = lm ? lm.waterSupply - lm.waterDemand : 0;
  if ((def.power ?? 0) < 0) {
    const need = -(def.power ?? 0);
    const ok = pMargin >= need;
    checks.push({ label: 'Power', state: ok ? 'ok' : 'warn', detail: `needs ${fmtMW(need)}, spare ${fmtMW(Math.max(0, pMargin))}` });
    if (!ok) warnings.push('Not enough spare power: build generation');
  } else if ((def.power ?? 0) > 0) {
    checks.push({ label: 'Power', state: 'ok', detail: `supplies ${fmtMW(def.power!)}${def.powerKind && def.powerKind !== 'diesel' ? ' (variable)' : ''}` });
  }
  if ((def.water ?? 0) < 0) {
    const need = -(def.water ?? 0);
    const ok = wMargin >= need;
    checks.push({ label: 'Water', state: ok ? 'ok' : 'warn', detail: `needs ${Math.round(need)} m³/mo, spare ${Math.round(Math.max(0, wMargin))}` });
    if (!ok) warnings.push('Not enough spare water: build boreholes, cisterns, a reservoir or desalination');
  } else if ((def.water ?? 0) > 0) {
    checks.push({ label: 'Water', state: 'ok', detail: `supplies ${Math.round(def.water!)} m³/mo` });
  }
  if (consultDays) checks.push({ label: 'Community land', state: 'warn', detail: '60-day consultation' });

  const suit = suitability(w, def, x, z, maxSlope);
  if (cost > st.treasury) errors.push(`Costs ${Math.round(cost / 1000).toLocaleString()}k, treasury has ${Math.round(st.treasury / 1000).toLocaleString()}k`);
  checks.unshift({ label: 'Funds', state: cost <= st.treasury ? 'ok' : 'fail', detail: `${(cost / 1e6).toFixed(2)}M of ${(st.treasury / 1e6).toFixed(1)}M` });

  return { ok: errors.length === 0, errors, warnings, checks, cost: Math.round(cost), costItems, suitability: suit.score, suitItems: suit.items, snap, consultDays, envDamage, landDamage, port };
}

/** Depth at the berth (just off the end of the quay) and the shallowest point of the approach channel, in real metres. */
export function portDepths(w: World, x: number, z: number, nx: number, nz: number, def: BuildingDef): { berth: number; approach: number } {
  const t = w.terrain;
  const off = def.size[1] / 2 + 15;
  const berth = -t.realAt(x + nx * off, z + nz * off);
  let approach = Infinity;
  for (let d = 60; d <= 500; d += 40) approach = Math.min(approach, -t.realAt(x + nx * (off + d), z + nz * (off + d)));
  return { berth: Math.min(berth, Math.max(berth, approach)), approach };
}

export function dredgeCost(w: World, def: BuildingDef, stages: number, reef: boolean): number {
  return 2_800_000 * stages * (w.hasTech('deep_water') ? 0.75 : 1) * (reef ? 1.6 : 1) * (0.25 + def.size[0] / 150);
}

function fmtMW(v: number) {
  return v >= 1 ? `${v.toFixed(1)} MW` : `${Math.round(v * 1000)} kW`;
}

/** 0..100 suitability score from the building's preferences and the site. */
export function suitability(w: World, def: BuildingDef, x: number, z: number, slope: number): { score: number; items: { label: string; score: number }[] } {
  const t = w.terrain;
  const s = def.suit;
  const items: { label: string; score: number }[] = [];
  const coastD = t.isLand(x, z) ? t.coastDistAt(x, z) : 0;
  const elev = Math.max(0, t.realAt(x, z));
  const maxE = Math.max(20, t.meta.stats.maxElevation || 100);
  const add = (label: string, weight: number | undefined, v: number) => {
    if (weight) items.push({ label, score: clamp(v, 0, 1) * 100 });
    return weight ?? 0;
  };
  let wsum = 0, vsum = 0;
  const push = (label: string, weight: number | undefined, v: number) => {
    const wt = add(label, weight, v);
    wsum += wt;
    vsum += wt * clamp(v, 0, 1);
  };
  push('Flat ground', s.flat, 1 - slope / Math.max(4, def.maxSlope));
  push('Near the sea', s.coast, 1 - (coastD - 60) / 700);
  push('Inland & sheltered', s.inland, coastD / 600);
  push('Height & exposure', s.high, elev / maxE + (s.wind ? 0 : 0));
  push('Low ground', s.low, 1 - elev / (maxE * 0.6));
  push('Sea view', s.view, (1 - (coastD - 40) / 900) * 0.6 + Math.min(1, elev / 40) * 0.4);
  push('Wind exposure', s.wind, (elev / maxE) * 0.6 + (1 - coastD / 1200) * 0.4);
  push('Sunshine', s.sun, avg(w.scenario.climate.sun) / 0.7);
  if (s.forest) {
    let f = 0, n = 0;
    const R = 300;
    for (let dx = -R; dx <= R; dx += 50) for (let dz = -R; dz <= R; dz += 50) {
      n++;
      const k = t.idx(x + dx, z + dz);
      if (t.mask[k] & MASK.forest && !w.state.cleared[k]) f++;
    }
    push('Forest nearby', s.forest, (f / n) * 2.2);
  }
  if (s.services) {
    const kinds = new Set<string>();
    for (const b of w.buildingsNear(x, z, 1500)) {
      const sv = w.def(b).service;
      if (sv && Math.hypot(b.x - x, b.z - z) <= sv.radius) kinds.add(sv.kind);
      if (w.def(b).commerce && Math.hypot(b.x - x, b.z - z) < 700) kinds.add('shops');
    }
    push('Services nearby', s.services, kinds.size / 4);
  }
  if (s.quiet) {
    let noise = 0;
    for (const b of w.buildingsNear(x, z, 350)) noise += w.def(b).pollution ?? 0;
    push('Peace & quiet', s.quiet, 1 - noise / 5);
  }
  if (s.port) {
    let d = Infinity;
    for (const p of w.ports()) d = Math.min(d, Math.hypot(p.x - x, p.z - z));
    push('Close to a port', s.port, 1 - (d - 300) / 1500);
  }
  const score = wsum > 0 ? Math.round((vsum / wsum) * 100) : 70;
  return { score, items };
}

function avg(a: number[]) {
  return a.reduce((s, v) => s + v, 0) / a.length;
}
