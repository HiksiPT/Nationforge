// Mouse tools on the map: select, build (ghost preview + confirm), roads (route preview + confirm),
// zone painting and bulldozing. The ground is picked by marching the mouse ray over the heightfield.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BUILDING_MAP } from '../data/catalogue';
import { store, useApp } from '../app/store';
import { pointInObb, distPointPolyline } from '../sim/spatial';
import type { World } from '../sim/world';
import { modelFor } from './models';
import { baseHeight, densify } from './Scene';
import { cursor } from './refs';
import { audio } from '../audio/audio';

/** Intersect a ray with the terrain surface (water counts as a surface at y = 0). */
export function pickGround(world: World, ray: THREE.Ray): THREE.Vector3 | null {
  const t = world.terrain;
  const maxD = Math.max(t.widthM, t.depthM) * 3;
  const step = Math.max(2, t.cell * 0.5);
  const p = new THREE.Vector3();
  let prev = ray.origin.clone();
  let prevAbove = prev.y - t.surfaceAt(prev.x, prev.z);
  for (let d = step; d < maxD; d += step * (1 + d / 4000)) {
    ray.at(d, p);
    const above = p.y - t.surfaceAt(p.x, p.z);
    if (above <= 0) {
      // bisect between prev and p
      let a = prev.clone(), b = p.clone();
      for (let i = 0; i < 12; i++) {
        const m = a.clone().add(b).multiplyScalar(0.5);
        if (m.y - t.surfaceAt(m.x, m.z) > 0) a = m;
        else b = m;
      }
      return b;
    }
    prev = p.clone();
    prevAbove = above;
  }
  void prevAbove;
  return null;
}

export function pickBuilding(world: World, x: number, z: number) {
  for (const b of world.buildingsNear(x, z, 320)) {
    if (pointInObb(world.obbOf(b), x, z, 2)) return b;
  }
  return null;
}

export function ToolLayer({ world }: { world: World }) {
  const { camera, gl, scene } = useThree();
  const tool = useApp((s) => s.tool);
  const pending = useApp((s) => s.pending);
  const roadStart = useApp((s) => s.roadStart);
  const brush = useApp((s) => s.brush);

  const ghostMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6fe08a', transparent: true, opacity: 0.55, depthWrite: false, emissive: '#1f6030', emissiveIntensity: 0.4 }), []);
  const ghost = useMemo(() => new THREE.Mesh(new THREE.BufferGeometry(), ghostMat), [ghostMat]);
  const outline = useMemo(() => new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true })), []);
  const brushRing = useMemo(() => new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.9 })), []);
  const routeLine = useMemo(() => {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }));
    m.renderOrder = 10;
    return m;
  }, []);
  useEffect(() => {
    ghost.renderOrder = 9;
    outline.renderOrder = 11;
    brushRing.renderOrder = 11;
    scene.add(ghost, outline, brushRing, routeLine);
    return () => {
      scene.remove(ghost, outline, brushRing, routeLine);
    };
  }, [scene, ghost, outline, brushRing, routeLine]);

  const live = useRef({ lastEval: 0, lastPlan: 0, painting: false, paintCells: 0, paintCost: 0, down: null as { x: number; y: number } | null, moved: false, routeKey: '' });
  const ray = useMemo(() => new THREE.Raycaster(), []);

  const groundAt = (clientX: number, clientY: number) => {
    const r = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return pickGround(world, ray.ray);
  };

  useEffect(() => {
    const el = gl.domElement;
    const onMove = (e: PointerEvent) => {
      const g = groundAt(e.clientX, e.clientY);
      cursor.valid = !!g;
      cursor.screenX = e.clientX;
      cursor.screenY = e.clientY;
      if (g) {
        cursor.x = g.x;
        cursor.z = g.z;
      }
      const L = live.current;
      if (L.down && Math.hypot(e.clientX - L.down.x, e.clientY - L.down.y) > 5) L.moved = true;
      const st = store.get();
      if (st.tool.kind === 'zone' && L.painting && g) {
        const r = world.paintZone(st.tool.zone, g.x, g.z, st.brush);
        L.paintCells += r.cells;
        L.paintCost += r.cost;
      }
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      live.current.down = { x: e.clientX, y: e.clientY };
      live.current.moved = false;
      const st = store.get();
      if (st.tool.kind === 'zone') {
        const g = groundAt(e.clientX, e.clientY);
        if (g) {
          if (st.tool.zone && world.state.treasury <= 0) {
            store.toast('The treasury is empty', 'err');
            return;
          }
          live.current.painting = true;
          live.current.paintCells = 0;
          live.current.paintCost = 0;
          const r = world.paintZone(st.tool.zone, g.x, g.z, st.brush);
          live.current.paintCells += r.cells;
          live.current.paintCost += r.cost;
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      const L = live.current;
      const st = store.get();
      if (e.button === 2) {
        // right click on the map: cancel the current step
        if (!L.moved && e.target === el) cancelStep();
        return;
      }
      if (e.button !== 0) return;
      if (e.target !== el && !L.painting) {
        L.down = null;
        return;
      }
      if (L.painting) {
        L.painting = false;
        if (L.paintCells) {
          audio.click();
          store.toast(st.tool.kind === 'zone' && st.tool.zone ? `Zoned ${L.paintCells} cells (${Math.round(L.paintCost / 1000)}k)` : `Cleared zoning on ${L.paintCells} cells`);
        }
        L.down = null;
        return;
      }
      const moved = L.moved;
      L.down = null;
      if (moved) return;
      const g = groundAt(e.clientX, e.clientY);
      if (!g) return;
      click(g.x, g.z);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const st = store.get();
      if (e.key === 'Escape') cancelStep(true);
      if ((e.key === 'r' || e.key === 'R') && st.tool.kind === 'build' && !st.pending) store.set({ rotation: (st.rotation + Math.PI / 4) % (Math.PI * 2) });
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [gl, world]);

  function cancelStep(all = false) {
    const st = store.get();
    if (st.pending) return store.set({ pending: null });
    if (st.tool.kind === 'road' && st.roadStart) return store.set({ roadStart: null, hover: null });
    if (all || st.tool.kind !== 'select') store.set({ tool: { kind: 'select' }, hover: null, roadStart: null });
    else store.set({ selection: null });
  }

  function click(x: number, z: number) {
    const st = store.get();
    if (st.pending) return; // waiting for confirm/cancel
    const tl = st.tool;
    if (tl.kind === 'select') {
      const b = pickBuilding(world, x, z);
      if (b) {
        audio.click();
        return store.set({ selection: { kind: 'building', id: b.id } });
      }
      const near = world.nearestRoad(x, z, 20);
      if (near.road && near.dist < 8) return store.set({ selection: { kind: 'road', id: near.road.id } });
      return store.set({ selection: { kind: 'terrain', x, z } });
    }
    if (tl.kind === 'bulldoze') {
      const b = pickBuilding(world, x, z);
      if (b) {
        const d = BUILDING_MAP[b.type];
        const refund = b.status === 'construction' ? Math.round(b.cost * (1 - b.progress) * 0.5) : 0;
        store.askConfirm({
          title: `Demolish ${d.name}?`,
          body: `${b.owner === 'community' ? 'This is a community building: residents will lose their homes and approval will suffer. ' : ''}This cannot be undone.${refund ? ` You will recover about $${Math.round(refund / 1000)}k.` : ''}`,
          confirmLabel: 'Demolish',
          danger: true,
          onConfirm: () => {
            if (b.owner === 'community') world.state.modifiers.push({ id: 'demolish', label: 'Demolished homes', target: 'approval', value: -8, until: world.state.day + 120 });
            world.bulldoze(b.id);
            audio.demolish();
            store.set({ confirm: null, selection: null });
          },
        });
        return;
      }
      const near = world.nearestRoad(x, z, 20);
      if (near.road && near.dist < 8) {
        const r = near.road;
        store.askConfirm({ title: 'Remove road?', body: `${r.osm ? 'This is an existing island road. ' : ''}Buildings that rely on it lose access.`, confirmLabel: 'Remove road', danger: true, onConfirm: () => (world.removeRoad(r.id), store.set({ confirm: null })) });
      }
      return;
    }
    if (tl.kind === 'build') {
      const res = world.evaluate(tl.type, x, z, st.rotation);
      store.set({ pending: { kind: 'building', type: tl.type, x: res.snap?.x ?? x, z: res.snap?.z ?? z, rot: res.snap?.rot ?? st.rotation, result: res } });
      return;
    }
    if (tl.kind === 'road') {
      if (!st.roadStart) {
        if (!world.terrain.isTerritory(x, z)) return store.toast('Start the road on your own land', 'err');
        return store.set({ roadStart: [x, z] });
      }
      const plan = world.planRoad(tl.cls, st.roadStart, [x, z]);
      if (!plan.ok) return store.toast(plan.reason ?? 'No route', 'err');
      store.set({ pending: { kind: 'road', plan } });
    }
  }

  // per-frame previews
  useFrame(() => {
    const st = store.get();
    const L = live.current;
    const now = performance.now();
    ghost.visible = false;
    outline.visible = false;
    brushRing.visible = false;
    routeLine.visible = false;
    const tl = st.tool;
    if (tl.kind === 'build') {
      const p = st.pending && st.pending.kind === 'building' ? st.pending : null;
      let x = cursor.x, z = cursor.z, rot = st.rotation;
      let res = st.hover;
      if (p) {
        x = p.x;
        z = p.z;
        rot = p.rot;
        res = p.result;
      } else if (cursor.valid && now - L.lastEval > 90) {
        L.lastEval = now;
        res = world.evaluate(tl.type, cursor.x, cursor.z, st.rotation);
        store.set({ hover: res });
      }
      if (!p && res?.snap) {
        x = res.snap.x;
        z = res.snap.z;
        rot = res.snap.rot;
      }
      if (cursor.valid || p) {
        const variant = 0;
        const geo = modelFor(tl.type, world.styleFor(BUILDING_MAP[tl.type], x, z), variant);
        if (ghost.geometry !== geo) ghost.geometry = geo;
        const { y } = baseHeight(world, { type: tl.type, x, z, rot });
        ghost.position.set(x, y + 0.2, z);
        ghost.rotation.set(0, rot, 0);
        ghost.visible = true;
        const ok = res ? res.ok : false;
        const warn = res && res.ok && res.warnings.length > 0;
        ghostMat.color.set(ok ? (warn ? '#f2c94c' : '#6fe08a') : '#ff5a4f');
        ghostMat.emissive.set(ok ? (warn ? '#5a4a10' : '#1f6030') : '#601f1f');
        // footprint outline on the ground
        const d = BUILDING_MAP[tl.type];
        const pts: THREE.Vector3[] = [];
        const c = Math.cos(rot), s = Math.sin(rot);
        for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const wx = x + (lx * d.size[0]) / 2 * c + (lz * d.size[1]) / 2 * s;
          const wz = z - (lx * d.size[0]) / 2 * s + (lz * d.size[1]) / 2 * c;
          pts.push(new THREE.Vector3(wx, world.terrain.surfaceAt(wx, wz) + 1, wz));
        }
        outline.geometry.setFromPoints(pts);
        (outline.material as THREE.LineBasicMaterial).color.set(ok ? '#ffffff' : '#ff8a80');
        outline.visible = true;
      }
    } else if (tl.kind === 'zone' && cursor.valid) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const x = cursor.x + Math.cos(a) * st.brush, z = cursor.z + Math.sin(a) * st.brush;
        pts.push(new THREE.Vector3(x, world.terrain.surfaceAt(x, z) + 2, z));
      }
      brushRing.geometry.setFromPoints(pts);
      (brushRing.material as THREE.LineBasicMaterial).color.set(tl.zone === 'R' ? '#7cf09a' : tl.zone === 'C' ? '#8ab8ff' : tl.zone === 'I' ? '#ffcc66' : '#ffffff');
      brushRing.visible = true;
    } else if (tl.kind === 'road') {
      let plan = st.pending && st.pending.kind === 'road' ? st.pending.plan : null;
      if (!plan && st.roadStart && cursor.valid && now - L.lastPlan > 220) {
        L.lastPlan = now;
        const key = `${Math.round(cursor.x / 8)},${Math.round(cursor.z / 8)}`;
        if (key !== L.routeKey) {
          L.routeKey = key;
          const pl = world.planRoad(tl.cls, st.roadStart, [cursor.x, cursor.z]);
          routeCache.plan = pl;
          store.set({ hover: null });
        }
      }
      if (!plan && st.roadStart) plan = routeCache.plan;
      if (plan && st.roadStart) {
        const width = tl.cls === 'avenue' ? 12 : tl.cls === 'road' ? 7 : 4;
        routeLine.geometry.dispose();
        routeLine.geometry = ribbon(world, plan.ok ? plan.pts : [st.roadStart, [cursor.x, cursor.z]], width);
        (routeLine.material as THREE.MeshBasicMaterial).color.set(plan.ok ? '#ffd166' : '#ff5a4f');
        routeLine.visible = true;
      } else if (cursor.valid) {
        brushRing.geometry.setFromPoints(circle(world, cursor.x, cursor.z, 10));
        (brushRing.material as THREE.LineBasicMaterial).color.set('#ffd166');
        brushRing.visible = true;
      }
    } else if (tl.kind === 'bulldoze' && cursor.valid) {
      const b = pickBuilding(world, cursor.x, cursor.z);
      if (b) {
        const d = BUILDING_MAP[b.type];
        brushRing.geometry.setFromPoints(circle(world, b.x, b.z, Math.hypot(d.size[0], d.size[1]) / 2 + 4));
        (brushRing.material as THREE.LineBasicMaterial).color.set('#ff5a4f');
        brushRing.visible = true;
      }
    } else if (tl.kind === 'select' && st.selection) {
      const sel = st.selection;
      if (sel.kind === 'building') {
        const b = world.building(sel.id);
        if (b) {
          const d = BUILDING_MAP[b.type];
          brushRing.geometry.setFromPoints(circle(world, b.x, b.z, Math.hypot(d.size[0], d.size[1]) / 2 + 5));
          (brushRing.material as THREE.LineBasicMaterial).color.set('#ffffff');
          brushRing.visible = true;
        }
      } else if (sel.kind === 'terrain' || sel.kind === 'site') {
        brushRing.geometry.setFromPoints(circle(world, sel.x, sel.z, 18));
        (brushRing.material as THREE.LineBasicMaterial).color.set('#ffffff');
        brushRing.visible = true;
      } else if (sel.kind === 'road') {
        const r = world.state.roads.find((x) => x.id === sel.id);
        if (r) {
          routeLine.geometry.dispose();
          routeLine.geometry = ribbon(world, r.pts, (r.cls === 'avenue' ? 12 : r.cls === 'road' ? 7 : 4) + 3);
          (routeLine.material as THREE.MeshBasicMaterial).color.set('#ffffff');
          routeLine.visible = true;
        }
      }
    }
  });
  void tool;
  void pending;
  void roadStart;
  void brush;
  return null;
}

const routeCache: { plan: import('../sim/roads').RoadPlan | null } = { plan: null };

function circle(world: World, x: number, z: number, r: number) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    pts.push(new THREE.Vector3(px, world.terrain.surfaceAt(px, pz) + 1.5, pz));
  }
  return pts;
}

function ribbon(world: World, pts: [number, number][], width: number): THREE.BufferGeometry {
  const t = world.terrain;
  const d = densify(pts, Math.max(4, t.cell * 0.5));
  const pos: number[] = [];
  for (let i = 0; i + 1 < d.length; i++) {
    const [ax, az] = d[i], [bx, bz] = d[i + 1];
    const dx = bx - ax, dz = bz - az;
    const l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * (width / 2), nz = (dx / l) * (width / 2);
    const ya = t.surfaceAt(ax, az) + 1.2, yb = t.surfaceAt(bx, bz) + 1.2;
    pos.push(ax + nx, ya, az + nz, ax - nx, ya, az - nz, bx - nx, yb, bz - nz, ax + nx, ya, az + nz, bx - nx, yb, bz - nz, bx + nx, yb, bz + nz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

export { distPointPolyline };
