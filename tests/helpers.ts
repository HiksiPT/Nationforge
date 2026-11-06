import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Terrain, type TerrainMeta } from '../src/geo/terrain';

const cache = new Map<string, Terrain>();

/** Load a real terrain package from public/data (the same files the browser loads). */
export function loadTerrain(id: string): Terrain {
  const hit = cache.get(id);
  if (hit) return hit;
  const dir = join(__dirname, '..', 'public', 'data', id);
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8')) as TerrainMeta;
  const tb = readFileSync(join(dir, 'terrain.bin'));
  const mb = readFileSync(join(dir, 'mask.bin'));
  const t = Terrain.fromBuffers(meta, tb.buffer.slice(tb.byteOffset, tb.byteOffset + tb.byteLength), mb.buffer.slice(mb.byteOffset, mb.byteOffset + mb.byteLength));
  cache.set(id, t);
  return t;
}
