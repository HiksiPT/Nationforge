import { applyPreset, type Quality, type Settings } from '../../app/settings';
import { store, useApp } from '../../app/store';
import { audio } from '../../audio/audio';
import { Seg, Slider } from '../widgets';

export function SettingsPanel() {
  const s = useApp((x) => x.settings);
  const set = (p: Partial<Settings>, custom = true) => {
    const next = { ...s, ...p, ...(custom ? { quality: 'custom' as Quality } : {}) };
    store.set({ settings: next });
    audio.setVolumes(next);
  };
  const fs = !!document.fullscreenElement;
  return (
    <div className="col" style={{ gap: 14 }}>
      <section className="col" style={{ gap: 8 }}>
        <h3>Graphics</h3>
        <div className="row small">
          <span>Preset</span>
          <span className="spacer" />
          <Seg value={s.quality} options={[{ v: 'low', label: 'Low' }, { v: 'medium', label: 'Medium' }, { v: 'high', label: 'High' }, { v: 'ultra', label: 'Ultra' }, { v: 'custom', label: 'Custom' }]} onChange={(q) => store.set({ settings: applyPreset(s, q) })} />
        </div>
        <Slider label="Render scale" value={s.renderScale} min={0.5} max={1.5} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ renderScale: v })} />
        <div className="row small"><span>Shadows</span><span className="spacer" /><Seg value={s.shadows} options={[{ v: 'off', label: 'Off' }, { v: 'low', label: 'Low' }, { v: 'high', label: 'High' }, { v: 'ultra', label: 'Ultra' }]} onChange={(v) => set({ shadows: v })} /></div>
        <div className="row small"><span>Terrain detail</span><span className="spacer" /><Seg value={s.terrainDetail} options={[{ v: 'low', label: 'Low' }, { v: 'medium', label: 'Medium' }, { v: 'high', label: 'High' }, { v: 'ultra', label: 'Ultra' }]} onChange={(v) => set({ terrainDetail: v })} /></div>
        <Slider label="Vegetation density" value={s.vegetation} min={0} max={2} step={0.1} format={(v) => (v === 0 ? 'off' : `${Math.round(v * 100)}%`)} onChange={(v) => set({ vegetation: v })} />
        <Slider label="View distance" value={s.viewDistance} min={4} max={60} step={1} format={(v) => `${v} km`} onChange={(v) => set({ viewDistance: v })} />
        <label className="row small"><input type="checkbox" checked={s.weatherEffects} onChange={(e) => set({ weatherEffects: e.target.checked })} /> Weather effects (rain, fog, wind on water and trees)</label>
        <label className="row small"><input type="checkbox" checked={s.clouds} onChange={(e) => set({ clouds: e.target.checked })} /> Clouds</label>
        <label className="row small"><input type="checkbox" checked={s.antialias} onChange={(e) => set({ antialias: e.target.checked })} /> Anti-aliasing (restarts the renderer)</label>
        <div className="row small"><span>Day / night</span><span className="spacer" /><Seg value={s.dayNight} options={[{ v: 'dynamic', label: 'Dynamic' }, { v: 'day', label: 'Always day' }, { v: 'sunset', label: 'Golden hour' }]} onChange={(v) => set({ dayNight: v }, false)} /></div>
        {s.dayNight === 'dynamic' && <Slider label="Length of a visual day" value={s.dayLength} min={2} max={30} step={1} format={(v) => `${v} min`} onChange={(v) => set({ dayLength: v }, false)} />}
        <div className="row small">
          <span>Fullscreen</span>
          <span className="spacer" />
          <button className="btn sm" onClick={() => (fs ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())}>{fs ? 'Exit fullscreen' : 'Enter fullscreen'}</button>
        </div>
        <label className="row small"><input type="checkbox" checked={s.showFps} onChange={(e) => set({ showFps: e.target.checked }, false)} /> Show frame rate and renderer statistics</label>
      </section>
      <section className="col" style={{ gap: 8 }}>
        <h3>Camera & controls</h3>
        <Slider label="Field of view" value={s.fov} min={35} max={80} step={1} format={(v) => `${v}°`} onChange={(v) => set({ fov: v }, false)} />
        <Slider label="Pan speed" value={s.panSpeed} min={0.3} max={3} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => set({ panSpeed: v }, false)} />
        <Slider label="Rotate speed" value={s.rotateSpeed} min={0.3} max={3} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => set({ rotateSpeed: v }, false)} />
        <Slider label="First-person mouse sensitivity" value={s.mouseSensitivity} min={0.3} max={3} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => set({ mouseSensitivity: v }, false)} />
        <label className="row small"><input type="checkbox" checked={s.invertZoom} onChange={(e) => set({ invertZoom: e.target.checked }, false)} /> Invert mouse-wheel zoom</label>
        <label className="row small"><input type="checkbox" checked={s.edgeScroll} onChange={(e) => set({ edgeScroll: e.target.checked }, false)} /> Scroll when the mouse touches the screen edge</label>
        <div className="tiny muted">Map: drag to pan, right-drag to rotate, wheel to zoom, WASD/arrows to pan, Q/E rotate, Z/X zoom. Space pauses, 1–4 set speed, R rotates a building, Esc cancels, M leaves first-person.</div>
      </section>
      <section className="col" style={{ gap: 8 }}>
        <h3>Audio</h3>
        <Slider label="Master" value={s.masterVolume} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ masterVolume: v }, false)} />
        <Slider label="Ambience (wind, surf, rain)" value={s.ambienceVolume} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ ambienceVolume: v }, false)} />
        <Slider label="Music" value={s.musicVolume} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ musicVolume: v }, false)} />
        <Slider label="Effects" value={s.sfxVolume} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ sfxVolume: v }, false)} />
      </section>
      <section className="col" style={{ gap: 8 }}>
        <h3>Interface & game</h3>
        <Slider label="UI scale" value={s.uiScale} min={0.8} max={1.5} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ uiScale: v }, false)} />
        <label className="row small"><input type="checkbox" checked={s.showLabels} onChange={(e) => set({ showLabels: e.target.checked }, false)} /> Place names on the map</label>
        <label className="row small"><input type="checkbox" checked={s.tutorials} onChange={(e) => set({ tutorials: e.target.checked }, false)} /> Tutorial hints</label>
        <label className="row small"><input type="checkbox" checked={s.confirmDestructive} onChange={(e) => set({ confirmDestructive: e.target.checked }, false)} /> Ask before destructive actions (demolish, overwrite, delete)</label>
        <div className="row small"><span>Autosave</span><span className="spacer" /><Seg value={String(s.autosaveMonths)} options={[{ v: '0', label: 'Off' }, { v: '1', label: 'Monthly' }, { v: '3', label: 'Quarterly' }, { v: '6', label: '6 months' }, { v: '12', label: 'Yearly' }]} onChange={(v) => set({ autosaveMonths: +v }, false)} /></div>
      </section>
    </div>
  );
}
