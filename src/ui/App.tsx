import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { store, useApp } from '../app/store';
import { saveToSlot } from '../app/game';
import { SceneRoot } from '../render/Scene';
import { renderRefs } from '../render/refs';
import { exitFirstPerson } from '../render/FirstPerson';
import { audio } from '../audio/audio';
import { MainMenu } from './MainMenu';
import { ConfirmDialog, Drawer, EventModal, FirstPersonHUD, InfoPanel, Labels, Minimap, Notifications, ObjectiveTracker, OverlayLegend, PendingPanel, Toasts, Toolbar, TopBar, Tutorial } from './HUD';

export function App() {
  const screen = useApp((s) => s.screen);
  const uiScale = useApp((s) => s.settings.uiScale);
  const settings = useApp((s) => s.settings);
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(uiScale));
  }, [uiScale]);
  useEffect(() => {
    audio.setVolumes(settings);
  }, [settings]);
  useEffect(() => {
    // the page itself never scrolls (focus or scrollIntoView could otherwise shift the whole HUD)
    const root = document.getElementById('root')!;
    const reset = () => {
      if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
      if (root.scrollTop || root.scrollLeft) root.scrollTop = root.scrollLeft = 0;
      if (document.body.scrollTop) document.body.scrollTop = 0;
    };
    window.addEventListener('scroll', reset, true);
    return () => window.removeEventListener('scroll', reset, true);
  }, []);
  useEffect(() => {
    const start = () => audio.start();
    window.addEventListener('pointerdown', start, { once: true });
    return () => window.removeEventListener('pointerdown', start);
  }, []);
  return (
    <>
      {screen === 'menu' && <MainMenu />}
      {screen === 'loading' && <Loading />}
      {screen === 'game' && <Game />}
      <ConfirmDialog />
      <Toasts />
    </>
  );
}

function Loading() {
  const text = useApp((s) => s.loadingText);
  const err = useApp((s) => s.loadingError);
  return (
    <div className="loading">
      <div className="col" style={{ alignItems: 'center', gap: 14, maxWidth: 520, textAlign: 'center' }}>
        {!err && <div className="spinner" />}
        <div className="logo" style={{ fontSize: 28 }}>NATIONFORGE</div>
        <div className={err ? 'bad' : 'muted'}>{err ?? text}</div>
        {err && <button className="btn" onClick={() => store.set({ screen: 'menu', loadingError: null })}>Back to menu</button>}
      </div>
    </div>
  );
}

function Game() {
  const world = useApp((s) => s.world)!;
  const view = useApp((s) => s.view);
  const settings = useApp((s) => s.settings);
  const selection = useApp((s) => s.selection);
  const panel = useApp((s) => s.panel);
  const dpr = Math.min(3, (window.devicePixelRatio || 1) * settings.renderScale);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const st = store.get();
      if (e.key === ' ' && st.view === 'map') {
        e.preventDefault();
        store.set({ speed: st.speed === 0 ? (lastSpeed.current || 1) : 0 });
        if (st.speed !== 0) lastSpeed.current = st.speed;
      } else if (/^[1-4]$/.test(e.key) && st.view === 'map') store.set({ speed: +e.key });
      else if ((e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveToSlot(st.slot ?? 'slot1');
      } else if ((e.key === 'm' || e.key === 'M') && st.view === 'firstperson') exitFirstPerson();
      else if (e.key === 'Escape' && st.view === 'map' && st.tool.kind === 'select' && !st.pending) store.set({ panel: null, selection: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const lastSpeed = useRef(1);
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Canvas
        key={settings.antialias ? 'aa' : 'noaa'}
        dpr={dpr}
        shadows={{ type: THREE.PCFSoftShadowMap }}
        gl={{ antialias: settings.antialias, powerPreference: 'high-performance', logarithmicDepthBuffer: false }}
        camera={{ fov: settings.fov, near: 1, far: 60000, position: [0, 2000, 3000] }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <SceneRoot world={world} />
      </Canvas>
      {view === 'map' ? (
        <div className="hud">
          <Labels />
          <TopBar />
          <Toolbar />
          {!panel && <Minimap />}
          {!panel && <ObjectiveTracker />}
          <Notifications />
          <OverlayLegend />
          <PendingPanel />
          <Tutorial />
          {selection && <InfoPanel />}
          <Drawer />
          <EventModal />
          {settings.showFps && <Stats />}
        </div>
      ) : (
        <FirstPersonHUD />
      )}
    </div>
  );
}

function Stats() {
  const [, tick] = useState(0);
  useEffect(() => {
    const h = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(h);
  }, []);
  const info = renderRefs.gl?.info;
  return (
    <div className="fps">
      {renderRefs.fps.toFixed(0)} fps · {info ? `${Math.round(info.render.triangles / 1000)}k tris · ${info.render.calls} calls` : ''} · dpr {renderRefs.gl?.getPixelRatio().toFixed(2)}
    </div>
  );
}
