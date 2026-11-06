// Oriented footprints and a bucket grid for fast overlap and proximity queries.

export interface OBB {
  x: number;
  z: number;
  hw: number; // half width (local x)
  hd: number; // half depth (local z)
  rot: number;
}

export function obbCorners(b: OBB): [number, number][] {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const pts: [number, number][] = [];
  for (const [lx, lz] of [[-b.hw, -b.hd], [b.hw, -b.hd], [b.hw, b.hd], [-b.hw, b.hd]]) {
    pts.push([b.x + lx * c + lz * s, b.z - lx * s + lz * c]);
  }
  return pts;
}

/** Local coordinates of a world point in an OBB frame. */
export function toLocal(b: OBB, x: number, z: number): [number, number] {
  const dx = x - b.x;
  const dz = z - b.z;
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  return [dx * c - dz * s, dx * s + dz * c];
}

export function pointInObb(b: OBB, x: number, z: number, pad = 0): boolean {
  const [lx, lz] = toLocal(b, x, z);
  return Math.abs(lx) <= b.hw + pad && Math.abs(lz) <= b.hd + pad;
}

/** Separating-axis overlap test for two oriented rectangles. */
export function obbOverlap(a: OBB, b: OBB, pad = 0): boolean {
  const ca = obbCorners({ ...a, hw: a.hw + pad, hd: a.hd + pad });
  const cb = obbCorners(b);
  const axes: [number, number][] = [
    [Math.cos(a.rot), -Math.sin(a.rot)],
    [Math.sin(a.rot), Math.cos(a.rot)],
    [Math.cos(b.rot), -Math.sin(b.rot)],
    [Math.sin(b.rot), Math.cos(b.rot)],
  ];
  for (const [ax, az] of axes) {
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const [x, z] of ca) {
      const p = x * ax + z * az;
      amin = Math.min(amin, p);
      amax = Math.max(amax, p);
    }
    for (const [x, z] of cb) {
      const p = x * ax + z * az;
      bmin = Math.min(bmin, p);
      bmax = Math.max(bmax, p);
    }
    if (amax < bmin || bmax < amin) return false;
  }
  return true;
}

export function distPointSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

export function distPointPolyline(px: number, pz: number, pts: [number, number][]): number {
  let d = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, distPointSeg(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return d;
}

/** Bucket grid holding item ids by area. */
export class BucketGrid {
  private map = new Map<number, number[]>();
  constructor(readonly size: number) {}

  private key(i: number, j: number) {
    return (i + 32768) * 65536 + (j + 32768);
  }

  insertRect(id: number, x0: number, z0: number, x1: number, z1: number) {
    const s = this.size;
    for (let i = Math.floor(x0 / s); i <= Math.floor(x1 / s); i++) {
      for (let j = Math.floor(z0 / s); j <= Math.floor(z1 / s); j++) {
        const k = this.key(i, j);
        let arr = this.map.get(k);
        if (!arr) this.map.set(k, (arr = []));
        arr.push(id);
      }
    }
  }

  query(x0: number, z0: number, x1: number, z1: number): Set<number> {
    const out = new Set<number>();
    const s = this.size;
    for (let i = Math.floor(x0 / s); i <= Math.floor(x1 / s); i++) {
      for (let j = Math.floor(z0 / s); j <= Math.floor(z1 / s); j++) {
        const arr = this.map.get(this.key(i, j));
        if (arr) for (const id of arr) out.add(id);
      }
    }
    return out;
  }

  clear() {
    this.map.clear();
  }
}
