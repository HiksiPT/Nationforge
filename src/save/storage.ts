// Save slots in IndexedDB (falls back to localStorage). Each write keeps the previous copy as a backup,
// so a corrupted or interrupted save can be recovered.

import { makeEnvelope, openEnvelope, SaveError, type SaveEnvelope } from './serialize';
import type { GameState } from '../sim/types';

const DB = 'nationforge';
const STORE = 'saves';
const LS_PREFIX = 'nationforge.save.';

export interface SlotInfo {
  slot: string;
  name: string;
  nation: string;
  scenario: string;
  day: number;
  pop: number;
  savedAt: string;
  ok: boolean;
  backup: boolean;
  error?: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function rawGet(key: string): Promise<string | null> {
  const d = await db();
  if (d) {
    return new Promise((resolve) => {
      try {
        const tx = d.transaction(STORE, 'readonly');
        const r = tx.objectStore(STORE).get(key);
        r.onsuccess = () => resolve((r.result as string) ?? null);
        r.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  try {
    return localStorage.getItem(LS_PREFIX + key);
  } catch {
    return null;
  }
}

async function rawSet(key: string, value: string | null): Promise<void> {
  const d = await db();
  if (d) {
    return new Promise((resolve, reject) => {
      try {
        const tx = d.transaction(STORE, 'readwrite');
        const s = tx.objectStore(STORE);
        if (value == null) s.delete(key);
        else s.put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      } catch (e) {
        reject(e);
      }
    });
  }
  try {
    if (value == null) localStorage.removeItem(LS_PREFIX + key);
    else localStorage.setItem(LS_PREFIX + key, value);
  } catch (e) {
    throw new SaveError('Browser storage is full or unavailable.');
  }
}

async function rawKeys(): Promise<string[]> {
  const d = await db();
  if (d) {
    return new Promise((resolve) => {
      try {
        const tx = d.transaction(STORE, 'readonly');
        const r = tx.objectStore(STORE).getAllKeys();
        r.onsuccess = () => resolve((r.result as IDBValidKey[]).map(String));
        r.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) out.push(k.slice(LS_PREFIX.length));
    }
  } catch {
    /* storage blocked */
  }
  return out;
}

export async function saveGame(slot: string, st: GameState, name: string): Promise<void> {
  const env = makeEnvelope(st, name);
  const text = JSON.stringify(env);
  const prev = await rawGet(slot);
  if (prev) await rawSet(slot + '.bak', prev);
  await rawSet(slot, text);
  // verify the write round-trips before trusting it
  const back = await rawGet(slot);
  if (back !== text) throw new SaveError('The save could not be verified after writing.');
}

export async function loadGame(slot: string): Promise<{ state: GameState; recovered: boolean }> {
  const text = await rawGet(slot);
  try {
    if (!text) throw new SaveError('Empty slot');
    return { state: openEnvelope(text), recovered: false };
  } catch (e) {
    const bak = await rawGet(slot + '.bak');
    if (bak) {
      const state = openEnvelope(bak);
      return { state, recovered: true };
    }
    throw e;
  }
}

export async function deleteSlot(slot: string): Promise<void> {
  await rawSet(slot, null);
  await rawSet(slot + '.bak', null);
}

export async function listSlots(): Promise<SlotInfo[]> {
  const keys = (await rawKeys()).filter((k) => !k.endsWith('.bak'));
  const out: SlotInfo[] = [];
  for (const slot of keys) {
    const text = await rawGet(slot);
    const hasBak = !!(await rawGet(slot + '.bak'));
    try {
      openEnvelope(text ?? '');
      const env = JSON.parse(text!) as SaveEnvelope;
      out.push({ slot, name: env.name, nation: env.nation, scenario: env.scenario, day: env.day, pop: env.pop, savedAt: env.savedAt, ok: true, backup: hasBak });
    } catch (e) {
      out.push({ slot, name: slot, nation: '?', scenario: '?', day: 0, pop: 0, savedAt: '', ok: false, backup: hasBak, error: (e as Error).message });
    }
  }
  out.sort((a, b) => (b.savedAt > a.savedAt ? 1 : -1));
  return out;
}

export async function exportSlot(slot: string): Promise<string | null> {
  return rawGet(slot);
}

export async function importText(slot: string, text: string): Promise<void> {
  openEnvelope(text); // throws if invalid
  await rawSet(slot, text);
}

/** Write raw text into a slot (used by the corruption-recovery test in the dev panel). */
export async function writeRaw(slot: string, text: string): Promise<void> {
  await rawSet(slot, text);
}
