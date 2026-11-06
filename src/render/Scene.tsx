// The 3D scene: terrain, water, sky and lighting, buildings, roads, vegetation and weather, plus the
// fixed-step simulation clock. Heavy objects are built imperatively and handed to react-three-fiber.

import { Component, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { BUILDING_MAP } from '../data/catalogue';
import { SHADOW_MAP, TERRAIN_LOD_SCALE, TERRAIN_STEP } from '../app/settings';
import { store, useApp } from '../app/store';
import { advanceDay } from '../sim/engine';
import { dateOf } from '../sim/calendar';
import type { World } from '../sim/world';
import { breakwaterModel, craneModel, modelFor, rotorModel, scaffoldModel, VARIANTS } from './models';
import { Kit } from './kit';
import { buildColorTexture, buildTerrainGroup, depthTexture, makeOverlayTexture, terrainMaterial, waterMaterial } from './terrainMesh';
import { paintOverlay } from './overlays';
import { buildVegetation, type VegetationBuild } from './vegetation';
import { env, renderRefs, rig } from './refs';
import { CameraRig } from './CameraRig';
import { FirstPerson } from './FirstPerson';
import { ToolLayer } from './ToolLayer';
import { autosaveIfDue } from '../app/autosave';
import { audio } from '../audio/audio';

const DAYS_PER_SECOND = [0, 1, 3, 8, 20];

export function SceneRoot({ world }: { world: World }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    renderRefs.camera = camera as THREE.PerspectiveCamera;
    renderRefs.gl = gl;
    renderRefs.scene = scene;
    renderRefs.canvas = gl.domElement;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.15;
  }, [gl, scene, camera]);
  const view = useApp((s) => s.view);
  return (
    <>
      <SimClock world={world} />
      <Safe name="sky"><SkyAndLight world={world} /></Safe>
      <Safe name="terrain"><TerrainLayer world={world} /></Safe>
      <Safe name="water"><WaterLayer world={world} /></Safe>
      <Safe name="roads"><RoadsLayer world={world} /></Safe>
      <Safe name="buildings"><BuildingsLayer world={world} /></Safe>
      <Safe name="vegetation"><VegetationLayer world={world} /></Safe>
      <Safe name="weather"><WeatherLayer world={world} /></Safe>
      {view === 'map' ? <CameraRig world={world} /> : <FirstPerson world={world} />}
      {view === 'map' && <ToolLayer world={world} />}
    </>
  );
}

/** Keeps one failing render layer from taking down the whole scene; the failure is reported once. */
class Safe extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: Error) {
    console.error(`Render layer "${this.props.name}" failed`, e);
    store.toast(`The ${this.props.name} layer failed to render and was turned off`, 'err');
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// ------------------------------------------------------------------ simulation clock

function SimClock({ world }: { world: World }) {
  const acc = useRef(0);
  const fpsAcc = useRef({ t: 0, n: 0 });
  useFrame((_, dt) => {
    const f = fpsAcc.current;
    f.t += dt;
    f.n++;
    if (f.t > 0.5) {
      renderRefs.fps = f.n / f.t;
      f.t = 0;
      f.n = 0;
    }
    const st = store.get();
    const dps = DAYS_PER_SECOND[st.speed] ?? 0;
    if (dps <= 0 || st.confirm || world.state.pendingEvents.length > 0) {
      acc.current = 0;
      return;
    }
    acc.current += Math.min(dt, 0.25) * dps;
    let n = 0;
    while (acc.current >= 1 && n < 12) {
      const monthBefore = dateOf(world.state.day, world.state.startYear).month;
      advanceDay(world);
      acc.current -= 1;
      n++;
      if (dateOf(world.state.day, world.state.startYear).month !== monthBefore) autosaveIfDue(world);
    }
    if (n >= 12) acc.current = Math.min(acc.current, 1);
  });
  return null;
}

// ------------------------------------------------------------------ sky, sun, fog, stars

function SkyAndLight({ world }: { world: World }) {
  const { scene, camera } = useThree();
  const settings = useApp((s) => s.settings);
  const objs = useMemo(() => {
    const sky = new Sky();
    sky.scale.setScalar(450000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.castShadow = true;
    const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x55503f, 0.9);
    const amb = new THREE.AmbientLight(0xffffff, 0.15);
    const starsGeo = new THREE.BufferGeometry();
    const sp: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.95);
      sp.push(Math.sin(ph) * Math.cos(th) * 300000, Math.cos(ph) * 300000, Math.sin(ph) * Math.sin(th) * 300000);
    }
    starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    const stars = new THREE.Points(starsGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    const fog = new THREE.Fog(0xb8cde0, 1000, 20000);
    return { sky, sun, hemi, amb, stars, fog };
  }, []);
  useEffect(() => {
    scene.add(objs.sky, objs.sun, objs.sun.target, objs.hemi, objs.amb, objs.stars);
    scene.fog = objs.fog;
    return () => {
      scene.remove(objs.sky, objs.sun, objs.sun.target, objs.hemi, objs.amb, objs.stars);
      scene.fog = null;
    };
  }, [scene, objs]);
  useEffect(() => {
    const size = SHADOW_MAP[settings.shadows];
    objs.sun.castShadow = size > 0;
    if (size > 0) {
      objs.sun.shadow.mapSize.set(size, size);
      objs.sun.shadow.map?.dispose();
      objs.sun.shadow.map = null as any;
      objs.sun.shadow.bias = -0.0004;
      objs.sun.shadow.normalBias = 1.5;
    }
  }, [settings.shadows, objs]);

  const lat = world.terrain.meta.center[0];
  const fogCol = useMemo(() => new THREE.Color(), []);
  useFrame((_, dt) => {
    const st = store.get();
    const s = st.settings;
    // visual time of day
    if (s.dayNight === 'dynamic') env.timeOfDay = (env.timeOfDay + (dt / (s.dayLength * 60)) * 24 * (st.speed > 0 ? 1 : 0.15)) % 24;
    else env.timeOfDay = s.dayNight === 'day' ? 11 : 18.6;
    const month = dateOf(world.state.day, world.state.startYear).month;
    const decl = 23.44 * Math.sin(((month * 30.4 + 15 - 80) / 365) * Math.PI * 2);
    const noonElev = 90 - Math.abs(lat - decl);
    const hourAngle = ((env.timeOfDay - 12) / 12) * Math.PI;
    const elevAngle = Math.max(-0.5, Math.sin(((env.timeOfDay - 6) / 12) * Math.PI) * (noonElev * Math.PI) / 180);
    const az = hourAngle; // 0 at noon
    const south = lat >= 0 ? 1 : -1; // noon sun is south of northern islands
    const d = new THREE.Vector3(Math.sin(az), Math.sin(elevAngle), south * Math.cos(az) * Math.cos(elevAngle)).normalize();
    env.sunDir.copy(d);
    const day = THREE.MathUtils.smoothstep(d.y, -0.08, 0.18);
    env.daylight = day;
    objs.sky.material.uniforms.sunPosition.value.copy(d.y > -0.05 ? d : new THREE.Vector3(d.x, -0.05, d.z));
    const wx = world.state.weather;
    const overcast = s.weatherEffects ? wx.cloud : wx.cloud * 0.5;
    objs.sky.material.uniforms.turbidity.value = 3 + overcast * 9;
    objs.sky.material.uniforms.rayleigh.value = 1.2 + overcast * 1.5;
    // sun / moon
    const sunUp = d.y > 0;
    const lightDir = sunUp ? d : new THREE.Vector3(-d.x, 0.6, -d.z).normalize();
    const shadowSpan = THREE.MathUtils.clamp(rig.dist * 0.9, 250, 4000);
    objs.sun.position.copy(rig.target).addScaledVector(lightDir, shadowSpan * 2);
    objs.sun.target.position.copy(rig.target);
    const cam = objs.sun.shadow.camera;
    if (cam.right !== shadowSpan) {
      cam.left = -shadowSpan;
      cam.right = shadowSpan;
      cam.top = shadowSpan;
      cam.bottom = -shadowSpan;
      cam.near = 1;
      cam.far = shadowSpan * 5;
      cam.updateProjectionMatrix();
    }
    const warm = THREE.MathUtils.smoothstep(d.y, 0, 0.35);
    objs.sun.color.setRGB(1, 0.72 + 0.26 * warm, 0.5 + 0.45 * warm);
    objs.sun.intensity = sunUp ? (3.4 * day) * (1 - overcast * 0.45) : 0.15;
    if (!sunUp) objs.sun.color.setRGB(0.6, 0.7, 1);
    objs.hemi.intensity = 0.3 + 1.1 * day;
    objs.amb.intensity = 0.06 + 0.12 * day;
    (objs.stars.material as THREE.PointsMaterial).opacity = (1 - day) * (1 - overcast) * 0.9;
    // fog: view distance and weather
    const far = s.viewDistance * 1000;
    const fogF = s.weatherEffects ? (wx.fog > 0 ? 0.12 + (1 - wx.fog) * 0.3 : wx.kind === 'storm' ? 0.35 : wx.rain > 0.5 ? 0.65 : 1) : 1;
    // the view distance setting limits detail, but the national overview always shows the whole island
    objs.fog.far = Math.max(300, far * fogF, rig.dist * 2.2 * Math.max(0.55, fogF));
    objs.fog.near = objs.fog.far * (fogF < 0.5 ? 0.05 : 0.3);
    fogCol.setRGB(0.72, 0.8, 0.88).lerp(new THREE.Color(0.6, 0.63, 0.66), overcast).multiplyScalar(0.12 + 0.88 * day);
    if (d.y < 0.2 && d.y > -0.1) fogCol.lerp(new THREE.Color(0.85, 0.6, 0.45), 0.35 * (1 - Math.abs(d.y - 0.05) / 0.15) * day);
    objs.fog.color.copy(fogCol);
    const pc = camera as THREE.PerspectiveCamera;
    const camFar = Math.max(far * 1.3 + 2000, rig.dist * 3);
    if (Math.abs(pc.far - camFar) > 50) {
      pc.far = camFar;
      pc.updateProjectionMatrix();
    }
    if (pc.fov !== s.fov && store.get().view === 'map') {
      pc.fov = s.fov;
      pc.updateProjectionMatrix();
    }
    // water and vegetation uniforms
    const wm = water.material;
    if (wm) {
      wm.uniforms.sunDir.value.copy(lightDir);
      wm.uniforms.light.value = 0.15 + 0.85 * day;
      wm.uniforms.skyColor.value.copy(fogCol);
      wm.uniforms.wave.value = 0.5 + Math.min(2.5, wx.wind / 7);
      wm.uniforms.windDir.value.set(Math.sin(wx.windDir), -Math.cos(wx.windDir));
      wm.uniforms.time.value += dt;
    }
    if (veg.uniforms) {
      veg.uniforms.time.value += dt;
      veg.uniforms.wind.value = s.weatherEffects ? 0.4 + wx.wind / 6 : 0.4;
    }
  });
  return null;
}

// shared handles between layers
const water: { material: THREE.ShaderMaterial | null } = { material: null };
const veg: { uniforms: { time: { value: number }; wind: { value: number } } | null } = { uniforms: null };
export const overlayHandle: { tex: THREE.DataTexture | null; mat: THREE.MeshStandardMaterial | null } = { tex: null, mat: null };

// ------------------------------------------------------------------ terrain

function TerrainLayer({ world }: { world: World }) {
  const { scene } = useThree();
  const detail = useApp((s) => s.settings.terrainDetail);
  const shadows = useApp((s) => s.settings.shadows);
  const overlay = useApp((s) => s.overlay);
  const tool = useApp((s) => s.tool);
  const t = world.terrain;
  const base = useMemo(() => {
    const color = buildColorTexture(t, world.scenario);
    const ov = makeOverlayTexture(t);
    const mat = terrainMaterial(color, ov);
    overlayHandle.tex = ov;
    overlayHandle.mat = mat;
    return { color, ov, mat };
  }, [t, world.scenario]);
  useEffect(() => {
    const g = buildTerrainGroup(t, base.mat, TERRAIN_STEP[detail], TERRAIN_LOD_SCALE[detail], shadows !== 'off');
    scene.add(g);
    return () => {
      scene.remove(g);
      g.traverse((o) => {
        if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
      });
    };
  }, [t, base, detail, shadows, scene]);
  // overlay texture: repaint on mode change and on world changes (throttled)
  const effective = tool.kind === 'zone' ? 'zones' : tool.kind === 'road' && overlay === 'none' ? 'none' : overlay;
  useEffect(() => {
    let last = 0;
    let timer: number | null = null;
    const paint = () => {
      paintOverlay(world, effective, base.ov.image.data as Uint8Array);
      base.ov.needsUpdate = true;
      base.mat.userData.uniforms.overlayStrength.value = effective === 'none' ? 0 : 0.75;
      last = performance.now();
    };
    paint();
    const un = world.subscribe(() => {
      if (effective === 'none') return;
      const wait = effective === 'zones' ? 120 : 1500;
      if (performance.now() - last > wait) paint();
      else if (timer == null) timer = window.setTimeout(() => ((timer = null), paint()), wait);
    });
    return () => {
      un();
      if (timer != null) clearTimeout(timer);
    };
  }, [world, effective, base]);
  return null;
}

// ------------------------------------------------------------------ water

function WaterLayer({ world }: { world: World }) {
  const t = world.terrain;
  const { mesh } = useMemo(() => {
    const mat = waterMaterial(t, world.scenario, depthTexture(t));
    water.material = mat;
    const size = Math.max(t.widthM, t.depthM) * 14;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 2;
    m.name = 'water';
    return { mesh: m };
  }, [t, world.scenario]);
  return <primitive object={mesh} />;
}

// ------------------------------------------------------------------ roads

function RoadsLayer({ world }: { world: World }) {
  const { scene } = useThree();
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }), []);
  useEffect(() => {
    let mesh: THREE.Mesh | null = null;
    let lastV = -1;
    const rebuild = () => {
      if (world.structureVersion === lastV) return;
      lastV = world.structureVersion;
      if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
      }
      mesh = new THREE.Mesh(roadGeometry(world), mat);
      mesh.receiveShadow = true;
      mesh.name = 'roads';
      scene.add(mesh);
    };
    rebuild();
    const un = world.subscribe(rebuild);
    return () => {
      un();
      if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
      }
    };
  }, [world, scene, mat]);
  return null;
}

function roadGeometry(world: World): THREE.BufferGeometry {
  const t = world.terrain;
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (const r of world.state.roads) {
    const width = r.cls === 'avenue' ? 12 : r.cls === 'road' ? 7 : 4;
    const pts = densify(r.pts, Math.max(4, t.cell * 0.5));
    if (r.status === 'construction') c.set('#c9a64a');
    else c.set(r.cls === 'track' ? '#9c8a68' : r.cls === 'avenue' ? '#45484b' : '#4d5053');
    const built = r.status === 'construction' ? Math.max(1, Math.floor(pts.length * r.progress)) : pts.length;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const dx = bx - ax, dz = bz - az;
      const l = Math.hypot(dx, dz) || 1;
      const nx = (-dz / l) * (width / 2), nz = (dx / l) * (width / 2);
      const y = (x: number, z: number) => Math.max(0.3, t.heightAt(x, z), t.heightAt(x + nx, z + nz), t.heightAt(x - nx, z - nz)) + 0.35;
      const ya = y(ax, az), yb = y(bx, bz);
      const cc = i < built ? c : new THREE.Color('#b59a62');
      const quad = [ax + nx, ya, az + nz, ax - nx, ya, az - nz, bx - nx, yb, bz - nz, ax + nx, ya, az + nz, bx - nx, yb, bz - nz, bx + nx, yb, bz + nz];
      pos.push(...quad);
      for (let k = 0; k < 6; k++) col.push(cc.r, cc.g, cc.b);
      // centre line on paved roads
      if (r.cls !== 'track' && r.status === 'active' && i % 3 === 0) {
        const lx = (-dz / l) * 0.15, lz = (dx / l) * 0.15;
        const mx = ax + dx * 0.5, mz = az + dz * 0.5;
        const ym = Math.max(ya, yb) + 0.03;
        pos.push(ax + lx, ym, az + lz, ax - lx, ym, az - lz, mx - lx, ym, mz - lz, ax + lx, ym, az + lz, mx - lx, ym, mz - lz, mx + lx, ym, mz + lz);
        for (let k = 0; k < 6; k++) col.push(0.92, 0.9, 0.8);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function densify(pts: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  if (pts.length) out.push(pts[pts.length - 1]);
  return out;
}

// ------------------------------------------------------------------ buildings

const buildingMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02, side: THREE.DoubleSide });
const foundationGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0);
const foundationMat = new THREE.MeshStandardMaterial({ color: '#8f877a', roughness: 1 });

/** Base height for a building: the highest ground under its footprint (never below sea level for ports). */
export function baseHeight(world: World, b: { type: string; x: number; z: number; rot: number }): { y: number; low: number } {
  const t = world.terrain;
  const d = BUILDING_MAP[b.type];
  if (d.site === 'sea') return { y: 0, low: 0 };
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  let hi = -Infinity, lo = Infinity;
  for (const fx of [-0.45, 0, 0.45]) for (const fz of [-0.45, 0, 0.45]) {
    const lx = fx * d.size[0], lz = fz * d.size[1];
    if (d.port && fz > 0) continue;
    const h = t.surfaceAt(b.x + lx * c + lz * s, b.z - lx * s + lz * c);
    hi = Math.max(hi, h);
    lo = Math.min(lo, h);
  }
  if (d.port) return { y: Math.max(0, Math.min(hi, 3)), low: Math.min(lo, 0) - 4 };
  return { y: hi, low: lo };
}

function BuildingsLayer({ world }: { world: World }) {
  const { scene } = useThree();
  const shadows = useApp((s) => s.settings.shadows);
  const state = useRef<{ group: THREE.Group; rotors: THREE.InstancedMesh | null; rotorData: { pos: THREE.Vector3; rot: number; scale: number }[]; scaffolds: { mesh: THREE.InstancedMesh; ids: number[] }[]; ships: THREE.InstancedMesh | null; shipData: { x: number; z: number; nx: number; nz: number; len: number; phase: number }[] } | null>(null);
  useEffect(() => {
    let lastStruct = -1;
    let lastProgress = 0;
    const group = new THREE.Group();
    group.name = 'buildings';
    scene.add(group);
    const holder = { group, rotors: null as THREE.InstancedMesh | null, rotorData: [] as any[], scaffolds: [] as { mesh: THREE.InstancedMesh; ids: number[] }[], ships: null as THREE.InstancedMesh | null, shipData: [] as any[] };
    state.current = holder;
    const dummy = new THREE.Object3D();
    const rebuild = () => {
      for (const c of [...group.children]) {
        group.remove(c);
        (c as THREE.InstancedMesh).dispose?.();
      }
      holder.scaffolds = [];
      const groups = new Map<string, { geo: THREE.BufferGeometry; items: { m: THREE.Matrix4; tint: THREE.Color }[] }>();
      const add = (key: string, geo: () => THREE.BufferGeometry, m: THREE.Matrix4, tint: THREE.Color) => {
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { geo: geo(), items: [] }));
        g.items.push({ m, tint });
      };
      const foundations: THREE.Matrix4[] = [];
      const cranes: THREE.Matrix4[] = [];
      const breakwaters: THREE.Matrix4[] = [];
      const scaffoldGroups = new Map<string, number[]>();
      holder.rotorData = [];
      holder.shipData = [];
      for (const b of world.state.buildings) {
        const d = BUILDING_MAP[b.type];
        const { y, low } = baseHeight(world, b);
        dummy.position.set(b.x, y, b.z);
        dummy.rotation.set(0, b.rot, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        const m = dummy.matrix.clone();
        if (d.site !== 'sea' && y - low > 0.3) {
          const fd = new THREE.Object3D();
          const depthPart = d.port ? 0.45 : 1;
          fd.position.set(b.x - (d.port ? Math.sin(b.rot) * d.size[1] * 0.27 : 0), y + 0.05, b.z - (d.port ? Math.cos(b.rot) * d.size[1] * 0.27 : 0));
          fd.rotation.set(0, b.rot, 0);
          fd.scale.set(d.size[0] * 1.02, y - low + 2, d.size[1] * depthPart * 1.02);
          fd.updateMatrix();
          foundations.push(fd.matrix.clone());
        }
        if (b.status === 'construction') {
          const key = `scaffold|${b.type}`;
          if (!scaffoldGroups.has(key)) scaffoldGroups.set(key, []);
          scaffoldGroups.get(key)!.push(b.id);
          if (d.size[0] > 24 && !d.port) {
            const cm = new THREE.Object3D();
            cm.position.set(b.x + Math.cos(b.rot) * (d.size[0] / 2 + 3), y, b.z - Math.sin(b.rot) * (d.size[0] / 2 + 3));
            cm.rotation.set(0, b.rot + (b.id % 4), 0);
            cm.updateMatrix();
            cranes.push(cm.matrix.clone());
          }
          continue;
        }
        const variant = b.id % VARIANTS;
        const tint = new THREE.Color(1, 1, 1);
        if (b.condition < 0.95) tint.setRGB(0.55 + b.condition * 0.45, 0.5 + b.condition * 0.45, 0.48 + b.condition * 0.45);
        add(`${b.type}|${b.style}|${variant}`, () => modelFor(b.type, b.style, variant), m, tint);
        if (d.powerKind === 'wind') {
          const hub = new THREE.Vector3(0, d.h, 3.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), b.rot).add(new THREE.Vector3(b.x, y, b.z));
          holder.rotorData.push({ pos: hub, rot: b.rot, scale: 1 });
        }
        if (d.port) {
          const bw = b.upgrades?.breakwater ?? 0;
          for (let i = 0; i < bw; i++) {
            const side = i === 0 ? 1 : -1;
            const o = new THREE.Object3D();
            const lx = side * d.size[0] * 0.45, lz = d.size[1] * 0.55 + 18;
            o.position.set(b.x + lx * Math.cos(b.rot) + lz * Math.sin(b.rot), 0, b.z - lx * Math.sin(b.rot) + lz * Math.cos(b.rot));
            o.rotation.set(0, b.rot - side * 0.35, 0);
            o.scale.set(d.size[0] * 0.9 + 30, 1, 1);
            o.updateMatrix();
            breakwaters.push(o.matrix.clone());
          }
          if (b.status === 'active') {
            const nx = Math.sin(b.rot), nz = Math.cos(b.rot);
            holder.shipData.push({ x: b.x + nx * (d.size[1] * 0.5 + 20), z: b.z + nz * (d.size[1] * 0.5 + 20), nx, nz, len: d.port.tier >= 3 ? 60 : d.port.cruise ? 70 : 24, phase: (b.id * 0.37) % 1 });
          }
        }
      }
      for (const [, g] of groups) {
        const im = new THREE.InstancedMesh(g.geo, buildingMat, g.items.length);
        g.items.forEach((it, i) => {
          im.setMatrixAt(i, it.m);
          im.setColorAt(i, it.tint);
        });
        im.castShadow = shadows !== 'off';
        im.receiveShadow = true;
        im.computeBoundingSphere();
        group.add(im);
      }
      for (const [key, ids] of scaffoldGroups) {
        const type = key.split('|')[1];
        const im = new THREE.InstancedMesh(scaffoldModel(type), buildingMat, ids.length);
        im.castShadow = shadows !== 'off';
        group.add(im);
        holder.scaffolds.push({ mesh: im, ids });
      }
      const inst = (geo: THREE.BufferGeometry, mats: THREE.Matrix4[], mat: THREE.Material = buildingMat) => {
        if (!mats.length) return null;
        const im = new THREE.InstancedMesh(geo, mat, mats.length);
        mats.forEach((m, i) => im.setMatrixAt(i, m));
        im.castShadow = shadows !== 'off';
        im.receiveShadow = true;
        im.computeBoundingSphere();
        group.add(im);
        return im;
      };
      inst(foundationGeo, foundations, foundationMat);
      inst(craneModel(), cranes);
      inst(breakwaterModel(), breakwaters);
      holder.rotors = holder.rotorData.length ? new THREE.InstancedMesh(rotorModel(), buildingMat, holder.rotorData.length) : null;
      if (holder.rotors) {
        holder.rotors.castShadow = shadows !== 'off';
        holder.rotors.frustumCulled = false;
        group.add(holder.rotors);
      }
      holder.ships = holder.shipData.length ? new THREE.InstancedMesh(shipGeometry(), buildingMat, holder.shipData.length) : null;
      if (holder.ships) {
        holder.ships.frustumCulled = false;
        group.add(holder.ships);
      }
      updateScaffolds();
    };
    const updateScaffolds = () => {
      for (const s of holder.scaffolds) {
        s.ids.forEach((id, i) => {
          const b = world.building(id);
          if (!b) return;
          const d = BUILDING_MAP[b.type];
          const { y } = baseHeight(world, b);
          dummy.position.set(b.x, y, b.z);
          dummy.rotation.set(0, b.rot, 0);
          const waiting = (b.consultDays ?? 0) > 0;
          dummy.scale.set(1, Math.max(0.6, d.h * (0.12 + 0.88 * (waiting ? 0 : b.progress))), 1);
          dummy.updateMatrix();
          s.mesh.setMatrixAt(i, dummy.matrix);
          s.mesh.setColorAt(i, waiting ? new THREE.Color(0.7, 0.8, 1.2) : new THREE.Color(1, 1, 1));
        });
        s.mesh.instanceMatrix.needsUpdate = true;
        if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
        s.mesh.computeBoundingSphere();
      }
    };
    const onChange = () => {
      if (world.structureVersion !== lastStruct) {
        lastStruct = world.structureVersion;
        rebuild();
      } else if (performance.now() - lastProgress > 200) {
        lastProgress = performance.now();
        updateScaffolds();
      }
    };
    onChange();
    const un = world.subscribe(onChange);
    return () => {
      un();
      scene.remove(group);
      for (const c of group.children) (c as THREE.InstancedMesh).dispose?.();
    };
  }, [world, scene, shadows]);

  const spin = useRef(0);
  const shipT = useRef(0);
  useFrame((_, dt) => {
    const h = state.current;
    if (!h) return;
    const wx = world.state.weather;
    if (h.rotors) {
      const v = wx.wind > 25 ? 0 : Math.min(1.6, Math.max(0.15, (wx.wind - 2) / 6));
      spin.current += dt * v * 2.2;
      const o = new THREE.Object3D();
      h.rotorData.forEach((r, i) => {
        o.position.copy(r.pos);
        o.rotation.set(0, r.rot, spin.current + i * 0.7, 'YXZ');
        o.updateMatrix();
        h.rotors!.setMatrixAt(i, o.matrix);
      });
      h.rotors.instanceMatrix.needsUpdate = true;
    }
    if (h.ships) {
      const sp = store.get().speed;
      shipT.current += dt * (sp ? 0.006 * sp : 0.002);
      const o = new THREE.Object3D();
      h.shipData.forEach((s, i) => {
        const u = (shipT.current + s.phase) % 1;
        const tri = u < 0.5 ? u * 2 : 2 - u * 2; // out and back
        const dist = 40 + tri * 2600;
        o.position.set(s.x + s.nx * dist, 0, s.z + s.nz * dist);
        o.rotation.set(0, Math.atan2(s.nx, s.nz) + (u < 0.5 ? 0 : Math.PI), 0);
        o.scale.setScalar(s.len / 24);
        o.updateMatrix();
        h.ships!.setMatrixAt(i, o.matrix);
      });
      h.ships.instanceMatrix.needsUpdate = true;
    }
  });
  return null;
}

let shipGeo: THREE.BufferGeometry | null = null;
function shipGeometry() {
  if (shipGeo) return shipGeo;
  const k = new Kit();
  k.box(0, -1, 0, 6, 3, 24, '#2b3d52');
  k.box(0, 2, -6, 5, 3.5, 6, '#f2f2f2');
  k.box(0, 2, 4, 5, 2, 10, '#b5523b');
  shipGeo = k.geometry();
  return shipGeo!;
}

// ------------------------------------------------------------------ vegetation

function VegetationLayer({ world }: { world: World }) {
  const { scene } = useThree();
  const density = useApp((s) => s.settings.vegetation);
  const quality = useApp((s) => s.settings.quality);
  const shadows = useApp((s) => s.settings.shadows);
  const holder = useRef<VegetationBuild | null>(null);
  useEffect(() => {
    let lastV = -1;
    let timer: number | null = null;
    const rebuild = () => {
      lastV = world.vegetationVersion;
      if (holder.current) {
        scene.remove(holder.current.group);
        holder.current.dispose();
      }
      holder.current = null;
      if (density <= 0.01) {
        renderRefs.vegetationCount = 0;
        return;
      }
      const max = { low: 15000, medium: 35000, high: 60000, ultra: 120000, custom: 60000 }[quality] * Math.max(0.5, density);
      const v = buildVegetation(world.terrain, world.scenario, world.state.cleared, density, max, shadows === 'high' || shadows === 'ultra');
      veg.uniforms = (v.group.children[0] as THREE.InstancedMesh | undefined)?.material ? ((v.group.children[0] as THREE.InstancedMesh).material as THREE.Material).userData.uniforms : null;
      renderRefs.vegetationCount = v.count;
      scene.add(v.group);
      holder.current = v;
    };
    rebuild();
    const un = world.subscribe(() => {
      if (world.vegetationVersion !== lastV && timer == null) timer = window.setTimeout(() => ((timer = null), rebuild()), 1500);
    });
    return () => {
      un();
      if (timer != null) clearTimeout(timer);
      if (holder.current) {
        scene.remove(holder.current.group);
        holder.current.dispose();
        holder.current = null;
      }
    };
  }, [world, scene, density, quality, shadows]);
  useFrame(({ camera }) => {
    const h = holder.current;
    if (!h) return;
    // trees are only drawn near the camera; from far away the terrain texture already shows the forest
    const maxTree = THREE.MathUtils.clamp(store.get().settings.viewDistance * 1000 * 0.35, 2500, 9000);
    for (const c of h.group.children) {
      const cc = c.userData.chunkCenter as [number, number];
      const r = (c.userData.chunkRadius as number) ?? 0;
      c.visible = Math.hypot(cc[0] - camera.position.x, cc[1] - camera.position.z, camera.position.y * 0.8) - r < maxTree;
    }
  });
  return null;
}

// ------------------------------------------------------------------ weather: rain and clouds

function WeatherLayer({ world }: { world: World }) {
  const { scene, camera } = useThree();
  const weatherOn = useApp((s) => s.settings.weatherEffects);
  const cloudsOn = useApp((s) => s.settings.clouds);
  const rain = useMemo(() => {
    const n = 9000;
    const pos = new Float32Array(n * 6);
    const tip = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 600, y = Math.random() * 300, z = (Math.random() - 0.5) * 600;
      pos.set([x, y, z, x, y, z], i * 6);
      tip[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('tip', new THREE.BufferAttribute(tip, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { time: { value: 0 }, center: { value: new THREE.Vector3() }, wind: { value: new THREE.Vector2() }, opacity: { value: 0.5 } },
      vertexShader: `uniform float time; uniform vec3 center; uniform vec2 wind; attribute float tip; varying float vTip;
        void main(){ vec3 p = position; float fall = mod(p.y - time * 90.0, 300.0);
          vec3 q = vec3(p.x, fall, p.z);
          q.xz += wind * (300.0 - fall) * 0.04;
          q.x = mod(q.x - center.x + 300.0, 600.0) - 300.0 + center.x; q.z = mod(q.z - center.z + 300.0, 600.0) - 300.0 + center.z;
          q.y += center.y - 150.0 - tip * 3.5; q.xz -= wind * tip * 0.15;
          vTip = tip;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(q, 1.0); }`,
      fragmentShader: `uniform float opacity; varying float vTip; void main(){ gl_FragColor = vec4(0.78, 0.83, 0.9, opacity * (1.0 - vTip * 0.6)); }`,
    });
    const lines = new THREE.LineSegments(g, mat);
    lines.frustumCulled = false;
    lines.name = 'rain';
    return lines;
  }, []);
  const clouds = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 18; i++) {
      const x = 30 + Math.random() * 68, y = 45 + Math.random() * 38, r = 18 + Math.random() * 22;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, 128, 128);
    }
    const tex = new THREE.CanvasTexture(canvas);
    const group = new THREE.Group();
    group.name = 'clouds';
    const t = world.terrain;
    const span = Math.max(t.widthM, t.depthM) * 1.6;
    const alt = THREE.MathUtils.clamp(span * 0.08, 600, 2200);
    for (let i = 0; i < 46; i++) {
      const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.8, fog: false });
      const s = new THREE.Sprite(m);
      const size = span * (0.06 + Math.random() * 0.08);
      s.scale.set(size * 1.8, size * 0.8, 1);
      s.position.set((Math.random() - 0.5) * span, alt + Math.random() * alt * 0.4, (Math.random() - 0.5) * span);
      s.userData.base = Math.random();
      group.add(s);
    }
    group.userData.span = span;
    return group;
  }, [world]);
  useEffect(() => {
    scene.add(rain, clouds);
    return () => {
      scene.remove(rain, clouds);
    };
  }, [scene, rain, clouds]);
  useFrame((_, dt) => {
    const wx = world.state.weather;
    const raining = weatherOn && (wx.kind === 'rain' || wx.kind === 'storm');
    rain.visible = raining;
    if (raining) {
      const m = rain.material as THREE.ShaderMaterial;
      m.uniforms.time.value += dt;
      m.uniforms.center.value.copy(camera.position);
      m.uniforms.wind.value.set(Math.sin(wx.windDir) * wx.wind * 0.2, -Math.cos(wx.windDir) * wx.wind * 0.2);
      m.uniforms.opacity.value = Math.min(0.45, 0.12 + wx.rain / 40) * (0.3 + env.daylight * 0.7);
    }
    clouds.visible = cloudsOn;
    if (cloudsOn) {
      const span = clouds.userData.span as number;
      const vx = Math.sin(wx.windDir) * wx.wind * 4 * dt * (store.get().speed ? 1 : 0.3);
      const vz = -Math.cos(wx.windDir) * wx.wind * 4 * dt * (store.get().speed ? 1 : 0.3);
      const cover = weatherOn ? wx.cloud : 0.35;
      const light = 0.25 + env.daylight * 0.75;
      clouds.children.forEach((c) => {
        const s = c as THREE.Sprite;
        s.position.x -= vx;
        s.position.z -= vz;
        if (s.position.x > span / 2) s.position.x -= span;
        if (s.position.x < -span / 2) s.position.x += span;
        if (s.position.z > span / 2) s.position.z -= span;
        if (s.position.z < -span / 2) s.position.z += span;
        const show = (s.userData.base as number) < cover + 0.1;
        const mat = s.material as THREE.SpriteMaterial;
        mat.opacity = show ? 0.35 + cover * 0.55 : 0;
        const grey = 1 - cover * 0.45;
        mat.color.setRGB(grey * light, grey * light, grey * light * 1.02);
      });
    }
    // ambient audio follows the weather
    audio.setWeather(wx.wind, raining ? wx.rain : 0, wx.storm);
  });
  return null;
}
