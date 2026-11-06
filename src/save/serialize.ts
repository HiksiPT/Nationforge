// Save format: a versioned envelope with a checksum around the JSON game state. Byte grids are run-length
// encoded. Pure functions (no browser APIs) so they are unit tested.

import { hashString } from '../sim/rng';
import { SAVE_VERSION, type GameState } from '../sim/types';

export interface SaveEnvelope {
  format: 'nationforge-save';
  version: number;
  savedAt: string;
  name: string;
  scenario: string;
  nation: string;
  day: number;
  pop: number;
  checksum: number;
  payload: string;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2] ?? 'A') & 63) << 6) | (B64.indexOf(clean[i + 3] ?? 'A') & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** Run-length encode bytes as (value, count<=255) pairs. */
export function rleEncode(a: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < a.length) {
    const v = a[i];
    let n = 1;
    while (i + n < a.length && a[i + n] === v && n < 255) n++;
    out.push(v, n);
    i += n;
  }
  return new Uint8Array(out);
}

export function rleDecode(a: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let o = 0;
  for (let i = 0; i + 1 < a.length; i += 2) {
    out.fill(a[i], o, Math.min(length, o + a[i + 1]));
    o += a[i + 1];
  }
  return out;
}

export function serializeState(st: GameState): string {
  return JSON.stringify(st, (_k, v) => {
    if (v instanceof Uint8Array) return { __u8: toBase64(rleEncode(v)), n: v.length };
    if (typeof v === 'number' && !Number.isFinite(v)) return 0;
    return v;
  });
}

export function deserializeState(json: string): GameState {
  return JSON.parse(json, (_k, v) => {
    if (v && typeof v === 'object' && typeof v.__u8 === 'string') return rleDecode(fromBase64(v.__u8), v.n);
    return v;
  });
}

export function makeEnvelope(st: GameState, name: string): SaveEnvelope {
  const payload = serializeState(st);
  return {
    format: 'nationforge-save',
    version: st.version,
    savedAt: new Date().toISOString(),
    name,
    scenario: st.scenario,
    nation: st.nation.name,
    day: st.day,
    pop: st.pop,
    checksum: hashString(payload),
    payload,
  };
}

export class SaveError extends Error {}

/** Older save versions are upgraded step by step. */
const MIGRATIONS: Record<number, (s: any) => any> = {
  1: (s) => ({ ...s, version: 2, modifiers: s.modifiers ?? [], exportsTotal: s.exportsTotal ?? {} }),
  2: (s) => ({ ...s, version: 3, lastAutosaveDay: s.lastAutosaveDay ?? s.day, tutorialStep: s.tutorialStep ?? -1 }),
  3: (s) => ({ ...s, version: 4, legacy: s.legacy ?? { power: 0.03 + s.pop * 0.0012, water: 40 + s.pop * 4.5, jobs: 0 } }),
};

export function openEnvelope(text: string): GameState {
  let env: SaveEnvelope;
  try {
    env = JSON.parse(text);
  } catch {
    throw new SaveError('The save file is not valid JSON (it may be truncated).');
  }
  if (!env || env.format !== 'nationforge-save' || typeof env.payload !== 'string') throw new SaveError('Not a Nationforge save.');
  if (hashString(env.payload) !== env.checksum) throw new SaveError('Checksum mismatch: the save is corrupted.');
  if (env.version > SAVE_VERSION) throw new SaveError(`Save is from a newer version (${env.version}).`);
  let st: any;
  try {
    st = deserializeState(env.payload);
  } catch {
    throw new SaveError('The save data could not be decoded.');
  }
  while (st.version < SAVE_VERSION) {
    const m = MIGRATIONS[st.version];
    if (!m) throw new SaveError(`No upgrade path from save version ${st.version}.`);
    st = m(st);
  }
  validateState(st);
  return st as GameState;
}

export function validateState(st: any) {
  const need = ['scenario', 'day', 'treasury', 'buildings', 'roads', 'zones', 'cleared', 'policy', 'history', 'countries', 'regions'];
  for (const k of need) if (st[k] == null) throw new SaveError(`Save is missing "${k}".`);
  if (!Array.isArray(st.buildings) || !Array.isArray(st.roads)) throw new SaveError('Save has a broken building list.');
  if (!(st.zones instanceof Uint8Array)) throw new SaveError('Save has a broken zone grid.');
}
