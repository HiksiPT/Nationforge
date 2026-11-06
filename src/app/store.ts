// Application state outside the simulation: screens, tools, selection, panels, settings, speed.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { World } from '../sim/world';
import { loadSettings, saveSettings, type Settings } from './settings';
import type { ZoneId } from '../data/catalogue';
import type { RoadSeg } from '../sim/types';
import type { PlacementResult } from '../sim/placement';
import type { RoadPlan } from '../sim/roads';

export type PendingAction =
  | { kind: 'building'; type: string; x: number; z: number; rot: number; result: PlacementResult }
  | { kind: 'road'; plan: RoadPlan };

export type Tool =
  | { kind: 'select' }
  | { kind: 'build'; type: string }
  | { kind: 'road'; cls: RoadSeg['cls'] }
  | { kind: 'zone'; zone: ZoneId | null }
  | { kind: 'bulldoze' };

export type Panel =
  | 'economy' | 'government' | 'population' | 'trade' | 'regions' | 'environment' | 'research' | 'objectives'
  | 'ports' | 'geo' | 'settings' | 'saves' | 'help' | 'log' | null;

export type Selection =
  | { kind: 'building'; id: number }
  | { kind: 'road'; id: number }
  | { kind: 'terrain'; x: number; z: number }
  | { kind: 'site'; x: number; z: number }
  | null;

export type Overlay =
  | 'none' | 'terrain' | 'slope' | 'roads' | 'population' | 'landvalue' | 'employment' | 'industry' | 'resources'
  | 'power' | 'water' | 'environment' | 'regions' | 'projects' | 'zones' | 'buildable';

export interface PendingConfirm {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

export interface AppState {
  screen: 'menu' | 'loading' | 'game';
  loadingText: string;
  loadingError: string | null;
  world: World | null;
  settings: Settings;
  speed: number; // 0 paused, 1..4
  tool: Tool;
  selection: Selection;
  panel: Panel;
  overlay: Overlay;
  brush: number; // zone brush radius in game metres
  rotation: number; // build rotation (radians)
  confirm: PendingConfirm | null;
  view: 'map' | 'firstperson';
  cameraCmd: { kind: 'focus'; x: number; z: number; dist?: number; n: number } | { kind: 'preset'; preset: 'national' | 'regional' | 'city'; n: number } | null;
  toast: { text: string; kind: 'ok' | 'err'; n: number } | null;
  slot: string | null; // last save slot used
  portFocus: string; // port type used in the planner
  pending: PendingAction | null; // placement waiting for confirm/cancel
  hover: PlacementResult | null; // live evaluation under the cursor
  roadStart: [number, number] | null;
}

type Listener = () => void;

class Store {
  state: AppState;
  private listeners = new Set<Listener>();
  constructor() {
    this.state = {
      screen: 'menu',
      loadingText: '',
      loadingError: null,
      world: null,
      settings: loadSettings(),
      speed: 1,
      tool: { kind: 'select' },
      selection: null,
      panel: null,
      overlay: 'none',
      brush: 60,
      rotation: 0,
      confirm: null,
      view: 'map',
      cameraCmd: null,
      toast: null,
      slot: null,
      portFocus: 'small_harbour',
      pending: null,
      hover: null,
      roadStart: null,
    };
  }
  get() {
    return this.state;
  }
  set(p: Partial<AppState>) {
    this.state = { ...this.state, ...p };
    if (p.settings) saveSettings(p.settings);
    for (const l of this.listeners) l();
  }
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  toast(text: string, kind: 'ok' | 'err' = 'ok') {
    this.set({ toast: { text, kind, n: Date.now() } });
  }
  focus(x: number, z: number, dist?: number) {
    this.set({ cameraCmd: { kind: 'focus', x, z, dist, n: Date.now() } });
  }
  askConfirm(c: PendingConfirm) {
    if (!this.state.settings.confirmDestructive && c.danger) c.onConfirm();
    else this.set({ confirm: c });
  }
}

export const store = new Store();

export function useApp<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(store.state));
}

/** Re-render when the world changes, at most every `ms` milliseconds. */
export function useWorld(ms = 250): World | null {
  const world = useApp((s) => s.world);
  const [, setTick] = useState(0);
  const last = useRef(0);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!world) return;
    const un = world.subscribe(() => {
      const now = performance.now();
      if (now - last.current >= ms) {
        last.current = now;
        setTick((t) => t + 1);
      } else if (timer.current == null) {
        timer.current = window.setTimeout(() => {
          timer.current = null;
          last.current = performance.now();
          setTick((t) => t + 1);
        }, ms - (now - last.current));
      }
    });
    return () => {
      un();
      if (timer.current != null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [world, ms]);
  return world;
}
