// Terrain rendering: chunked heightfield meshes with three levels of detail, an albedo texture baked from
// elevation/slope/land cover, and an overlay texture blended in the shader.

import * as THREE from 'three';
import { MASK, type Terrain } from '../geo/terrain';
import type { Scenario } from '../data/scenarios';

export const CHUNK = 64;

interface Biome {
  low: [number, number, number];
  high: [number, number, number];
  rock: [number, number, number];
  forest: [number, number, number];
  sand: [number, number, number];
  seabedShallow: [number, number, number];
  seabedDeep: [number, number, number];
}

const BIOMES: Record<Scenario['vegetation'], Biome> = {
  temperate: { low: [104, 128, 66], high: [122, 112, 74], rock: [128, 124, 114], forest: [58, 84, 44], sand: [205, 195, 160], seabedShallow: [150, 150, 120], seabedDeep: [40, 64, 66] },
  mediterranean: { low: [138, 136, 88], high: [112, 120, 74], rock: [164, 156, 134], forest: [92, 112, 62], sand: [222, 208, 170], seabedShallow: [210, 200, 160], seabedDeep: [40, 80, 100] },
  rainforest: { low: [52, 86, 44], high: [70, 92, 52], rock: [96, 94, 86], forest: [36, 66, 34], sand: [170, 160, 130], seabedShallow: [120, 120, 100], seabedDeep: [30, 50, 58] },
  tropical: { low: [86, 140, 64], high: [52, 104, 46], rock: [92, 88, 80], forest: [40, 92, 40], sand: [236, 226, 192], seabedShallow: [230, 222, 190], seabedDeep: [30, 70, 100] },
};

function mix(a: number[], b: number[], t: number) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Albedo texture (RGBA8) at grid resolution. */
export function buildColorTexture(t: Terrain, sc: Scenario): THREE.DataTexture {
  const { W, H } = t;
  const b = BIOMES[sc.vegetation];
  const data = new Uint8Array(W * H * 4);
  const slope = t.slopeGrid();
  const maxE = Math.max(30, t.meta.stats.maxElevation);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const m = t.mask[k];
      const e = t.real[k];
      let c: number[];
      if ((m & 3) === MASK.sea) {
        const dd = Math.min(1, -e / 25);
        c = mix(b.seabedShallow, b.seabedDeep, Math.sqrt(dd));
        if (m & MASK.reef && sc.vegetation === 'tropical') c = mix(c, [190, 170, 140], 0.25);
      } else {
        const h = Math.min(1, e / maxE);
        c = mix(b.low, b.high, Math.pow(h, 0.8));
        if (m & MASK.forest || ((sc.vegetation === 'rainforest' || sc.vegetation === 'tropical') && slope[k] > 6 && e > 8)) c = mix(c, b.forest, 0.75);
        const s = slope[k];
        if (s > 26) c = mix(c, b.rock, Math.min(1, (s - 26) / 18));
        if (e < 2.2 || m & MASK.beach) c = mix(c, b.sand, m & MASK.beach ? 0.85 : Math.max(0, (2.2 - e) / 2.2) * 0.8);
        if ((m & 3) === MASK.foreign) c = mix(c, [128, 128, 120], 0.25);
      }
      // baked hillshade from the north-west for detail at a distance
      const l = t.heights[j * W + Math.max(0, i - 1)];
      const r = t.heights[j * W + Math.min(W - 1, i + 1)];
      const u = t.heights[Math.max(0, j - 1) * W + i];
      const dn = t.heights[Math.min(H - 1, j + 1) * W + i];
      const shade = Math.max(0.75, Math.min(1.18, 1 + ((l - r) + (u - dn)) / (t.cell * 4)));
      data[k * 4] = Math.min(255, c[0] * shade);
      data[k * 4 + 1] = Math.min(255, c[1] * shade);
      data[k * 4 + 2] = Math.min(255, c[2] * shade);
      data[k * 4 + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

export function makeOverlayTexture(t: Terrain): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(t.W * t.H * 4), t.W, t.H, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

export function terrainMaterial(color: THREE.Texture, overlay: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map: color, roughness: 0.95, metalness: 0 });
  const uniforms = { overlayMap: { value: overlay }, overlayStrength: { value: 0 } };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.overlayMap = uniforms.overlayMap;
    sh.uniforms.overlayStrength = uniforms.overlayStrength;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D overlayMap;\nuniform float overlayStrength;\nvarying vec3 vWPos;\nfloat nfHash(vec2 p){return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453);}\nfloat nfNoise(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(nfHash(i),nfHash(i+vec2(1,0)),f.x),mix(nfHash(i+vec2(0,1)),nfHash(i+vec2(1,1)),f.x),f.y);}')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float nd = nfNoise(vWPos.xz * 0.08) * 0.6 + nfNoise(vWPos.xz * 0.5) * 0.4;
        diffuseColor.rgb *= 0.88 + 0.24 * nd;
        vec4 ov = texture2D(overlayMap, vMapUv);
        diffuseColor.rgb = mix(diffuseColor.rgb, ov.rgb, ov.a * overlayStrength);`,
      );
  };
  return mat;
}

/** Geometry for one chunk at a given sampling step, with skirts to hide LOD seams. */
export function chunkGeometry(t: Terrain, ci: number, cj: number, step: number): THREE.BufferGeometry {
  const { W, H, heights, cell } = t;
  const i0 = ci * CHUNK, j0 = cj * CHUNK;
  const i1 = Math.min(W - 1, i0 + CHUNK), j1 = Math.min(H - 1, j0 + CHUNK);
  const xs: number[] = [];
  for (let i = i0; i < i1; i += step) xs.push(i);
  xs.push(i1);
  const zs: number[] = [];
  for (let j = j0; j < j1; j += step) zs.push(j);
  zs.push(j1);
  const nx = xs.length, nz = zs.length;
  const vcount = nx * nz + 2 * (nx + nz);
  const pos = new Float32Array(vcount * 3);
  const nor = new Float32Array(vcount * 3);
  const uv = new Float32Array(vcount * 2);
  const hAt = (i: number, j: number) => heights[Math.min(H - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))];
  let v = 0;
  const put = (i: number, j: number, dy = 0) => {
    const [x, z] = t.toWorld(i, j);
    const y = hAt(i, j) + dy;
    pos[v * 3] = x;
    pos[v * 3 + 1] = y;
    pos[v * 3 + 2] = z;
    const gx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * cell);
    const gz = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * cell);
    const l = Math.hypot(gx, 1, gz);
    nor[v * 3] = -gx / l;
    nor[v * 3 + 1] = 1 / l;
    nor[v * 3 + 2] = -gz / l;
    uv[v * 2] = (i + 0.5) / W;
    uv[v * 2 + 1] = (j + 0.5) / H;
    return v++;
  };
  for (const j of zs) for (const i of xs) put(i, j);
  const idx: number[] = [];
  for (let b = 0; b < nz - 1; b++) {
    for (let a = 0; a < nx - 1; a++) {
      const p = b * nx + a;
      idx.push(p, p + nx, p + 1, p + 1, p + nx, p + nx + 1);
    }
  }
  // skirts
  const skirt = Math.max(15, cell * 1.5);
  const edge = (list: number[]) => {
    const base = v;
    for (const k of list) {
      const i = xs[k % nx], j = zs[Math.floor(k / nx)];
      put(i, j, -skirt);
    }
    for (let s = 0; s + 1 < list.length; s++) {
      const a = list[s], b = list[s + 1], c = base + s, d = base + s + 1;
      idx.push(a, c, b, b, c, d, a, b, c, b, d, c);
    }
  };
  edge(Array.from({ length: nx }, (_, a) => a));
  edge(Array.from({ length: nx }, (_, a) => (nz - 1) * nx + a));
  edge(Array.from({ length: nz }, (_, b) => b * nx));
  edge(Array.from({ length: nz }, (_, b) => b * nx + nx - 1));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv.subarray(0, v * 2), 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Build the terrain group: one THREE.LOD per chunk. */
export function buildTerrainGroup(t: Terrain, mat: THREE.Material, baseStep: number, lodScale: number, castShadow: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'terrain';
  const cw = Math.ceil((t.W - 1) / CHUNK), ch = Math.ceil((t.H - 1) / CHUNK);
  const size = CHUNK * t.cell;
  for (let cj = 0; cj < ch; cj++) {
    for (let ci = 0; ci < cw; ci++) {
      const lod = new THREE.LOD();
      const steps = [baseStep, baseStep * 2, baseStep * 4].map((s) => Math.min(s, 16));
      steps.forEach((s, li) => {
        const m = new THREE.Mesh(chunkGeometry(t, ci, cj, s), mat);
        m.receiveShadow = true;
        m.castShadow = castShadow && li === 0;
        m.matrixAutoUpdate = false;
        lod.addLevel(m, li === 0 ? 0 : size * lodScale * (li === 1 ? 1.4 : 3.2));
      });
      lod.matrixAutoUpdate = false;
      group.add(lod);
    }
  }
  return group;
}

// ------------------------------------------------------------------ water

export function depthTexture(t: Terrain): THREE.DataTexture {
  const data = new Uint8Array(t.W * t.H * 4);
  for (let k = 0; k < t.W * t.H; k++) {
    const d = Math.max(0, -t.real[k]);
    data[k * 4] = Math.min(255, Math.sqrt(d / 80) * 255);
    data[k * 4 + 1] = t.mask[k] & MASK.reef ? 255 : 0;
    data[k * 4 + 2] = 0;
    data[k * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, t.W, t.H, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

const WATER_COLORS: Record<Scenario['vegetation'], { shallow: string; deep: string }> = {
  temperate: { shallow: '#3c7f7c', deep: '#0f2f3f' },
  mediterranean: { shallow: '#36b3c2', deep: '#0b3a66' },
  rainforest: { shallow: '#3a6f73', deep: '#0d2837' },
  tropical: { shallow: '#3fd8cf', deep: '#063a6e' },
};

export function waterMaterial(t: Terrain, sc: Scenario, depthTex: THREE.Texture): THREE.ShaderMaterial {
  const wc = WATER_COLORS[sc.vegetation];
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        time: { value: 0 },
        depthMap: { value: depthTex },
        mapSize: { value: new THREE.Vector2(t.widthM, t.depthM) },
        shallow: { value: new THREE.Color(wc.shallow) },
        deep: { value: new THREE.Color(wc.deep) },
        sunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
        sunColor: { value: new THREE.Color(1, 0.96, 0.9) },
        skyColor: { value: new THREE.Color('#9cc3e0') },
        light: { value: 1 },
        wave: { value: 1 },
        windDir: { value: new THREE.Vector2(1, 0) },
      },
    ]),
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform float time; uniform sampler2D depthMap; uniform vec2 mapSize;
      uniform vec3 shallow; uniform vec3 deep; uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 skyColor;
      uniform float light; uniform float wave; uniform vec2 windDir;
      varying vec3 vW;
      vec2 wv(vec2 p, vec2 d, float f, float s) { float ph = dot(p, d) * f + time * s; return d * cos(ph) * f; }
      void main() {
        vec2 uv = vW.xz / mapSize + 0.5;
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        vec4 dm = texture2D(depthMap, clamp(uv, 0.0, 1.0));
        float depth = mix(1.0, dm.r, inside);
        float reef = dm.g * inside;
        vec2 p = vW.xz;
        vec2 g = vec2(0.0);
        vec2 wd = normalize(windDir + vec2(0.0001));
        float camD = length(cameraPosition - vW);
        // fade out small waves with distance to avoid moire
        float f1 = 1.0 - smoothstep(600.0, 3000.0, camD);
        float f2 = 1.0 - smoothstep(200.0, 1200.0, camD);
        g += wv(p, wd, 0.045, 1.3) * 0.35 * (1.0 - smoothstep(3000.0, 12000.0, camD));
        g += wv(p, normalize(wd + vec2(0.4, -0.3)), 0.11, 2.1) * 0.18 * f1;
        g += wv(p, normalize(vec2(-wd.y, wd.x) + wd * 0.3), 0.23, 2.9) * 0.08 * f2;
        g += wv(p, normalize(vec2(0.7, 0.7)), 0.6, 4.0) * 0.03 * f2;
        vec3 n = normalize(vec3(-g.x * wave, 1.0, -g.y * wave));
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 5.0) * 0.55 + 0.03;
        vec3 base = mix(shallow, deep, smoothstep(0.0, 0.85, depth));
        base = mix(base, base * 1.15 + vec3(0.04, 0.06, 0.04), reef * 0.25);
        vec3 col = mix(base * light, skyColor, fres);
        vec3 H = normalize(normalize(sunDir) + V);
        // sharp glint near the camera, broad soft sheen far away (where wave detail is filtered out)
        float far = smoothstep(800.0, 6000.0, camD);
        float spec = pow(max(dot(n, H), 0.0), mix(300.0, 60.0, far)) * mix(1.4, 0.25, far) * light;
        col += sunColor * min(spec, 1.2);
        float foam = smoothstep(0.035, 0.0, depth) * inside * (0.4 + 0.6 * fract(sin(dot(floor(p * 0.3), vec2(12.9, 78.2))) * 43758.5));
        col = mix(col, vec3(0.92) * light, foam * 0.5);
        float alpha = mix(0.55, 0.96, smoothstep(0.0, 0.5, depth));
        alpha = max(alpha, fres);
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }`,
  });
}
