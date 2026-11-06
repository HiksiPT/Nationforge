// Road planning: A* over the terrain grid with a hard grade limit per road class, so roads wind along
// contours and switch back up hills instead of going straight over them.

import { ROAD_CLASSES } from '../data/catalogue';
import { MASK } from '../geo/terrain';
import { pointInObb } from './spatial';
import type { RoadSeg } from './types';
import type { World } from './world';

export interface RoadPlan {
  ok: boolean;
  reason?: string;
  cls: RoadSeg['cls'];
  pts: [number, number][];
  length: number;
  cost: number;
  maxGrade: number;
  avgGrade: number;
  days: number;
  forestCells: number;
  protectedCells: number;
}

class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): number {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

// 16-neighbourhood: knight moves let the path climb at gentler angles than a pure 8-neighbour grid
const MOVES: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2],
];

export function planRoad(w: World, cls: RoadSeg['cls'], a: [number, number], b: [number, number], opts: { ignoreBuildings?: number[] } = {}): RoadPlan {
  const t = w.terrain;
  const rc = ROAD_CLASSES[cls];
  const fail = (reason: string): RoadPlan => ({ ok: false, reason, cls, pts: [a, b], length: 0, cost: 0, maxGrade: 0, avgGrade: 0, days: 0, forestCells: 0, protectedCells: 0 });
  if (rc.needs && !w.hasTech(rc.needs)) return fail('Needs research: Urban design');
  // snap endpoints to existing roads within 30 m so networks join cleanly
  a = snapToRoad(w, a);
  b = snapToRoad(w, b);
  const [ax, ay] = t.toGrid(a[0], a[1]);
  const [bx, by] = t.toGrid(b[0], b[1]);
  const si = Math.round(ax), sj = Math.round(ay), gi = Math.round(bx), gj = Math.round(by);
  const W = t.W, H = t.H;
  if (si < 0 || sj < 0 || gi < 0 || gj < 0 || si >= W || gi >= W || sj >= H || gj >= H) return fail('Outside the map');
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) < t.cell * 0.8) return fail('Too short');
  const passable = (k: number) => (t.mask[k] & 3) === MASK.territory;
  if (!passable(sj * W + si) || !passable(gj * W + gi)) return fail('Roads must start and end on your own land');

  // block cells under buildings (except ignored ones)
  const blocked = new Uint8Array(W * H);
  const ignore = new Set(opts.ignoreBuildings ?? []);
  for (const bl of w.state.buildings) {
    if (ignore.has(bl.id)) continue;
    const o = w.obbOf(bl);
    const r = Math.hypot(o.hw, o.hd);
    const [x0, y0] = t.toGrid(bl.x - r, bl.z - r);
    const [x1, y1] = t.toGrid(bl.x + r, bl.z + r);
    for (let j = Math.max(0, Math.floor(y0)); j <= Math.min(H - 1, Math.ceil(y1)); j++) {
      for (let i = Math.max(0, Math.floor(x0)); i <= Math.min(W - 1, Math.ceil(x1)); i++) {
        const [wx, wz] = t.toWorld(i, j);
        if (pointInObb(o, wx, wz, -t.cell * 0.3)) blocked[j * W + i] = 1;
      }
    }
  }
  const start = sj * W + si;
  const goal = gj * W + gi;
  blocked[start] = 0;
  blocked[goal] = 0;

  const hgt = t.heights;
  const cell = t.cell;
  const maxG = rc.maxGrade;
  const g = new Float32Array(W * H).fill(Infinity);
  const came = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const heap = new Heap();
  const hfun = (k: number) => Math.hypot((k % W) - gi, Math.floor(k / W) - gj) * cell;
  g[start] = 0;
  heap.push(hfun(start), start);
  let found = false;
  let expanded = 0;
  const limit = W * H;
  while (heap.size) {
    const k = heap.pop();
    if (closed[k]) continue;
    closed[k] = 1;
    if (k === goal) {
      found = true;
      break;
    }
    if (++expanded > limit) break;
    const i = k % W, j = (k / W) | 0;
    for (const [di, dj] of MOVES) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nk = nj * W + ni;
      if (closed[nk] || blocked[nk] || !passable(nk)) continue;
      // knight moves must not jump over water
      if (Math.abs(di) + Math.abs(dj) === 3) {
        const mk = (j + Math.round(dj / 2)) * W + (i + Math.round(di / 2));
        if (!passable(mk)) continue;
      }
      const dist = Math.hypot(di, dj) * cell;
      const grade = Math.abs(hgt[nk] - hgt[k]) / dist;
      if (grade > maxG) continue;
      const m = t.mask[nk];
      let c = dist * (1 + 2.5 * (grade / maxG) ** 2);
      if (m & MASK.protected) c += dist * 0.6;
      if (m & MASK.forest) c += dist * 0.25;
      if (m & MASK.community) c += dist * 0.2;
      const ng = g[k] + c;
      if (ng < g[nk]) {
        g[nk] = ng;
        came[nk] = k;
        heap.push(ng + hfun(nk), nk);
      }
    }
  }
  if (!found) return fail(cls === 'track' ? 'No route: the terrain is too steep or blocked' : `No route within a ${Math.round(maxG * 100)}% grade: try a gravel track (18%)`);

  const path: number[] = [];
  for (let k = goal; k !== -1; k = came[k]) path.push(k);
  path.reverse();
  let pts: [number, number][] = path.map((k) => t.toWorld(k % W, (k / W) | 0));
  pts[0] = a;
  pts[pts.length - 1] = b;
  pts = stringPull(w, pts, maxG, blocked);
  pts = chaikin(pts, 2);
  pts[0] = a;
  pts[pts.length - 1] = b;

  let length = 0, maxGrade = 0, gradeSum = 0, forest = 0, prot = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const dh = Math.abs(t.heightAt(pts[i + 1][0], pts[i + 1][1]) - t.heightAt(pts[i][0], pts[i][1]));
    length += d;
    if (d > 0) {
      maxGrade = Math.max(maxGrade, dh / d);
      gradeSum += dh;
    }
  }
  for (const k of path) {
    if (t.mask[k] & MASK.forest) forest++;
    if (t.mask[k] & MASK.protected) prot++;
  }
  const avgGrade = length > 0 ? gradeSum / length : 0;
  const realLength = length / t.hs;
  const cost = Math.round(realLength * rc.costPerM * (1 + 2.5 * avgGrade) * w.costIndex() * (1 + (prot / Math.max(1, path.length)) * 0.3));
  const days = Math.max(10, Math.round((realLength / 1000) * rc.daysPerKm));
  return { ok: true, cls, pts, length, cost, maxGrade: Math.min(maxGrade, maxG), avgGrade, days, forestCells: forest, protectedCells: prot };
}

function snapToRoad(w: World, p: [number, number]): [number, number] {
  let best = p, bd = 30;
  for (const r of w.roadsNear(p[0], p[1], 30)) {
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i];
      const [bx, bz] = r.pts[i + 1];
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz;
      const tt = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / l2)) : 0;
      const q: [number, number] = [ax + tt * dx, az + tt * dz];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < bd) (bd = d), (best = q);
    }
  }
  return best;
}

/** Remove zig-zags: skip intermediate points when the straight line stays on land, unblocked and within grade. */
function stringPull(w: World, pts: [number, number][], maxG: number, blocked: Uint8Array): [number, number][] {
  const t = w.terrain;
  const ok = (p: [number, number], q: [number, number]) => {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const n = Math.max(2, Math.ceil(d / (t.cell * 0.5)));
    let prevH = t.heightAt(p[0], p[1]);
    for (let s = 1; s <= n; s++) {
      const x = p[0] + ((q[0] - p[0]) * s) / n;
      const z = p[1] + ((q[1] - p[1]) * s) / n;
      const k = t.idx(x, z);
      if ((t.mask[k] & 3) !== MASK.territory || blocked[k]) return false;
      const h = t.heightAt(x, z);
      if (Math.abs(h - prevH) / (d / n) > maxG * 0.97) return false;
      prevH = h;
    }
    return true;
  };
  const out: [number, number][] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = Math.min(pts.length - 1, i + 24);
    while (j > i + 1 && !ok(pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

function chaikin(pts: [number, number][], iters: number): [number, number][] {
  let p = pts;
  for (let it = 0; it < iters; it++) {
    if (p.length < 3) return p;
    const q: [number, number][] = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[i + 1];
      q.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}
