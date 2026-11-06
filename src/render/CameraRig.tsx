// Strategy camera: orbit, zoom and pan over the island, with national / regional / city presets.

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { store } from '../app/store';
import type { World } from '../sim/world';
import { rig } from './refs';

export function presetDistance(world: World, p: 'national' | 'regional' | 'city'): number {
  const span = Math.max(world.terrain.widthM, world.terrain.depthM);
  return p === 'national' ? span * 0.75 : p === 'regional' ? Math.min(span * 0.35, 2600) : 380;
}

export function CameraRig({ world }: { world: World }) {
  const { camera, gl } = useThree();
  const goal = useRef<{ target: THREE.Vector3; dist: number } | null>(null);
  const keys = useRef(new Set<string>());
  const mouse = useRef({ x: 0, y: 0, inside: false });
  const t = world.terrain;
  rig.maxDist = Math.max(t.widthM, t.depthM) * 1.6;

  useEffect(() => {
    const el = gl.domElement;
    let drag: { button: number; x: number; y: number; moved: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button === 1 || e.button === 2) {
        drag = { button: e.button, x: e.clientX, y: e.clientY, moved: false };
        el.setPointerCapture(e.pointerId);
      } else if (e.button === 0) {
        drag = { button: 0, x: e.clientX, y: e.clientY, moved: false };
      }
    };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      mouse.current = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, inside: true };
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      const s = store.get().settings;
      if (drag.button === 2) {
        rig.yaw -= dx * 0.005 * s.rotateSpeed;
        rig.pitch = THREE.MathUtils.clamp(rig.pitch + dy * 0.004 * s.rotateSpeed, 0.12, 1.45);
      } else if (drag.button === 1 || (drag.button === 0 && drag.moved && canLeftDragPan())) {
        pan(-dx, -dy);
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.moved) goal.current = null;
    };
    const onUp = () => {
      drag = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = store.get().settings;
      const dir = (s.invertZoom ? -1 : 1) * Math.sign(e.deltaY);
      rig.dist = THREE.MathUtils.clamp(rig.dist * (1 + dir * 0.12), rig.minDist, rig.maxDist);
      goal.current = null;
    };
    const onCtx = (e: Event) => e.preventDefault();
    const onLeave = () => (mouse.current.inside = false);
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      keys.current.add(e.key.toLowerCase());
    };
    const ku = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onCtx);
    el.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onCtx);
      el.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, [gl]);

  function canLeftDragPan() {
    const tool = store.get().tool;
    return tool.kind === 'select' || tool.kind === 'build' || tool.kind === 'road' || tool.kind === 'bulldoze';
  }

  function pan(dx: number, dy: number) {
    // dx = screen right, dy = screen down (towards the camera)
    const s = store.get().settings;
    const k = rig.dist * 0.0018 * s.panSpeed;
    const c = Math.cos(rig.yaw), sn = Math.sin(rig.yaw);
    rig.target.x += (c * dx + sn * dy) * k;
    rig.target.z += (-sn * dx + c * dy) * k;
    clampTarget();
  }

  function clampTarget() {
    rig.target.x = THREE.MathUtils.clamp(rig.target.x, -t.widthM / 2, t.widthM / 2);
    rig.target.z = THREE.MathUtils.clamp(rig.target.z, -t.depthM / 2, t.depthM / 2);
  }

  useFrame((_, dt) => {
    const st = store.get();
    const cmd = st.cameraCmd;
    if (cmd) {
      if (cmd.kind === 'focus') goal.current = { target: new THREE.Vector3(cmd.x, 0, cmd.z), dist: cmd.dist ?? Math.min(rig.dist, 900) };
      else goal.current = { target: rig.target.clone(), dist: presetDistance(world, cmd.preset) };
      if (cmd.kind === 'preset' && cmd.preset === 'national') goal.current.target.set(0, 0, 0);
      store.set({ cameraCmd: null });
    }
    if (goal.current) {
      const g = goal.current;
      const k = 1 - Math.exp(-dt * 4);
      rig.target.lerp(g.target, k);
      rig.dist += (g.dist - rig.dist) * k;
      if (rig.target.distanceTo(g.target) < 2 && Math.abs(rig.dist - g.dist) < 2) goal.current = null;
    }
    // keyboard pan / rotate / zoom
    const s = st.settings;
    const kk = keys.current;
    const sp = 160 * dt;
    if (kk.has('w') || kk.has('arrowup')) pan(0, -sp);
    if (kk.has('s') || kk.has('arrowdown')) pan(0, sp);
    if (kk.has('a') || kk.has('arrowleft')) pan(-sp, 0);
    if (kk.has('d') || kk.has('arrowright')) pan(sp, 0);
    if (kk.has('q')) rig.yaw += dt * 1.2 * s.rotateSpeed;
    if (kk.has('e')) rig.yaw -= dt * 1.2 * s.rotateSpeed;
    if (kk.has('z') || kk.has('-')) rig.dist = Math.min(rig.maxDist, rig.dist * (1 + dt * 1.5));
    if (kk.has('x') || kk.has('=') || kk.has('+')) rig.dist = Math.max(rig.minDist, rig.dist * (1 - dt * 1.5));
    if (s.edgeScroll && mouse.current.inside) {
      const m = mouse.current;
      const e = 0.02;
      if (m.x < e) pan(-sp, 0);
      if (m.x > 1 - e) pan(sp, 0);
      if (m.y < e) pan(0, -sp);
      if (m.y > 1 - e) pan(0, sp);
    }
    // keep the orbit target on the ground
    const ground = Math.max(0, t.heightAt(rig.target.x, rig.target.z));
    rig.target.y += (ground - rig.target.y) * Math.min(1, dt * 6);
    const cp = Math.cos(rig.pitch);
    const pos = new THREE.Vector3(rig.target.x + Math.sin(rig.yaw) * cp * rig.dist, rig.target.y + Math.sin(rig.pitch) * rig.dist, rig.target.z + Math.cos(rig.yaw) * cp * rig.dist);
    const minY = Math.max(0, t.inBounds(pos.x, pos.z) ? t.heightAt(pos.x, pos.z) : 0) + 12;
    if (pos.y < minY) pos.y = minY;
    camera.position.copy(pos);
    camera.lookAt(rig.target);
    camera.near = Math.max(0.5, rig.dist / 400);
    camera.updateProjectionMatrix();
  });
  return null;
}
