// Loads a terrain package from public/data/<id>/ relative to the page (works under any GitHub Pages sub-path).
// If the DEM cannot be loaded, a clearly labelled fallback built from the real OSM outline is used instead.

import { buildFallbackTerrain, Terrain, type TerrainMeta } from '../geo/terrain';
import fallbacks from '../data/fallbacks.json';

const cache = new Map<string, Terrain>();

function url(path: string) {
  return `${import.meta.env.BASE_URL}${path}`;
}

async function fetchOk(path: string): Promise<Response> {
  const r = await fetch(url(path));
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r;
}

export async function loadTerrain(id: string, onProgress?: (t: string) => void): Promise<Terrain> {
  const hit = cache.get(id);
  if (hit) return hit;
  let meta: TerrainMeta | null = null;
  try {
    onProgress?.('Loading map data…');
    meta = (await (await fetchOk(`data/${id}/meta.json`)).json()) as TerrainMeta;
    onProgress?.('Loading elevation (Copernicus GLO-30)…');
    const [tb, mb] = await Promise.all([fetchOk(`data/${id}/terrain.bin`).then((r) => r.arrayBuffer()), fetchOk(`data/${id}/mask.bin`).then((r) => r.arrayBuffer())]);
    if (tb.byteLength !== meta.width * meta.height * 2 || mb.byteLength !== meta.width * meta.height) throw new Error('Terrain package has the wrong size');
    const t = Terrain.fromBuffers(meta, tb, mb);
    cache.set(id, t);
    return t;
  } catch (e) {
    const fb = (fallbacks as unknown as Record<string, TerrainMeta>)[id];
    const m = meta ?? fb;
    if (!m) throw e;
    console.warn('Terrain package failed, using outline fallback', e);
    onProgress?.('Elevation data unavailable: building fallback from the real coastline…');
    const t = buildFallbackTerrain({ ...m, osm: { ...fb.osm, ...(meta?.osm ?? {}) } }, `DEM package could not be loaded (${(e as Error).message}). Heights are a smooth model inside the real OpenStreetMap coastline.`);
    cache.set(id, t);
    return t;
  }
}
