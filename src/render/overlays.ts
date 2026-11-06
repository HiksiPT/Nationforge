// Data overlays painted into an RGBA texture at terrain-grid resolution.

import { BUILDING_MAP, ZONES, ZONE_FROM_CODE } from '../data/catalogue';
import { MASK } from '../geo/terrain';
import type { Overlay } from '../app/store';
import type { World } from '../sim/world';

type RGB = [number, number, number];

function ramp(stops: RGB[], t: number): RGB {
  t = Math.max(0, Math.min(1, t));
  const f = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const u = f - i;
  const a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

const HEAT: RGB[] = [[40, 60, 160], [40, 170, 200], [90, 200, 90], [240, 220, 60], [230, 80, 40]];
const GOOD_BAD: RGB[] = [[210, 50, 40], [235, 200, 60], [60, 180, 80]];

export const OVERLAY_INFO: Record<Overlay, { name: string; legend: [string, string][] }> = {
  none: { name: 'No overlay', legend: [] },
  terrain: { name: 'Elevation & depth', legend: [['#1e3c8c', 'deep water'], ['#46c3d2', 'shallow'], ['#5ab450', 'lowland'], ['#c8b464', 'hills'], ['#f0f0f0', 'summit']] },
  slope: { name: 'Slope', legend: [['#3cb450', '< 5°'], ['#f0dc3c', '10°'], ['#e65028', '> 20°']] },
  buildable: { name: 'Buildable land', legend: [['#3cb450', 'flat'], ['#f0dc3c', 'moderate'], ['#e65028', 'steep'], ['#8c8c8c', 'not yours / protected']] },
  roads: { name: 'Road access', legend: [['#3cb450', 'within reach'], ['#f0dc3c', '< 300 m'], ['#e65028', 'far from roads']] },
  zones: { name: 'Zoning', legend: [['#5ac86e', 'residential'], ['#508ce6', 'commercial'], ['#e6aa46', 'industrial']] },
  population: { name: 'Population density', legend: [['#283ca0', 'few'], ['#5ac85a', 'some'], ['#e65028', 'dense']] },
  landvalue: { name: 'Land value', legend: [['#283ca0', 'low'], ['#5ac85a', 'medium'], ['#e65028', 'high']] },
  employment: { name: 'Jobs', legend: [['#283ca0', 'few'], ['#5ac85a', 'some'], ['#e65028', 'many']] },
  industry: { name: 'Industry & output', legend: [['#283ca0', 'low'], ['#e65028', 'high output']] },
  resources: { name: 'Natural resources', legend: [['#2e7d32', 'forest (timber)'], ['#c8b464', 'farmland'], ['#64b4f0', 'fishing grounds'], ['#f0f0f0', 'wind'], ['#a0a0a0', 'stone']] },
  power: { name: 'Power grid', legend: [['#3cb450', 'supplied'], ['#e65028', 'shortage'], ['#8c8c8c', 'off grid']] },
  water: { name: 'Water supply', legend: [['#3c8cf0', 'supplied'], ['#e65028', 'shortage'], ['#8c8c8c', 'not connected']] },
  environment: { name: 'Environment', legend: [['#3cb450', 'healthy / protected'], ['#f0dc3c', 'pressure'], ['#e65028', 'polluted']] },
  regions: { name: 'Regions & regional GDP', legend: [['#283ca0', 'low GDP per person'], ['#e65028', 'high']] },
  projects: { name: 'Construction projects', legend: [['#f0a030', 'under construction'], ['#5ac86e', 'zoned'], ['#ffffff', 'roads being built']] },
};

export function paintOverlay(w: World, mode: Overlay, data: Uint8Array) {
  const t = w.terrain;
  const { W, H } = t;
  data.fill(0);
  if (mode === 'none') return;
  const set = (k: number, c: RGB, a = 200) => {
    data[k * 4] = c[0];
    data[k * 4 + 1] = c[1];
    data[k * 4 + 2] = c[2];
    data[k * 4 + 3] = a;
  };
  const slope = t.slopeGrid();
  const st = w.state;
  const terr = (k: number) => (t.mask[k] & 3) === MASK.territory;

  const splat = (vals: { x: number; z: number; v: number }[], radius: number) => {
    const acc = new Float32Array(W * H);
    const rc = Math.max(1, radius / t.cell);
    for (const p of vals) {
      const [cx, cy] = t.toGrid(p.x, p.z);
      for (let j = Math.floor(cy - rc * 2); j <= cy + rc * 2; j++) {
        if (j < 0 || j >= H) continue;
        for (let i = Math.floor(cx - rc * 2); i <= cx + rc * 2; i++) {
          if (i < 0 || i >= W) continue;
          const d2 = ((i - cx) ** 2 + (j - cy) ** 2) / (rc * rc);
          if (d2 > 4) continue;
          acc[j * W + i] += p.v * Math.exp(-d2);
        }
      }
    }
    let max = 0;
    for (let k = 0; k < acc.length; k++) max = Math.max(max, acc[k]);
    return { acc, max: max || 1 };
  };

  switch (mode) {
    case 'terrain': {
      const maxE = Math.max(30, t.meta.stats.maxElevation);
      for (let k = 0; k < W * H; k++) {
        const e = t.real[k];
        const c = e < 0 ? ramp([[70, 195, 210], [30, 60, 140]], Math.sqrt(-e / 80)) : ramp([[90, 180, 80], [200, 180, 100], [150, 120, 90], [240, 240, 240]], e / maxE);
        set(k, c, 220);
      }
      break;
    }
    case 'slope':
      for (let k = 0; k < W * H; k++) if (t.mask[k] & 3) set(k, ramp([[60, 180, 80], [240, 220, 60], [230, 80, 40]], slope[k] / 22));
      break;
    case 'buildable':
      for (let k = 0; k < W * H; k++) {
        if (!(t.mask[k] & 3)) continue;
        if (!terr(k) || (t.mask[k] & MASK.protected && st.policy.environment === 'strict')) set(k, [140, 140, 140], 170);
        else set(k, slope[k] < 6 ? [60, 180, 80] : slope[k] < 12 ? [240, 220, 60] : [230, 80, 40], 190);
      }
      break;
    case 'roads': {
      const near = new Float32Array(W * H).fill(1e9);
      for (const r of st.roads) for (const [x, z] of r.pts) {
        const [cx, cy] = t.toGrid(x, z);
        const rc = Math.ceil(320 / t.cell);
        for (let j = Math.floor(cy) - rc; j <= cy + rc; j++) for (let i = Math.floor(cx) - rc; i <= cx + rc; i++) {
          if (i < 0 || j < 0 || i >= W || j >= H) continue;
          const d = Math.hypot(i - cx, j - cy) * t.cell;
          if (d < near[j * W + i]) near[j * W + i] = d;
        }
      }
      for (let k = 0; k < W * H; k++) if (terr(k)) set(k, near[k] < 50 ? [60, 180, 80] : near[k] < 300 ? [240, 220, 60] : [230, 80, 40], 170);
      break;
    }
    case 'zones':
      for (let k = 0; k < W * H; k++) {
        const z = st.zones[k];
        if (z) set(k, ZONES[ZONE_FROM_CODE[z]].color, 200);
        else if (terr(k)) set(k, [255, 255, 255], 25);
      }
      break;
    case 'projects':
      for (let k = 0; k < W * H; k++) if (st.zones[k]) set(k, ZONES[ZONE_FROM_CODE[st.zones[k]]].color, 120);
      for (const b of st.buildings) {
        if (b.status !== 'construction' && !(b.pending && b.pending.length)) continue;
        const d = BUILDING_MAP[b.type];
        const r = Math.hypot(d.size[0], d.size[1]) / 2 + 30;
        const [cx, cy] = t.toGrid(b.x, b.z);
        const rc = r / t.cell;
        for (let j = Math.floor(cy - rc); j <= cy + rc; j++) for (let i = Math.floor(cx - rc); i <= cx + rc; i++) {
          if (i < 0 || j < 0 || i >= W || j >= H || (i - cx) ** 2 + (j - cy) ** 2 > rc * rc) continue;
          set(j * W + i, [240, 160, 48], 230);
        }
      }
      for (const r of st.roads) if (r.status === 'construction') for (const [x, z] of r.pts) set(t.idx(x, z), [255, 255, 255], 240);
      break;
    case 'population':
    case 'employment':
    case 'industry': {
      const vals: { x: number; z: number; v: number }[] = [];
      const occ = (w.lastMonth()?.pop ?? 0) / Math.max(1, w.lastMonth()?.housing ?? 1);
      for (const b of st.buildings) {
        const d = BUILDING_MAP[b.type];
        if (b.status === 'construction') continue;
        if (mode === 'population' && d.housing) vals.push({ x: b.x, z: b.z, v: d.housing * Math.min(1.1, occ) });
        if (mode === 'employment' && d.jobs) vals.push({ x: b.x, z: b.z, v: b.ops?.workers ?? 0 });
        if (mode === 'industry' && (d.out || d.servicesExport)) vals.push({ x: b.x, z: b.z, v: Math.max(0, b.ops?.revenue ?? 0) });
      }
      const { acc, max } = splat(vals, 180);
      for (let k = 0; k < W * H; k++) if (acc[k] > max * 0.02) set(k, ramp(HEAT, Math.sqrt(acc[k] / max)), 210);
      break;
    }
    case 'landvalue': {
      const vals: { x: number; z: number; v: number }[] = [];
      for (const b of st.buildings) {
        const d = BUILDING_MAP[b.type];
        vals.push({ x: b.x, z: b.z, v: d.service || d.commerce || d.cat === 'public' ? 3 : d.housing ? 1 : d.pollution ? -2 : 1 });
      }
      const { acc, max } = splat(vals, 350);
      for (let k = 0; k < W * H; k++) {
        if (!terr(k)) continue;
        const coast = Math.max(0, 1 - t.coastDist[k] / 600);
        const v = 0.25 + coast * 0.3 + Math.max(-0.3, acc[k] / max) * 0.5 - slope[k] / 60;
        set(k, ramp(HEAT, v), 190);
      }
      break;
    }
    case 'resources': {
      const maxE = Math.max(30, t.meta.stats.maxElevation);
      for (let k = 0; k < W * H; k++) {
        const m = t.mask[k];
        if ((m & 3) === MASK.sea) {
          const dep = -t.real[k];
          if (dep > 3 && dep < 60 && t.coastDist[k] < 2500) set(k, [100, 180, 240], 120);
          continue;
        }
        if (!terr(k)) continue;
        if (m & MASK.forest && !st.cleared[k]) set(k, [46, 125, 50], 200);
        else if (slope[k] < 6 && t.real[k] < maxE * 0.5) set(k, [200, 180, 100], 200);
        else if (t.real[k] > maxE * 0.6) set(k, [240, 240, 240], 190);
        else if (slope[k] > 25) set(k, [160, 160, 160], 190);
      }
      break;
    }
    case 'power':
    case 'water': {
      const lm = w.lastMonth();
      const sat = lm ? (mode === 'power' ? lm.powerSupply / Math.max(1e-6, lm.powerDemand) : lm.waterSupply / Math.max(1, lm.waterDemand)) : 1;
      const good: RGB = mode === 'power' ? [60, 180, 80] : [60, 140, 240];
      const near = new Uint8Array(W * H);
      const rc = Math.ceil(120 / t.cell);
      for (const r of st.roads) {
        if (r.status !== 'active') continue;
        for (const [x, z] of r.pts) {
          const [cx, cy] = t.toGrid(x, z);
          for (let j = Math.floor(cy) - rc; j <= cy + rc; j++) for (let i = Math.floor(cx) - rc; i <= cx + rc; i++) if (i >= 0 && j >= 0 && i < W && j < H) near[j * W + i] = 1;
        }
      }
      for (let k = 0; k < W * H; k++) if (terr(k)) set(k, near[k] ? (sat >= 0.98 ? good : [230, 80, 40]) : [140, 140, 140], near[k] ? 170 : 90);
      for (const b of st.buildings) {
        const d = BUILDING_MAP[b.type];
        const isSrc = mode === 'power' ? (d.power ?? 0) > 0 || !!d.powerKind : (d.water ?? 0) > 0;
        if (!isSrc) continue;
        const [cx, cy] = t.toGrid(b.x, b.z);
        const rr = Math.max(3, 60 / t.cell);
        for (let j = Math.floor(cy - rr); j <= cy + rr; j++) for (let i = Math.floor(cx - rr); i <= cx + rr; i++) if (i >= 0 && j >= 0 && i < W && j < H) set(j * W + i, [255, 255, 255], 240);
      }
      break;
    }
    case 'environment': {
      const vals: { x: number; z: number; v: number }[] = [];
      for (const b of st.buildings) {
        const d = BUILDING_MAP[b.type];
        if (d.pollution) vals.push({ x: b.x, z: b.z, v: d.pollution * (b.ops?.efficiency ?? 1) });
      }
      const { acc, max } = splat(vals, 400);
      const marine = st.env.marine / 100;
      for (let k = 0; k < W * H; k++) {
        const m = t.mask[k];
        if ((m & 3) === MASK.sea) {
          if (m & MASK.reef) set(k, ramp(GOOD_BAD, marine), 170);
          continue;
        }
        if (!terr(k)) continue;
        const p = acc[k] / Math.max(4, max);
        const healthy = m & MASK.protected || (m & MASK.forest && !st.cleared[k]) ? 1 : 0.7;
        set(k, ramp(GOOD_BAD, healthy - p * 1.2), 170);
      }
      break;
    }
    case 'regions': {
      const pcs = st.regions.map((r) => (r.stats.pop > 0 ? r.stats.gdp / r.stats.pop : 0));
      const maxPc = Math.max(1, ...pcs);
      const hues: RGB[] = [[230, 120, 90], [90, 160, 230], [120, 200, 110], [220, 190, 80], [180, 120, 210], [90, 210, 200]];
      for (let k = 0; k < W * H; k++) {
        if (!terr(k)) continue;
        const [x, z] = t.toWorld(k % W, Math.floor(k / W));
        const r = w.regionAt(x, z);
        const base = hues[r % hues.length];
        const v = pcs[r] / maxPc;
        const c = ramp([[40, 60, 160], [230, 80, 40]], v);
        set(k, [base[0] * 0.4 + c[0] * 0.6, base[1] * 0.4 + c[1] * 0.6, base[2] * 0.4 + c[2] * 0.6], 190);
      }
      break;
    }
  }
}
