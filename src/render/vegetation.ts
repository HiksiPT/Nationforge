// Vegetation: deterministic instanced trees and shrubs per terrain chunk, chosen by biome, slope, land cover
// and elevation. Cleared cells (buildings, roads, fire) get no trees. Density comes from the settings.

import * as THREE from 'three';
import { MASK, type Terrain } from '../geo/terrain';
import type { Scenario } from '../data/scenarios';
import { Kit, seq } from './kit';

const VCHUNK = 128;

type Species = { geo: THREE.BufferGeometry; name: string };

function speciesFor(biome: Scenario['vegetation']): Species[] {
  const make = (fn: (k: Kit) => void, name: string) => {
    const k = new Kit();
    fn(k);
    return { geo: k.geometry(), name };
  };
  const conifer = make((k) => {
    k.cylinder(0, 0, 0, 0.35, 3, '#5a3d24', 5);
    k.cone(0, 2, 0, 2.6, 6, '#2f5a33', 7);
    k.cone(0, 5, 0, 1.9, 5, '#386a3b', 7);
  }, 'conifer');
  const broadleaf = make((k) => {
    k.cylinder(0, 0, 0, 0.4, 3.5, '#5e4128', 5);
    k.blob(0, 5.5, 0, 3.2, 2.8, '#3f7a36');
    k.blob(1, 6.5, 0.6, 2, 1.8, '#4b8a3e');
  }, 'broadleaf');
  const shrub = make((k) => {
    k.blob(0, 0.8, 0, 1.6, 1, '#6d7d3f');
    k.blob(0.9, 0.6, 0.4, 1, 0.7, '#7b8a48');
  }, 'shrub');
  const pine = make((k) => {
    k.cylinder(0, 0, 0, 0.35, 6, '#6b4a2e', 5);
    k.blob(0, 7, 0, 3.4, 1.6, '#4f6e35');
  }, 'pine');
  const palm = make((k) => {
    k.cylinder(0, 0, 0, 0.3, 9, '#8a6d4c', 5, 0.22);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      k.box(Math.cos(a) * 1.8, 8.6, Math.sin(a) * 1.8, 3.8, 0.25, 1.1, '#3f8a3a', -a);
    }
  }, 'palm');
  const jungle = make((k) => {
    k.cylinder(0, 0, 0, 0.5, 5, '#4e3a28', 5);
    k.blob(0, 7.5, 0, 4.2, 3, '#2f6e2f');
    k.blob(-1.4, 8.6, 1, 2.6, 2, '#3a7d34');
  }, 'jungle');
  const rainforest = make((k) => {
    k.cylinder(0, 0, 0, 0.5, 7, '#4a3a2a', 5);
    k.blob(0, 9, 0, 3.6, 3.4, '#2b5a2a');
    k.cone(0, 7, 0, 2.8, 7, '#264f28', 6);
  }, 'rainforest');
  switch (biome) {
    case 'temperate':
      return [broadleaf, conifer, shrub];
    case 'mediterranean':
      return [pine, shrub, broadleaf];
    case 'rainforest':
      return [rainforest, conifer, shrub];
    case 'tropical':
      return [jungle, palm, shrub];
  }
}

export interface VegetationBuild {
  group: THREE.Group;
  count: number;
  dispose(): void;
}

/** Per-cell probability and species choice (0..2) for a biome. */
function plant(biome: Scenario['vegetation'], m: number, e: number, slope: number, coast: number, r: number): number {
  const forest = (m & MASK.forest) !== 0;
  let p = 0;
  let sp = 0;
  switch (biome) {
    case 'temperate':
      p = forest ? 0.9 : slope > 25 ? 0.02 : e < 3 ? 0 : 0.05;
      sp = forest ? (r < 0.5 ? 0 : 1) : r < 0.6 ? 2 : 0;
      break;
    case 'mediterranean':
      p = forest ? 0.8 : slope > 30 ? 0.12 : e < 2 ? 0 : 0.38;
      sp = forest ? (r < 0.7 ? 0 : 2) : r < 0.75 ? 1 : r < 0.92 ? 0 : 2;
      break;
    case 'rainforest':
      p = e < 3 ? 0.05 : slope > 45 ? 0.3 : forest ? 1 : slope < 3 && e > 60 ? 0.25 : 0.85;
      sp = r < 0.6 ? 0 : r < 0.85 ? 1 : 2;
      break;
    case 'tropical':
      p = e < 1.5 ? 0 : coast < 250 ? 0.45 : slope > 50 ? 0.25 : 0.9;
      sp = coast < 250 ? (r < 0.7 ? 1 : 2) : r < 0.82 ? 0 : r < 0.9 ? 1 : 2;
      break;
  }
  return p > 0 ? Math.round(Math.min(1, p) * 100) * 10 + sp : 0; // encoded: probability in percent * 10 + species
}

export function buildVegetation(t: Terrain, sc: Scenario, cleared: Uint8Array, density: number, maxInstances: number, castShadow: boolean): VegetationBuild {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const species = speciesFor(sc.vegetation);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  // wind sway in the vertex shader
  const uniforms = { time: { value: 0 }, wind: { value: 1 } };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.time = uniforms.time;
    sh.uniforms.wind = uniforms.wind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float time;\nuniform float wind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
        float ph = instanceMatrix[3][0] * 0.05 + instanceMatrix[3][2] * 0.07;
        float sway = sin(time * (1.2 + wind * 0.15) + ph) * 0.03 * wind * max(0.0, position.y);
        transformed.x += sway;
        transformed.z += sway * 0.6;
        #endif`,
      );
  };
  const slope = t.slopeGrid();
  const { W, H } = t;
  // estimate total candidates to scale density under the instance budget
  let candidates = 0;
  for (let k = 0; k < W * H; k += 7) {
    if (!(t.mask[k] & 3)) continue;
    const code = plant(sc.vegetation, t.mask[k], t.real[k], slope[k], t.coastDist[k], 0.5);
    candidates += Math.floor(code / 10) / 100;
  }
  candidates *= 7;
  const perCell = Math.max(0.2, (density * 4.5));
  const budgetScale = Math.min(1, maxInstances / Math.max(1, candidates * perCell));
  const per = perCell * budgetScale;
  const dummy = new THREE.Object3D();
  let count = 0;
  const cw = Math.ceil(W / VCHUNK), ch = Math.ceil(H / VCHUNK);
  for (let cj = 0; cj < ch; cj++) {
    for (let ci = 0; ci < cw; ci++) {
      const lists: THREE.Matrix4[][] = species.map(() => []);
      const rnd = seq(ci * 7919 + cj * 104729 + 1);
      for (let j = cj * VCHUNK; j < Math.min(H, (cj + 1) * VCHUNK); j++) {
        for (let i = ci * VCHUNK; i < Math.min(W, (ci + 1) * VCHUNK); i++) {
          const k = j * W + i;
          if (!(t.mask[k] & 3) || cleared[k]) continue;
          const code = plant(sc.vegetation, t.mask[k], t.real[k], slope[k], t.coastDist[k], rnd());
          if (!code) continue;
          const p = Math.floor(code / 10) / 100;
          let n = p * per;
          while (n > 0) {
            if (rnd() < Math.min(1, n)) {
              const sp = code % 10;
              const [x, z] = t.toWorld(i + rnd() - 0.5, j + rnd() - 0.5);
              const y = t.heightAt(x, z);
              if (y < 0.5) {
                n -= 1;
                continue;
              }
              const s = 0.7 + rnd() * 0.7;
              dummy.position.set(x, y - 0.3, z);
              dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
              dummy.scale.set(s, s * (0.85 + rnd() * 0.3), s);
              dummy.updateMatrix();
              lists[Math.min(sp, species.length - 1)].push(dummy.matrix.clone());
            }
            n -= 1;
          }
        }
      }
      lists.forEach((mats, si) => {
        if (!mats.length) return;
        const im = new THREE.InstancedMesh(species[si].geo, mat, mats.length);
        mats.forEach((m, idx) => im.setMatrixAt(idx, m));
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = castShadow;
        im.receiveShadow = false;
        im.computeBoundingSphere();
        im.userData.chunkCenter = t.toWorld((ci + 0.5) * VCHUNK, (cj + 0.5) * VCHUNK);
        im.userData.chunkRadius = VCHUNK * t.cell * 0.71;
        group.add(im);
        count += mats.length;
      });
    }
  }
  return {
    group,
    count,
    dispose() {
      for (const c of group.children) (c as THREE.InstancedMesh).dispose();
      mat.dispose();
    },
  };
}
