// Tiny procedural modelling kit: flat-shaded, vertex-coloured primitives merged into one BufferGeometry.

import * as THREE from 'three';

export class Kit {
  pos: number[] = [];
  col: number[] = [];
  private c = new THREE.Color();

  private tri(a: number[], b: number[], c: number[], color: THREE.Color) {
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b);
  }

  private quad(a: number[], b: number[], c: number[], d: number[], color: THREE.Color) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  color(hex: string | number, shade = 1): THREE.Color {
    this.c.set(hex as any);
    return this.c.clone().multiplyScalar(shade);
  }

  /** Axis-aligned box centred at (x, z) with its base at y. Optional rotation around Y about its own centre. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, hex: string | number, rot = 0, opts: { top?: boolean; bottom?: boolean } = {}) {
    const col = this.color(hex);
    const hw = w / 2, hd = d / 2;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const P = (lx: number, ly: number, lz: number) => [x + lx * cs + lz * sn, y + ly, z - lx * sn + lz * cs];
    const p = [P(-hw, 0, -hd), P(hw, 0, -hd), P(hw, 0, hd), P(-hw, 0, hd), P(-hw, h, -hd), P(hw, h, -hd), P(hw, h, hd), P(-hw, h, hd)];
    const side = col.clone().multiplyScalar(0.92);
    const side2 = col.clone().multiplyScalar(0.84);
    this.quad(p[3], p[2], p[6], p[7], side); // +z
    this.quad(p[1], p[0], p[4], p[5], side); // -z
    this.quad(p[2], p[1], p[5], p[6], side2); // +x
    this.quad(p[0], p[3], p[7], p[4], side2); // -x
    if (opts.top !== false) this.quad(p[7], p[6], p[5], p[4], col);
    if (opts.bottom) this.quad(p[0], p[1], p[2], p[3], col.clone().multiplyScalar(0.6));
  }

  /** Gable roof: ridge along local x (or z when alongZ), eaves overhang included in w/d. */
  gable(x: number, y: number, z: number, w: number, d: number, h: number, hex: string | number, alongZ = false, rot = 0) {
    const col = this.color(hex);
    const end = this.color(hex, 0.8);
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const P = (lx: number, ly: number, lz: number) => {
      if (alongZ) [lx, lz] = [lz, lx];
      return [x + lx * cs + lz * sn, y + ly, z - lx * sn + lz * cs];
    };
    const [L, D] = alongZ ? [d / 2, w / 2] : [w / 2, d / 2];
    const a = P(-L, 0, -D), b = P(L, 0, -D), c = P(L, 0, D), e = P(-L, 0, D), r1 = P(-L, h, 0), r2 = P(L, h, 0);
    this.quad(b, a, r1, r2, col.clone().multiplyScalar(0.9));
    this.quad(e, c, r2, r1, col);
    this.tri(a, e, r1, end);
    this.tri(c, b, r2, end);
  }

  /** Hip roof (pyramid when square). */
  hip(x: number, y: number, z: number, w: number, d: number, h: number, hex: string | number, rot = 0) {
    const col = this.color(hex);
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const P = (lx: number, ly: number, lz: number) => [x + lx * cs + lz * sn, y + ly, z - lx * sn + lz * cs];
    const hw = w / 2, hd = d / 2;
    const ridge = Math.max(0, hw - hd);
    const a = P(-hw, 0, -hd), b = P(hw, 0, -hd), c = P(hw, 0, hd), e = P(-hw, 0, hd);
    const r1 = P(-ridge, h, 0), r2 = P(ridge, h, 0);
    this.quad(b, a, r1, r2, col.clone().multiplyScalar(0.88));
    this.quad(e, c, r2, r1, col);
    this.tri(a, e, r1, col.clone().multiplyScalar(0.8));
    this.tri(c, b, r2, col.clone().multiplyScalar(0.95));
  }

  cylinder(x: number, y: number, z: number, r: number, h: number, hex: string | number, seg = 10, r2 = r, cap = true) {
    const col = this.color(hex);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const shade = 0.82 + 0.18 * Math.cos(a0 - 0.8);
      const c = col.clone().multiplyScalar(shade);
      const p0 = [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r];
      const p1 = [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r];
      const q0 = [x + Math.cos(a0) * r2, y + h, z + Math.sin(a0) * r2];
      const q1 = [x + Math.cos(a1) * r2, y + h, z + Math.sin(a1) * r2];
      this.quad(p1, p0, q0, q1, c);
      if (cap && r2 > 0) this.tri([x, y + h, z], q1, q0, col);
    }
  }

  cone(x: number, y: number, z: number, r: number, h: number, hex: string | number, seg = 8) {
    this.cylinder(x, y, z, r, h, hex, seg, 0.001, false);
  }

  /** Low-poly blob (octahedron) for tree crowns and shrubs. */
  blob(x: number, y: number, z: number, rx: number, ry: number, hex: string | number) {
    const col = this.color(hex);
    const top = [x, y + ry, z], bot = [x, y - ry, z];
    const ring = [0, 1, 2, 3, 4, 5].map((i) => [x + Math.cos((i / 6) * Math.PI * 2) * rx, y, z + Math.sin((i / 6) * Math.PI * 2) * rx]);
    for (let i = 0; i < 6; i++) {
      const a = ring[i], b = ring[(i + 1) % 6];
      this.tri(b, a, top, col.clone().multiplyScalar(0.85 + 0.15 * Math.cos(i)));
      this.tri(a, b, bot, col.clone().multiplyScalar(0.7));
    }
  }

  /** Rows of windows on the four faces of a box. */
  windows(x: number, y: number, z: number, w: number, d: number, floors: number, floorH: number, hex: string | number, rot = 0, spacing = 4, skipFloors = 0) {
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const at = (lx: number, lz: number): [number, number] => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
    for (let f = skipFloors; f < floors; f++) {
      const wy = y + f * floorH + floorH * 0.35;
      const wh = floorH * 0.42;
      const nx = Math.max(1, Math.floor(w / spacing));
      const nz = Math.max(1, Math.floor(d / spacing));
      for (let i = 0; i < nx; i++) {
        const lx = -w / 2 + (i + 0.5) * (w / nx);
        for (const side of [-1, 1]) {
          const [px, pz] = at(lx, side * (d / 2 + 0.05));
          this.box(px, wy, pz, Math.min(1.6, (w / nx) * 0.55), wh, 0.12, hex, rot, { top: false });
        }
      }
      for (let i = 0; i < nz; i++) {
        const lz = -d / 2 + (i + 0.5) * (d / nz);
        for (const side of [-1, 1]) {
          const [px, pz] = at(side * (w / 2 + 0.05), lz);
          this.box(px, wy, pz, 0.12, wh, Math.min(1.6, (d / nz) * 0.55), hex, rot, { top: false });
        }
      }
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Deterministic pseudo-random sequence for model variation. */
export function seq(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    s ^= s >>> 13;
    return (s >>> 0) / 4294967296;
  };
}
