// Real-world terrain grid in game space. Pure TypeScript (no three.js) so the simulation and tests can use it.
//
// Coordinates: world x = east, world z = south (three.js convention, -z is north), origin at the map centre,
// units are GAME metres = real metres x hscale horizontally and x vscale vertically. Depths used for gameplay
// (ship draught, dredging) stay in REAL metres because ships are not scaled.

export const MASK = {
  classMask: 3,
  sea: 0,
  foreign: 1,
  territory: 2,
  protected: 4,
  forest: 8,
  reef: 16,
  beach: 32,
  community: 64,
  approx: 128,
} as const;

export interface OsmRoad { cls: string; name?: string | null; pts: [number, number][] }
export interface OsmPlace { name: string; local: string; kind: string; p: [number, number]; ele: number | null }

export interface TerrainMeta {
  id: string;
  name: string;
  country: string;
  format: number;
  width: number;
  height: number;
  cellReal: number;
  hscale: number;
  vscale: number;
  verticalExaggeration: number;
  center: [number, number];
  bbox: [number, number, number, number];
  stats: Record<string, number>;
  sources: Record<string, any>;
  approximations: string[];
  osm: {
    roads: OsmRoad[];
    places: OsmPlace[];
    pois: { kind: string; name?: string | null; p: [number, number] }[];
    buildings: [number, number][];
    outline: [number, number][][];
  };
  /** Set when the real package could not be loaded and the built-in fallback was used. */
  fallback?: string;
}

export class Terrain {
  readonly W: number;
  readonly H: number;
  /** Game metres per grid cell. */
  readonly cell: number;
  readonly hs: number;
  readonly vs: number;
  /** Game-space heights (metres x vscale). */
  readonly heights: Float32Array;
  /** Real-world heights in metres. */
  readonly real: Float32Array;
  readonly mask: Uint8Array;
  readonly widthM: number;
  readonly depthM: number;
  /** Distance to the sea in game metres for land cells, to land for sea cells (approximate). */
  readonly coastDist: Float32Array;
  private slopeCache?: Float32Array;

  constructor(readonly meta: TerrainMeta, realHeights: Float32Array, mask: Uint8Array) {
    this.W = meta.width;
    this.H = meta.height;
    this.hs = meta.hscale;
    this.vs = meta.vscale;
    this.cell = meta.cellReal * meta.hscale;
    this.real = realHeights;
    this.mask = mask;
    this.heights = new Float32Array(realHeights.length);
    for (let i = 0; i < realHeights.length; i++) this.heights[i] = realHeights[i] * this.vs;
    this.widthM = this.W * this.cell;
    this.depthM = this.H * this.cell;
    this.coastDist = this.computeCoastDistance();
  }

  static fromBuffers(meta: TerrainMeta, terrainBuf: ArrayBuffer, maskBuf: ArrayBuffer): Terrain {
    const i16 = new Int16Array(terrainBuf);
    const real = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) real[i] = i16[i] / 4;
    return new Terrain(meta, real, new Uint8Array(maskBuf));
  }

  // ---- coordinate transforms
  toGrid(x: number, z: number): [number, number] {
    return [x / this.cell + this.W / 2 - 0.5, z / this.cell + this.H / 2 - 0.5];
  }

  toWorld(fx: number, fy: number): [number, number] {
    return [(fx + 0.5 - this.W / 2) * this.cell, (fy + 0.5 - this.H / 2) * this.cell];
  }

  inBounds(x: number, z: number): boolean {
    return Math.abs(x) < this.widthM / 2 - this.cell && Math.abs(z) < this.depthM / 2 - this.cell;
  }

  idx(x: number, z: number): number {
    const [fx, fy] = this.toGrid(x, z);
    const i = Math.min(this.W - 1, Math.max(0, Math.round(fx)));
    const j = Math.min(this.H - 1, Math.max(0, Math.round(fy)));
    return j * this.W + i;
  }

  private sampleArr(arr: Float32Array, x: number, z: number): number {
    let [fx, fy] = this.toGrid(x, z);
    fx = Math.min(this.W - 1.001, Math.max(0, fx));
    fy = Math.min(this.H - 1.001, Math.max(0, fy));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const W = this.W;
    const a = arr[j * W + i];
    const b = arr[j * W + i + 1];
    const c = arr[(j + 1) * W + i];
    const d = arr[(j + 1) * W + i + 1];
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  }

  /** Game-space ground height (metres). Sea floor is negative. */
  heightAt(x: number, z: number): number {
    return this.sampleArr(this.heights, x, z);
  }

  /** Real-world elevation (metres); negative values are real water depth. */
  realAt(x: number, z: number): number {
    return this.sampleArr(this.real, x, z);
  }

  /** Ground height for placing things, never below the water surface. */
  surfaceAt(x: number, z: number): number {
    return Math.max(0, this.heightAt(x, z));
  }

  classAt(x: number, z: number): number {
    return this.mask[this.idx(x, z)] & MASK.classMask;
  }

  flagsAt(x: number, z: number): number {
    return this.mask[this.idx(x, z)];
  }

  isLand(x: number, z: number): boolean {
    return this.classAt(x, z) !== MASK.sea;
  }

  isTerritory(x: number, z: number): boolean {
    return this.classAt(x, z) === MASK.territory;
  }

  /** Slope in degrees of the game-space surface. */
  slopeAt(x: number, z: number): number {
    const d = this.cell;
    const hx = (this.heightAt(x + d, z) - this.heightAt(x - d, z)) / (2 * d);
    const hz = (this.heightAt(x, z + d) - this.heightAt(x, z - d)) / (2 * d);
    return (Math.atan(Math.hypot(hx, hz)) * 180) / Math.PI;
  }

  /** Slope per grid cell (degrees), cached. */
  slopeGrid(): Float32Array {
    if (this.slopeCache) return this.slopeCache;
    const { W, H, heights, cell } = this;
    const s = new Float32Array(W * H);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const l = heights[j * W + Math.max(0, i - 1)];
        const r = heights[j * W + Math.min(W - 1, i + 1)];
        const u = heights[Math.max(0, j - 1) * W + i];
        const dn = heights[Math.min(H - 1, j + 1) * W + i];
        s[j * W + i] = (Math.atan(Math.hypot((r - l) / (2 * cell), (dn - u) / (2 * cell))) * 180) / Math.PI;
      }
    }
    this.slopeCache = s;
    return s;
  }

  coastDistAt(x: number, z: number): number {
    return this.coastDist[this.idx(x, z)];
  }

  /** Two-pass chamfer distance to the nearest cell of the other class (land vs sea), in game metres. */
  private computeCoastDistance(): Float32Array {
    const { W, H, cell } = this;
    const d = new Float32Array(W * H);
    const land = (k: number) => (this.mask[k] & 3) !== 0;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        const l = land(k);
        let edge = false;
        if (i > 0 && land(k - 1) !== l) edge = true;
        else if (i < W - 1 && land(k + 1) !== l) edge = true;
        else if (j > 0 && land(k - W) !== l) edge = true;
        else if (j < H - 1 && land(k + W) !== l) edge = true;
        d[k] = edge ? 0.5 : 1e9;
      }
    }
    const D = 1.4142;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        let v = d[k];
        if (i > 0) v = Math.min(v, d[k - 1] + 1);
        if (j > 0) {
          v = Math.min(v, d[k - W] + 1);
          if (i > 0) v = Math.min(v, d[k - W - 1] + D);
          if (i < W - 1) v = Math.min(v, d[k - W + 1] + D);
        }
        d[k] = v;
      }
    }
    for (let j = H - 1; j >= 0; j--) {
      for (let i = W - 1; i >= 0; i--) {
        const k = j * W + i;
        let v = d[k];
        if (i < W - 1) v = Math.min(v, d[k + 1] + 1);
        if (j < H - 1) {
          v = Math.min(v, d[k + W] + 1);
          if (i < W - 1) v = Math.min(v, d[k + W + 1] + D);
          if (i > 0) v = Math.min(v, d[k + W - 1] + D);
        }
        d[k] = v;
      }
    }
    for (let k = 0; k < d.length; k++) d[k] *= cell;
    return d;
  }

  /** Map grid-unit OSM coordinates to world x/z. */
  osmToWorld(p: [number, number]): [number, number] {
    return this.toWorld(p[0], p[1]);
  }
}

/**
 * Fallback terrain built from the island outline stored in the scenario (real coastline polygon, coarse).
 * Used only when the DEM package cannot be loaded; heights are a smooth dome inside the real outline and
 * the result is clearly labelled in the UI.
 */
export function buildFallbackTerrain(meta: TerrainMeta, reason: string): Terrain {
  const W = meta.width;
  const H = meta.height;
  const mask = new Uint8Array(W * H);
  const real = new Float32Array(W * H);
  const rings = meta.osm.outline;
  const inside = (x: number, y: number) => {
    let c = false;
    for (const r of rings) {
      for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
        const [xa, ya] = r[a];
        const [xb, yb] = r[b];
        if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) c = !c;
      }
    }
    return c;
  };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) mask[j * W + i] = inside(i, j) ? MASK.territory | MASK.approx : MASK.approx;
  const t = new Terrain({ ...meta, fallback: reason }, real, mask);
  const peak = meta.stats.maxElevation || 100;
  let maxD = 1;
  for (let k = 0; k < W * H; k++) if (mask[k] & 3) maxD = Math.max(maxD, t.coastDist[k]);
  for (let k = 0; k < W * H; k++) {
    const d = t.coastDist[k];
    real[k] = mask[k] & 3 ? 0.8 + peak * Math.pow(Math.min(1, d / maxD), 0.8) : -Math.min(60, 1 + (d / meta.hscale) * 0.03);
  }
  return new Terrain({ ...meta, fallback: reason }, real, mask);
}
