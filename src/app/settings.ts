// Player settings, persisted in localStorage. Graphics presets set the individual options, which the
// renderer reads directly (render scale, shadows, terrain detail, vegetation, view distance, weather).

export type Quality = 'low' | 'medium' | 'high' | 'ultra' | 'custom';

export interface Settings {
  quality: Quality;
  renderScale: number; // 0.5..1.5 multiplier on device pixel ratio
  shadows: 'off' | 'low' | 'high' | 'ultra';
  terrainDetail: 'low' | 'medium' | 'high' | 'ultra';
  vegetation: number; // 0..2 density multiplier
  viewDistance: number; // km
  weatherEffects: boolean;
  clouds: boolean;
  antialias: boolean;
  dayNight: 'dynamic' | 'day' | 'sunset';
  dayLength: number; // real minutes per visual day
  // camera & controls
  fov: number;
  panSpeed: number;
  rotateSpeed: number;
  invertZoom: boolean;
  edgeScroll: boolean;
  mouseSensitivity: number; // first person
  // audio
  masterVolume: number;
  ambienceVolume: number;
  musicVolume: number;
  sfxVolume: number;
  // interface
  uiScale: number;
  tutorials: boolean;
  autosaveMonths: number; // 0 = off
  confirmDestructive: boolean;
  showLabels: boolean;
  showFps: boolean;
}

export const PRESETS: Record<Exclude<Quality, 'custom'>, Partial<Settings>> = {
  low: { renderScale: 0.7, shadows: 'off', terrainDetail: 'low', vegetation: 0.3, viewDistance: 8, weatherEffects: false, clouds: false, antialias: false },
  medium: { renderScale: 0.9, shadows: 'low', terrainDetail: 'medium', vegetation: 0.7, viewDistance: 14, weatherEffects: true, clouds: true, antialias: false },
  high: { renderScale: 1, shadows: 'high', terrainDetail: 'high', vegetation: 1, viewDistance: 22, weatherEffects: true, clouds: true, antialias: true },
  ultra: { renderScale: 1.25, shadows: 'ultra', terrainDetail: 'ultra', vegetation: 1.6, viewDistance: 40, weatherEffects: true, clouds: true, antialias: true },
};

export const DEFAULT_SETTINGS: Settings = {
  ...(PRESETS.high as Required<typeof PRESETS.high>),
  quality: 'high',
  dayNight: 'dynamic',
  dayLength: 8,
  fov: 50,
  panSpeed: 1,
  rotateSpeed: 1,
  invertZoom: false,
  edgeScroll: false,
  mouseSensitivity: 1,
  masterVolume: 0.7,
  ambienceVolume: 0.7,
  musicVolume: 0.35,
  sfxVolume: 0.7,
  uiScale: 1,
  tutorials: true,
  autosaveMonths: 3,
  confirmDestructive: true,
  showLabels: true,
  showFps: false,
} as Settings;

const KEY = 'nationforge.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: settings stay for this session */
  }
}

export function applyPreset(s: Settings, q: Quality): Settings {
  if (q === 'custom') return { ...s, quality: 'custom' };
  return { ...s, ...PRESETS[q], quality: q };
}

export const SHADOW_MAP: Record<Settings['shadows'], number> = { off: 0, low: 1024, high: 2048, ultra: 4096 };
export const TERRAIN_STEP: Record<Settings['terrainDetail'], number> = { low: 4, medium: 2, high: 1, ultra: 1 };
export const TERRAIN_LOD_SCALE: Record<Settings['terrainDetail'], number> = { low: 0.6, medium: 0.9, high: 1.3, ultra: 2.2 };
