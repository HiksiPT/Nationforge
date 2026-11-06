// High-level game actions used by the menus: new game, load, save, quit.

import { SCENARIO_MAP } from '../data/scenarios';
import { createGame } from '../sim/newgame';
import { World } from '../sim/world';
import type { FlagSpec } from '../sim/types';
import { loadGame, saveGame } from '../save/storage';
import { loadTerrain } from './loader';
import { store } from './store';
import { rig, renderRefs } from '../render/refs';
import { presetDistance } from '../render/CameraRig';
import { audio } from '../audio/audio';
import { advanceDay } from '../sim/engine';

function resetView(world: World) {
  rig.target.set(0, 0, 0);
  rig.dist = presetDistance(world, 'national');
  rig.yaw = 0.35;
  rig.pitch = 0.85;
  // focus the starting settlement if there is one
  const hub = world.state.buildings.find((b) => b.type === 'town_hall') ?? world.state.buildings[0];
  if (hub) store.focus(hub.x, hub.z, presetDistance(world, 'regional'));
}

export async function startNewGame(scenario: string, nationName: string, flag: FlagSpec, motto = '') {
  audio.start();
  store.set({ screen: 'loading', loadingText: `Preparing ${SCENARIO_MAP[scenario].name}…`, loadingError: null });
  try {
    const terrain = await loadTerrain(scenario, (t) => store.set({ loadingText: t }));
    store.set({ loadingText: 'Founding the nation…' });
    await new Promise((r) => setTimeout(r, 30));
    const world = createGame(terrain, { scenario, nationName, flag, motto, tutorial: store.get().settings.tutorials });
    if (terrain.meta.fallback) world.notify('warn', 'Fallback terrain in use', terrain.meta.fallback);
    enterWorld(world, null);
  } catch (e) {
    store.set({ loadingError: (e as Error).message });
  }
}

export async function loadSlot(slot: string) {
  audio.start();
  store.set({ screen: 'loading', loadingText: 'Loading save…', loadingError: null });
  try {
    const { state, recovered } = await loadGame(slot);
    const terrain = await loadTerrain(state.scenario, (t) => store.set({ loadingText: t }));
    if (state.zones.length !== terrain.W * terrain.H) throw new Error('The save does not match this map version.');
    const world = new World(terrain, state);
    enterWorld(world, slot);
    if (recovered) {
      world.notify('warn', 'Save recovered from backup', 'The latest save in this slot was damaged; the previous copy was loaded instead.');
      store.toast('Recovered from backup save', 'err');
    } else store.toast('Game loaded');
  } catch (e) {
    store.set({ loadingError: `Could not load: ${(e as Error).message}` });
  }
}

function enterWorld(world: World, slot: string | null) {
  store.set({ world, screen: 'game', speed: 1, tool: { kind: 'select' }, selection: null, panel: null, overlay: 'none', view: 'map', pending: null, hover: null, roadStart: null, confirm: null, slot });
  resetView(world);
  // developer / test hook: inspect the world and advance the simulation without the render loop
  (window as any).__nf = { world, store, rig, renderRefs, advance: (days: number) => { for (let i = 0; i < days; i++) advanceDay(world); } };
}

export async function saveToSlot(slot: string, name?: string) {
  const w = store.get().world;
  if (!w) return;
  try {
    await saveGame(slot, w.state, name ?? `${w.state.nation.name} – ${w.dateString()}`);
    store.set({ slot });
    store.toast(`Saved to "${slot}"`);
  } catch (e) {
    store.toast(`Save failed: ${(e as Error).message}`, 'err');
  }
}

export function quitToMenu() {
  store.set({ screen: 'menu', world: null, panel: null, selection: null, pending: null, view: 'map' });
  if (document.pointerLockElement) document.exitPointerLock();
}
