// First-person walking: pointer-lock mouse look, WASD, terrain following, slope and water limits,
// and collision with building footprints. Esc releases the mouse; the HUD offers "return to map".

import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BUILDING_MAP } from '../data/catalogue';
import { store } from '../app/store';
import { toLocal } from '../sim/spatial';
import type { World } from '../sim/world';
import { baseHeight } from './Scene';
import { fp, rig } from './refs';

export const EYE = 1.7;
const WALK = 4.2; // m/s
const RUN = 9;

/** Start walking at a world position (snapped to the nearest dry land). */
export function enterFirstPerson(world: World, x: number, z: number) {
  const t = world.terrain;
  let px = x, pz = z;
  if (!t.isLand(px, pz) || t.heightAt(px, pz) < 0.5) {
    let best: [number, number] | null = null;
    for (let r = 10; r < 3000 && !best; r += 20) {
      for (let a = 0; a < 24; a++) {
        const qx = x + Math.cos((a / 24) * Math.PI * 2) * r, qz = z + Math.sin((a / 24) * Math.PI * 2) * r;
        if (t.isTerritory(qx, qz) && t.heightAt(qx, qz) > 0.8) {
          best = [qx, qz];
          break;
        }
      }
    }
    if (best) [px, pz] = best;
  }
  const free = pushOut(world, px, pz, 0.6);
  fp.pos.set(free[0], t.heightAt(free[0], free[1]) + EYE, free[1]);
  fp.yaw = rig.yaw + Math.PI;
  fp.pitch = 0;
  fp.vy = 0;
  store.set({ view: 'firstperson', tool: { kind: 'select' }, selection: null });
}

export function exitFirstPerson() {
  rig.target.set(fp.pos.x, 0, fp.pos.z);
  rig.dist = 300;
  if (document.pointerLockElement) document.exitPointerLock();
  store.set({ view: 'map' });
}

/** Push a point out of any building footprint it is inside. */
function pushOut(world: World, x: number, z: number, radius: number): [number, number] {
  for (const b of world.buildingsNear(x, z, 300)) {
    const d = BUILDING_MAP[b.type];
    if (d.site === 'sea') continue;
    const o = world.obbOf(b);
    const hw = o.hw + radius, hd = o.hd + radius;
    const [lx, lz] = toLocal(o, x, z);
    if (Math.abs(lx) < hw && Math.abs(lz) < hd) {
      // push along the axis of least penetration
      const px = hw - Math.abs(lx), pz = hd - Math.abs(lz);
      let nlx = lx, nlz = lz;
      if (px < pz) nlx = Math.sign(lx || 1) * hw;
      else nlz = Math.sign(lz || 1) * hd;
      const c = Math.cos(o.rot), s = Math.sin(o.rot);
      x = o.x + nlx * c + nlz * s;
      z = o.z - nlx * s + nlz * c;
    }
  }
  return [x, z];
}

export function FirstPerson({ world }: { world: World }) {
  const { camera, gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const onClick = () => {
      if (!document.pointerLockElement) el.requestPointerLock?.();
    };
    const onLock = () => {
      fp.locked = document.pointerLockElement === el;
    };
    const onMove = (e: MouseEvent) => {
      if (!fp.locked) return;
      const s = store.get().settings.mouseSensitivity;
      fp.yaw -= e.movementX * 0.0022 * s;
      fp.pitch = THREE.MathUtils.clamp(fp.pitch - e.movementY * 0.0022 * s, -1.4, 1.4);
    };
    const kd = (e: KeyboardEvent) => {
      fp.keys.add(e.key.toLowerCase());
      if (e.key === ' ' && fp.vy === 0) fp.vy = 4.5;
    };
    const ku = (e: KeyboardEvent) => fp.keys.delete(e.key.toLowerCase());
    el.addEventListener('click', onClick);
    document.addEventListener('pointerlockchange', onLock);
    document.addEventListener('mousemove', onMove);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    const pc = camera as THREE.PerspectiveCamera;
    pc.near = 0.15;
    pc.fov = 70;
    pc.updateProjectionMatrix();
    return () => {
      el.removeEventListener('click', onClick);
      document.removeEventListener('pointerlockchange', onLock);
      document.removeEventListener('mousemove', onMove);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      fp.keys.clear();
      fp.locked = false;
      pc.fov = store.get().settings.fov;
      pc.updateProjectionMatrix();
    };
  }, [gl, camera]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const t = world.terrain;
    const k = fp.keys;
    const f = new THREE.Vector3(-Math.sin(fp.yaw), 0, -Math.cos(fp.yaw));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const move = new THREE.Vector3();
    if (k.has('w') || k.has('arrowup')) move.add(f);
    if (k.has('s') || k.has('arrowdown')) move.sub(f);
    if (k.has('d') || k.has('arrowright')) move.add(r);
    if (k.has('a') || k.has('arrowleft')) move.sub(r);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar((k.has('shift') ? RUN : WALK) * dt);
      let nx = fp.pos.x + move.x, nz = fp.pos.z + move.z;
      const h0 = t.heightAt(fp.pos.x, fp.pos.z);
      const h1 = t.heightAt(nx, nz);
      const grade = (h1 - h0) / Math.max(1e-3, Math.hypot(move.x, move.z));
      const blockedSlope = grade > 1.2; // ~50 degrees: too steep to climb
      const blockedWater = h1 < -0.9; // no swimming into deep water
      const blockedEdge = !t.inBounds(nx, nz);
      if (!blockedSlope && !blockedWater && !blockedEdge) {
        [nx, nz] = pushOut(world, nx, nz, 0.45);
        fp.pos.x = nx;
        fp.pos.z = nz;
      }
    }
    // gravity / ground and building roofs are not walkable: stay on the ground or a quay deck
    let ground = Math.max(t.heightAt(fp.pos.x, fp.pos.z), -0.9);
    for (const b of world.buildingsNear(fp.pos.x, fp.pos.z, 260)) {
      const d = BUILDING_MAP[b.type];
      if (!d.port || b.status === 'construction') continue;
      const [lx, lz] = toLocal(world.obbOf(b), fp.pos.x, fp.pos.z);
      if (Math.abs(lx) < d.size[0] / 2 && Math.abs(lz) < d.size[1] / 2) ground = Math.max(ground, baseHeight(world, b).y + 1.5);
    }
    fp.vy -= 9.8 * dt;
    let y = fp.pos.y - EYE + fp.vy * dt;
    if (y <= ground) {
      y = ground;
      fp.vy = 0;
    }
    fp.pos.y = y + EYE;
    camera.position.copy(fp.pos);
    const look = new THREE.Vector3(-Math.sin(fp.yaw) * Math.cos(fp.pitch), Math.sin(fp.pitch), -Math.cos(fp.yaw) * Math.cos(fp.pitch));
    camera.lookAt(fp.pos.clone().add(look));
    rig.target.set(fp.pos.x, ground, fp.pos.z);
  });
  return null;
}
