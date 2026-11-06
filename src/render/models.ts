// Procedural building models for every catalogue form, in seven architectural styles.
// Local frame: x across, z along depth (+z faces the sea for ports), y up from the foundation.

import * as THREE from 'three';
import { BUILDING_MAP, type BuildingDef } from '../data/catalogue';
import { STYLES, type Style } from '../data/styles';
import { Kit, seq } from './kit';

const cache = new Map<string, THREE.BufferGeometry>();

export function modelFor(type: string, style: Style, variant = 0): THREE.BufferGeometry {
  const key = `${type}|${style}|${variant}`;
  let g = cache.get(key);
  if (!g) {
    const k = new Kit();
    build(k, BUILDING_MAP[type], style, variant);
    g = k.geometry();
    cache.set(key, g);
  }
  return g;
}

export const VARIANTS = 3;

function pal(style: Style, r: () => number) {
  const p = STYLES[style];
  return { wall: p.walls[Math.floor(r() * p.walls.length)], roof: p.roofs[Math.floor(r() * p.roofs.length)], trim: p.trim, glass: p.glass, roofType: p.roof };
}

/** A single house with style-appropriate roof. */
function house(k: Kit, x: number, z: number, w: number, d: number, h: number, style: Style, r: () => number, rot = 0) {
  const p = pal(style, r);
  k.box(x, -2, z, w, h + 2, d, p.wall, rot);
  const floors = Math.max(1, Math.round(h / 3.2));
  k.windows(x, 0, z, w, d, floors, h / floors, p.glass, rot, 3.2);
  switch (p.roofType) {
    case 'steep':
      k.gable(x, h, z, w + 0.8, d + 0.8, Math.min(w, d) * 0.55, p.roof, d > w, rot);
      k.box(x + (w / 2 - 1) * Math.cos(rot), h, z - (w / 2 - 1) * Math.sin(rot), 0.9, Math.min(w, d) * 0.6, 0.9, '#7a6f66', rot);
      break;
    case 'hip':
      k.hip(x, h, z, w + 0.6, d + 0.6, Math.min(w, d) * 0.25, p.roof, rot);
      break;
    case 'gable':
      k.gable(x, h, z, w + (style === 'tropical' ? 2.4 : 1), d + (style === 'tropical' ? 2.4 : 1), Math.min(w, d) * 0.35, p.roof, d > w, rot);
      if (style === 'tropical') k.box(x + Math.sin(rot) * (d / 2 + 1), 0, z + Math.cos(rot) * (d / 2 + 1), w, 0.3, 2, '#b08a5a', rot);
      break;
    case 'flat':
      k.box(x, h, z, w + 0.3, 0.6, d + 0.3, p.roof, rot);
      break;
    case 'curved':
      k.cylinder(x, h - 0.2, z, Math.min(w, d) * 0.5, Math.min(w, d) * 0.25, p.roof, 12, Math.min(w, d) * 0.15);
      break;
  }
}

function block(k: Kit, x: number, z: number, w: number, d: number, h: number, style: Style, r: () => number, rot = 0, floorH = 3.3) {
  const p = pal(style, r);
  k.box(x, -2, z, w, h + 2, d, p.wall, rot);
  const floors = Math.max(1, Math.floor(h / floorH));
  k.windows(x, 0, z, w, d, floors, floorH, p.glass, rot, style === 'highrise' || style === 'futuristic' ? 2.2 : 3.4);
  if (p.roofType === 'steep') k.gable(x, h, z, w + 0.6, d + 0.6, Math.min(w, d) * 0.45, p.roof, d > w, rot);
  else if (p.roofType === 'hip') k.hip(x, h, z, w + 0.4, d + 0.4, Math.min(w, d) * 0.18, p.roof, rot);
  else if (p.roofType === 'curved') k.cylinder(x, h, z, Math.min(w, d) * 0.45, 3, p.trim, 14, Math.min(w, d) * 0.2);
  else {
    k.box(x, h, z, w + 0.2, 0.9, d + 0.2, p.roof, rot);
    k.box(x, h + 0.9, z, w * 0.3, 2.2, d * 0.3, '#8a9096', rot);
  }
  if (style === 'mediterranean' || style === 'tropical') {
    for (let f = 1; f < floors; f++) k.box(x + Math.sin(rot) * (d / 2 + 0.6), f * floorH, z + Math.cos(rot) * (d / 2 + 0.6), w * 0.85, 0.25, 1.2, p.trim, rot);
  }
}

function tree(k: Kit, x: number, z: number, s: number, style: Style) {
  k.box(x, 0, z, 0.4 * s, 2 * s, 0.4 * s, '#6b4b2a');
  if (style === 'tropical') {
    k.blob(x, 4 * s, z, 2.2 * s, 0.6 * s, '#3d8b3d');
  } else k.blob(x, 2.8 * s, z, 1.6 * s, 1.6 * s, style === 'mediterranean' ? '#6b8e3d' : '#3f7a3a');
}

function pier(k: Kit, x: number, z0: number, z1: number, w: number, color = '#9c968a') {
  const len = z1 - z0;
  k.box(x, -6, z0 + len / 2, w, 7.5, len, color);
  for (let s = 0; s < len; s += 8) k.box(x - w / 2 + 0.3, 1.5, z0 + s + 1, 0.4, 1, 0.4, '#555');
}

function boat(k: Kit, x: number, z: number, len: number, hull = '#f4f4f0', rot = 0) {
  k.box(x, 0, z, len * 0.35, 1.2, len, hull, rot);
  k.box(x, 1.2, z - len * 0.1 * Math.cos(rot), len * 0.25, 1.4, len * 0.3, '#ddd', rot);
}

function crane(k: Kit, x: number, z: number, h: number, color = '#d9a321', rot = 0) {
  k.box(x, 0, z, 2, h, 2, color);
  k.box(x + Math.sin(rot) * 8, h, z + Math.cos(rot) * 8, 1.4, 1.4, 26, color, rot);
  k.box(x, h, z, 3, 3, 4, '#555');
}

function build(k: Kit, d: BuildingDef, style: Style, variant: number) {
  const r = seq(hash(d.id) + variant * 7919 + hash(style));
  const [W, D] = d.size;
  const H = d.h;
  const p = pal(style, r);
  switch (d.form) {
    // ---------------- housing
    case 'cottage':
      house(k, -W / 4, 0, W * 0.42, D * 0.7, 3.4, style, r);
      house(k, W / 4, 0, W * 0.42, D * 0.7, 3.6, style, r);
      break;
    case 'houses':
      for (let i = 0; i < 4; i++) house(k, (i % 2 ? 1 : -1) * W * 0.24, (i < 2 ? -1 : 1) * D * 0.22, W * 0.36, D * 0.36, 3.4 + r() * 3, style, r);
      break;
    case 'terrace': {
      const n = 5;
      for (let i = 0; i < n; i++) house(k, -W / 2 + (i + 0.5) * (W / n), 0, W / n - 0.2, D * 0.8, 6.5 + (r() < 0.3 ? 1 : 0), style, r);
      break;
    }
    case 'apartments':
      block(k, 0, 0, W * 0.9, D * 0.8, H, style, r);
      break;
    case 'tower':
      if (style === 'futuristic') {
        k.cylinder(0, -2, 0, W * 0.4, H + 2, p.wall, 16, W * 0.3);
        for (let f = 4; f < H; f += 4) k.cylinder(0, f, 0, W * 0.4 - (f / H) * W * 0.1 + 0.15, 1.2, p.glass, 16, W * 0.4 - (f / H) * W * 0.1 + 0.15, false);
      } else {
        block(k, 0, 0, W * 0.8, D * 0.8, H * 0.7, style === 'highrise' ? 'highrise' : 'highrise', r, 3.2);
        block(k, 0, 0, W * 0.55, D * 0.55, H, 'highrise', r, 3.2);
      }
      break;
    case 'ecovillage':
      for (let i = 0; i < 6; i++) house(k, -W / 2 + 7 + (i % 3) * (W / 3), -D / 4 + Math.floor(i / 3) * (D / 2), 8, 7, 3.2, 'rural', r, r() * 0.4);
      k.box(0, 0.2, D / 2 - 3, W * 0.6, 0.3, 3, '#283e5a');
      break;
    // ---------------- commerce
    case 'shop':
      house(k, 0, -D * 0.1, W * 0.9, D * 0.7, 4.5, style, r);
      k.box(0, 2.6, D * 0.35, W * 0.9, 0.3, 2.5, ['#c0392b', '#2e86c1', '#27ae60', '#e67e22'][variant % 4]);
      break;
    case 'market':
      k.box(0, -2, 0, W, 6.5, D, p.wall);
      k.gable(0, 4.5, 0, W + 1.5, D + 1.5, 4, p.roof);
      for (let i = 0; i < 6; i++) k.box(-W / 2 + 3 + i * ((W - 6) / 5), 0, D / 2 + 1.5, 2.5, 2.2, 2, ['#c0392b', '#f1c40f', '#27ae60'][i % 3]);
      break;
    case 'office':
      block(k, 0, 0, W * 0.9, D * 0.85, H, style === 'european' ? 'european' : style === 'futuristic' ? 'futuristic' : 'highrise', r, 3.6);
      break;
    case 'campus':
      block(k, -W * 0.25, -D * 0.15, W * 0.45, D * 0.5, H, 'futuristic', r, 4);
      block(k, W * 0.25, D * 0.1, W * 0.4, D * 0.6, H * 0.7, 'highrise', r, 4);
      k.box(0, 0, D * 0.3, W * 0.3, 0.2, D * 0.3, '#5aa05a');
      break;
    case 'datacentre':
      k.box(0, -2, 0, W, H + 2, D, '#e8ecef');
      for (let i = 0; i < 6; i++) k.box(-W / 2 + 5 + i * ((W - 10) / 5), H, 0, 4, 2, 4, '#9aa5ad');
      break;
    // ---------------- tourism
    case 'guesthouse':
      house(k, 0, 0, W * 0.8, D * 0.7, 6.5, style, r);
      tree(k, W * 0.4, D * 0.4, 0.8, style);
      break;
    case 'hotel':
      block(k, 0, -D * 0.1, W * 0.95, D * 0.6, H, style, r, 3.3);
      block(k, -W * 0.35, D * 0.2, W * 0.25, D * 0.5, H * 0.6, style, r, 3.3);
      k.box(W * 0.2, 0, D * 0.38, W * 0.3, 0.3, D * 0.18, '#3fb6d6');
      break;
    case 'resort':
      block(k, 0, -D * 0.25, W * 0.5, D * 0.3, H, style, r, 3.4);
      for (let i = 0; i < 8; i++) house(k, -W / 2 + 8 + (i % 4) * (W / 4.2), D * 0.1 + Math.floor(i / 4) * D * 0.22, 9, 8, 3.4, style, r, r() * 0.3);
      k.box(W * 0.28, 0, -D * 0.25, W * 0.25, 0.3, D * 0.2, '#3fb6d6');
      for (let i = 0; i < 6; i++) tree(k, -W / 2 + r() * W, -D / 2 + r() * D, 1.2, style);
      break;
    case 'lodge':
      for (let i = 0; i < 5; i++) house(k, -W / 2 + 6 + (i % 3) * (W / 3), -D / 4 + Math.floor(i / 3) * (D / 2), 8, 6, 3, 'rural', r, r() * 0.6);
      break;
    case 'dive':
      house(k, 0, -D * 0.2, W * 0.7, D * 0.5, 3.5, style, r);
      k.box(0, 0, D * 0.3, 2.5, 0.4, D * 0.6, '#9c7a52');
      break;
    case 'visitor':
      house(k, 0, 0, W * 0.9, D * 0.75, 6, style, r);
      k.box(0, 0, D * 0.38 + 0.1, W * 0.6, 4.5, 0.2, '#6fa8c8');
      break;
    case 'castle': {
      const stone = style === 'mediterranean' ? '#cdbb98' : style === 'tropical' ? '#8a7f6a' : '#a8a194';
      k.box(0, -2, 0, W * 0.7, 14, D * 0.6, stone);
      k.gable(0, 12, 0, W * 0.72, D * 0.62, 6, '#4a4f57');
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        k.cylinder(sx * W * 0.36, -2, sz * D * 0.3, 3.2, 18, stone, 10);
        k.cone(sx * W * 0.36, 16, sz * D * 0.3, 3.6, 6, '#4a4f57', 10);
      }
      k.box(0, -2, -D * 0.35, 5, 22, 5, stone);
      for (let i = -2; i <= 2; i++) k.box(i * 1.1, 20, -D * 0.35, 0.8, 1.2, 5.2, stone);
      k.windows(0, 0, 0, W * 0.7, D * 0.6, 3, 4, '#2c3440', 0, 3);
      break;
    }
    // ---------------- farming & industry
    case 'farm': {
      const cols = ['#c9b35a', '#8fae4a', '#a7c35f', '#b8913f', '#7fa043'];
      for (let i = 0; i < 4; i++) k.box(-W / 2 + (i + 0.5) * (W / 4) , 0, D * 0.12, W / 4 - 2, 0.25, D * 0.7, cols[(i + variant) % cols.length]);
      house(k, -W * 0.3, -D * 0.4, 10, 8, 4, style === 'tropical' ? 'tropical' : 'rural', r);
      k.box(W * 0.15, -1, -D * 0.4, 16, 7, 9, '#8d3b2b');
      k.gable(W * 0.15, 6, -D * 0.4, 17, 10, 3.5, '#5a5a5a');
      k.cylinder(W * 0.35, 0, -D * 0.4, 2.5, 10, '#b8b8b8', 10);
      break;
    }
    case 'barn':
      k.box(-W * 0.2, -1, -D * 0.25, 14, 6, 8, '#9a8b74');
      k.gable(-W * 0.2, 5, -D * 0.25, 15, 9, 3, '#4c4f52');
      for (let i = 0; i < 4; i++) k.box(-W / 2 + 2, 0, -D / 2 + i * (D / 3), 0.6, 1.2, D / 3, '#8a8478');
      for (let i = 0; i < 14; i++) k.box((r() - 0.5) * W * 0.8, 0.3, (r() - 0.2) * D * 0.6, 1.2, 0.9, 0.7, '#efefe8', r() * 3);
      break;
    case 'orchard': {
      const crown = d.id === 'vineyard' ? '#5e7f2e' : d.id === 'fruit_plantation' ? '#6f9b38' : '#8a9a5b';
      const rowsN = 7, colsN = 9;
      for (let i = 0; i < colsN; i++) for (let j = 0; j < rowsN; j++) {
        const x = -W / 2 + (i + 0.5) * (W / colsN), z = -D / 2 + 8 + (j + 0.5) * ((D - 10) / rowsN);
        if (d.id === 'vineyard') k.box(x, 0, z, W / colsN - 1.5, 1.3, 1, crown);
        else k.blob(x, 1.6, z, 1.7, 1.3, crown);
      }
      house(k, -W * 0.35, -D / 2 + 4, 10, 7, 4, style, r);
      break;
    }
    case 'boats':
      k.box(0, -1, -D * 0.2, W * 0.6, 5, D * 0.5, '#7d8b96');
      k.gable(0, 4, -D * 0.2, W * 0.62, D * 0.52, 2, '#56616a');
      for (let i = 0; i < 3; i++) boat(k, -W / 3 + i * (W / 3), D * 0.45, 7, ['#c0392b', '#2e86c1', '#f4f4f0'][i]);
      break;
    case 'plant':
      k.box(-W * 0.15, -2, 0, W * 0.6, H + 2, D * 0.8, '#a4a9ad');
      k.box(-W * 0.15, H, 0, W * 0.62, 0.6, D * 0.82, '#6f7c84');
      for (let i = 0; i < 3; i++) k.cylinder(W * 0.3, 0, -D / 3 + i * (D / 3), 3, H * 0.9, '#d0d4d6', 10);
      break;
    case 'aquafarm':
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
        if (d.id === 'pearl_farm') {
          k.box(-W / 3 + i * (W / 3), -0.2, -D / 4 + j * (D / 2), W / 4, 0.5, 0.6, '#d8d8d0');
          for (let b = 0; b < 5; b++) k.cylinder(-W / 3 + i * (W / 3) - W / 8 + b * (W / 16), -0.2, -D / 4 + j * (D / 2), 0.5, 0.7, '#f0f0f0', 6);
        } else {
          k.cylinder(-W / 3 + i * (W / 3), -0.3, -D / 4 + j * (D / 2), 8, 0.8, '#3c464d', 14, 8, false);
          k.cylinder(-W / 3 + i * (W / 3), -0.3, -D / 4 + j * (D / 2), 7.2, 0.6, '#253038', 14, 7.2, true);
        }
      }
      break;
    case 'distillery': {
      const stone = style === 'european' ? '#ece6da' : '#d8cfbf';
      k.box(-W * 0.15, -2, 0, W * 0.6, 11, D * 0.8, stone);
      k.gable(-W * 0.15, 9, 0, W * 0.62, D * 0.82, 4, '#3e434a');
      // pagoda roof over the old malting kiln
      k.box(W * 0.25, -2, 0, 9, 13, 9, stone);
      k.hip(W * 0.25, 11, 0, 10, 10, 5, '#3e434a');
      k.box(W * 0.25, 15.5, 0, 3, 2, 3, '#3e434a');
      k.hip(W * 0.25, 17.5, 0, 4, 4, 2, '#3e434a');
      k.windows(-W * 0.15, 0, 0, W * 0.6, D * 0.8, 2, 4, '#2c3440', 0, 4);
      break;
    }
    case 'sawmill':
      k.box(0, -1, -D * 0.15, W * 0.7, H, D * 0.5, '#8b6a4a');
      k.gable(0, H - 1, -D * 0.15, W * 0.72, D * 0.55, 3, '#5f666b');
      for (let i = 0; i < 5; i++) k.box(-W / 2 + 5 + i * 8, 0, D * 0.35, 6, 2.2, 6, '#a07a4f', 0.2 * i);
      break;
    case 'quarry':
      for (let i = 0; i < 4; i++) k.box(0, -1, -D / 2 + 6 + i * (D / 5), W * (1 - i * 0.18), 1 + i * 1.6, D / 5, i % 2 ? '#c9c2b2' : '#b5ad9b');
      k.box(W * 0.35, 0, D * 0.35, 6, 4, 4, '#d9a321');
      break;
    case 'workshop':
      for (let i = 0; i < 3; i++) {
        k.box(-W / 3 + i * (W / 3), -1, 0, W / 3 - 0.5, H, D * 0.85, i % 2 ? '#a4a9ad' : '#b8b2a6');
        k.gable(-W / 3 + i * (W / 3), H - 1, 0, W / 3, D * 0.88, 2.5, '#6f7c84', true);
      }
      break;
    case 'factory':
      k.box(0, -2, 0, W * 0.9, H + 2, D * 0.8, '#9ea4a8');
      for (let i = 0; i < 5; i++) k.gable(-W * 0.36 + i * (W * 0.18), H, 0, W * 0.18, D * 0.8, 3, '#6f7c84', true);
      k.cylinder(W * 0.35, H, -D * 0.25, 1.5, 16, '#8d4a3a', 8);
      k.cylinder(W * 0.25, H, -D * 0.25, 1.5, 14, '#8d4a3a', 8);
      break;
    case 'warehouse':
      k.box(0, -2, 0, W * 0.95, H + 2, D * 0.9, d.id === 'boatyard' ? '#5d7f9a' : '#b4a68e');
      k.gable(0, H, 0, W, D * 0.95, 3, '#5f666b');
      if (d.id === 'boatyard') boat(k, W * 0.2, D * 0.55, 12, '#f4f4f0');
      break;
    // ---------------- public
    case 'civic': {
      const tall = d.id === 'town_hall';
      block(k, 0, -D * 0.05, W * 0.85, D * 0.7, tall ? 10 : 7, style, r, 3.5);
      for (let i = 0; i < 6; i++) k.cylinder(-W * 0.3 + i * (W * 0.12), 0, D * 0.36, 0.6, tall ? 8 : 5, '#efe9dc', 8);
      k.box(0, tall ? 8 : 5, D * 0.36, W * 0.72, 1.2, 2, '#efe9dc');
      if (tall) {
        k.box(0, 10, -D * 0.05, 4, 8, 4, p.wall);
        k.cone(0, 18, -D * 0.05, 3.2, 4, p.roof, 4);
      }
      break;
    }
    case 'school':
      block(k, -W * 0.15, -D * 0.2, W * 0.65, D * 0.4, 7, style, r, 3.5);
      block(k, W * 0.3, 0, W * 0.25, D * 0.7, 7, style, r, 3.5);
      k.box(-W * 0.2, 0, D * 0.25, W * 0.5, 0.15, D * 0.4, '#6aa84f');
      break;
    case 'college':
      block(k, -W * 0.2, -D * 0.2, W * 0.5, D * 0.45, H, style, r, 4);
      block(k, W * 0.28, 0, W * 0.36, D * 0.7, H * 0.8, style, r, 4);
      k.box(-W * 0.2, 0, D * 0.25, W * 0.5, 0.15, D * 0.4, '#6aa84f');
      break;
    case 'clinic':
      block(k, 0, 0, W * 0.85, D * 0.8, H, style, r, 3.5);
      k.box(0, H + 0.6, 0, 4, 0.3, 1.2, '#d63a3a');
      k.box(0, H + 0.6, 0, 1.2, 0.3, 4, '#d63a3a');
      break;
    case 'hospital':
      block(k, 0, -D * 0.15, W * 0.9, D * 0.5, H, style === 'european' ? 'european' : 'highrise', r, 3.6);
      block(k, -W * 0.3, D * 0.25, W * 0.3, D * 0.4, H * 0.5, 'highrise', r, 3.6);
      k.cylinder(W * 0.25, 0, D * 0.3, 7, 0.3, '#5d6872', 16);
      k.box(W * 0.25, 0.3, D * 0.3, 5, 0.1, 1, '#f2f2f2');
      break;
    case 'station':
      house(k, -W * 0.15, 0, W * 0.6, D * 0.8, 7, style, r);
      k.box(W * 0.3, -1, 0, W * 0.35, 6, D * 0.8, d.id === 'fire_station' ? '#b03a2e' : '#2f4f8f');
      break;
    case 'park':
      k.box(0, 0, 0, W, 0.2, D, '#5f9e4a');
      k.box(0, 0.2, 0, W * 0.9, 0.05, 2, '#d8cfa8');
      k.box(0, 0.2, 0, 2, 0.05, D * 0.9, '#d8cfa8');
      for (let i = 0; i < 7; i++) tree(k, (r() - 0.5) * W * 0.85, (r() - 0.5) * D * 0.85, 0.9 + r() * 0.5, style);
      break;
    case 'lab':
      block(k, -W * 0.15, 0, W * 0.6, D * 0.8, H, 'highrise', r, 4);
      k.cylinder(W * 0.3, 0, 0, 7, 8, '#e6ecf0', 14);
      k.cylinder(W * 0.3, 8, 0, 7, 5, '#c8d0d6', 14, 0.5);
      break;
    // ---------------- utilities
    case 'diesel':
      k.box(-W * 0.15, -1, 0, W * 0.55, H, D * 0.8, '#8e9599');
      k.cylinder(W * 0.15, 0, -D * 0.25, 1, H + 8, '#6c6c6c', 8);
      k.cylinder(W * 0.32, 0, D * 0.15, 3.5, 6, '#c9c3b5', 10);
      break;
    case 'turbine':
      k.cylinder(0, -1, 0, 2.2, H + 1, '#eef1f2', 10, 1.3);
      k.box(0, H - 1, -1, 2.4, 2.6, 7, '#e6e9ea');
      break;
    case 'solar':
      for (let j = 0; j < 6; j++) for (let i = 0; i < 4; i++) {
        k.box(-W / 2 + 10 + i * ((W - 20) / 3), 0, -D / 2 + 6 + j * ((D - 12) / 5), (W - 20) / 3 - 3, 0.8, 0.4, '#666');
        k.box(-W / 2 + 10 + i * ((W - 20) / 3), 0.8, -D / 2 + 6 + j * ((D - 12) / 5), (W - 20) / 3 - 3, 0.15, 5, '#22355a');
      }
      break;
    case 'hydro':
      k.box(0, -1, 0, W * 0.6, H, D * 0.7, '#a8a194');
      k.gable(0, H - 1, 0, W * 0.62, D * 0.72, 2.5, '#4c4f52');
      k.cylinder(-W * 0.4, 0, -D * 0.6, 1.2, 1.2, '#4d5a63', 8);
      break;
    case 'battery':
      for (let i = 0; i < 4; i++) k.box(-W / 2 + 3.5 + i * ((W - 7) / 3), 0, 0, 5, 3, D * 0.7, '#e0e4e6');
      break;
    case 'well':
      k.box(0, -1, 0, 4, 4, 4, '#a8a194');
      k.gable(0, 3, 0, 4.6, 4.6, 1.6, '#5f5a52');
      k.cylinder(3, 0, 2, 1.5, 3, '#bfc5c8', 8);
      break;
    case 'tank':
      k.cylinder(0, -1, 0, W * 0.38, H + 1, '#c7c2b4', 12);
      break;
    case 'reservoir':
      k.box(0, -1, 0, W * 0.92, 1.6, D * 0.85, '#3b74a8');
      k.box(0, -2, D * 0.45, W, H + 2, 3, '#b9b4a8');
      break;
    case 'desal':
      k.box(-W * 0.15, -1, -D * 0.1, W * 0.6, H, D * 0.6, '#dfe5e8');
      for (let i = 0; i < 3; i++) k.cylinder(W * 0.3, 0, -D * 0.3 + i * (D * 0.3), 2.6, 6, '#9fb6c4', 10);
      k.box(0, -3, D * 0.4, 1, 1, D * 0.6, '#555');
      break;
    case 'wastewater':
      for (let i = 0; i < 3; i++) {
        k.cylinder(-W / 3 + i * (W / 3), -1, 0, 6.5, 3, '#b9b4a8', 16);
        k.cylinder(-W / 3 + i * (W / 3), 1.8, 0, 6, 0.3, '#5b7d5a', 16);
      }
      break;
    case 'recycling':
      k.box(0, -1, -D * 0.15, W * 0.7, H, D * 0.55, '#7f9a6a');
      for (let i = 0; i < 4; i++) k.box(-W / 2 + 5 + i * 8, 0, D * 0.35, 6, 2.5, 5, ['#8a6d4a', '#5b6c7a', '#9a9a9a', '#6a8a4a'][i]);
      break;
    case 'airstrip':
      k.box(0, -1, 0, W, 1.15, D * 0.5, '#3a3d40');
      for (let i = 0; i < 14; i++) k.box(-W / 2 + 25 + i * ((W - 50) / 13), 0.16, 0, 12, 0.05, 0.8, '#f2f2f2');
      house(k, 0, -D * 0.4, 18, 8, 5, style, r);
      break;
    case 'helipad':
      k.cylinder(0, -1, 0, W * 0.45, 1.3, '#4a4d50', 16);
      k.box(0, 0.32, 0, 1, 0.05, 6, '#f2f2f2');
      k.box(-2, 0.32, 0, 0.8, 0.05, 6, '#f2f2f2');
      k.box(2, 0.32, 0, 0.8, 0.05, 6, '#f2f2f2');
      k.box(0, 0.32, 0, 4, 0.05, 0.8, '#f2f2f2');
      break;
    case 'mast':
      k.cylinder(0, -1, 0, 1.6, H + 1, '#c9ced2', 4, 0.3, false);
      k.box(0, H * 0.75, 0, 3, 1.5, 0.4, '#e2e5e8');
      k.box(0, 0, 3, 3, 2.5, 2.5, '#a4a9ad');
      break;
    case 'depot':
      k.box(0, -1, -D * 0.1, W * 0.85, H, D * 0.6, '#a4a9ad');
      for (let i = 0; i < 3; i++) k.box(-W / 3 + i * (W / 3), 0, D * 0.35, 3, 3, 10, '#e2b33c');
      break;
    // ---------------- ports (local +z = seaward, origin on the shoreline at sea level)
    case 'harbour':
      k.box(-W * 0.25, -1, -D * 0.3, 10, 5, 8, p.wall);
      k.gable(-W * 0.25, 4, -D * 0.3, 10.5, 8.5, 2.5, p.roof);
      pier(k, 0, -D * 0.15, D * 0.5, 7);
      k.box(W * 0.2, -6, D * 0.1, 4, 7.4, D * 0.5, '#8f897d');
      boat(k, 6, D * 0.3, 9, '#2e86c1');
      boat(k, -6, D * 0.4, 7, '#c0392b');
      break;
    case 'marina':
      k.box(-W * 0.25, -1, -D * 0.35, 14, 5, 8, p.wall);
      pier(k, 0, -D * 0.3, D * 0.5, 3, '#a07a52');
      for (let i = 0; i < 5; i++) {
        k.box(0, 0.6, -D * 0.1 + i * (D * 0.13), W * 0.75, 0.4, 1.6, '#a07a52');
        for (const s of [-1, 1]) if (r() < 0.8) {
          const bx = s * (W * 0.12 + r() * W * 0.22), bz = -D * 0.1 + i * (D * 0.13) + s * 3;
          boat(k, bx, bz, 6, '#f6f6f2', Math.PI / 2);
          k.cylinder(bx, 1.2, bz, 0.12, 9, '#dddddd', 4);
        }
      }
      break;
    case 'port':
      k.box(0, -6, D * 0.1, W, 7.6, D * 0.6, '#9a958a');
      k.box(-W * 0.3, 1.6, -D * 0.25, W * 0.3, 9, D * 0.25, '#b4a68e');
      k.gable(-W * 0.3, 10.6, -D * 0.25, W * 0.31, D * 0.26, 3, '#5f666b');
      crane(k, -W * 0.1, D * 0.3, 20, '#d9a321', 0);
      crane(k, W * 0.2, D * 0.3, 20, '#d9a321', 0);
      for (let i = 0; i < 10; i++) k.box(W * 0.1 + (i % 5) * 7, 1.6, -D * 0.05 + Math.floor(i / 5) * 4, 6, 2.6, 2.5, ['#c0392b', '#2e86c1', '#27ae60', '#e67e22', '#7f8c8d'][i % 5]);
      break;
    case 'cruise':
      pier(k, 0, -D * 0.2, D * 0.5, 14);
      block(k, -W * 0.25, -D * 0.25, W * 0.4, D * 0.35, 12, style, r, 4);
      k.box(W * 0.25, 0, D * 0.15, 30, 1.6, 6, '#e8e8e8');
      break;
    case 'container':
      k.box(0, -6, 0, W, 7.6, D * 0.95, '#8d8d86');
      for (let i = 0; i < 3; i++) {
        const gx = -W * 0.3 + i * W * 0.3;
        k.box(gx - 6, 1.6, D * 0.38, 1.6, 34, 1.6, '#c0392b');
        k.box(gx + 6, 1.6, D * 0.38, 1.6, 34, 1.6, '#c0392b');
        k.box(gx, 34, D * 0.38, 14, 3, 50, '#c0392b');
      }
      for (let i = 0; i < 48; i++) {
        const cx = -W * 0.42 + (i % 12) * (W * 0.07), cz = -D * 0.35 + Math.floor(i / 12) * (D * 0.12);
        const stack = 1 + Math.floor(r() * 3);
        k.box(cx, 1.6, cz, 12, 2.6 * stack, 2.5, ['#c0392b', '#2e86c1', '#27ae60', '#e67e22', '#7f8c8d', '#8e44ad'][i % 6]);
      }
      break;
    case 'deepwater':
      k.box(0, -6, -D * 0.2, W, 7.6, D * 0.5, '#8d8d86');
      pier(k, 0, D * 0.05, D * 0.5, 10);
      for (let i = 0; i < 4; i++) k.cylinder(-W * 0.35 + i * 18, 1.6, -D * 0.3, 7, 12, '#d9d5c8', 14);
      crane(k, W * 0.2, D * 0.3, 30, '#c0392b', 0);
      crane(k, W * 0.35, D * 0.3, 30, '#c0392b', 0);
      break;
    default:
      k.box(0, -1, 0, W, H, D, p.wall);
  }
}

/** Scaffolding for a building under construction (unit height, scaled by progress). */
export function scaffoldModel(type: string): THREE.BufferGeometry {
  const key = `scaffold|${type}`;
  let g = cache.get(key);
  if (g) return g;
  const d = BUILDING_MAP[type];
  const [W, D] = d.size;
  const k = new Kit();
  const port = !!d.port;
  if (port) {
    k.box(0, -6, D * 0.1, W * 0.8, 7.2, D * 0.5, '#9a958a');
  } else {
    k.box(0, -1.5, 0, W * 0.95, 1.7, D * 0.95, '#b9b2a3');
  }
  const h = 1;
  const posts = 4;
  for (let i = 0; i <= posts; i++) for (const s of [-1, 1]) {
    k.box(-W * 0.4 + (i * W * 0.8) / posts, 0, s * D * 0.4, 0.04, h, 0.04 * (D / W), '#c8a35a');
    k.box(s * W * 0.4, 0, -D * 0.4 + (i * D * 0.8) / posts, 0.04 * (W / D), h, 0.04, '#c8a35a');
  }
  for (let y = 0.25; y <= 1; y += 0.25) {
    k.box(0, y * h, -D * 0.4, W * 0.8, 0.02, 0.05, '#c8a35a');
    k.box(0, y * h, D * 0.4, W * 0.8, 0.02, 0.05, '#c8a35a');
  }
  k.box(0, 0, 0, W * 0.7, 0.85, D * 0.7, '#d7d0c2');
  g = k.geometry();
  cache.set(key, g);
  return g;
}

/** Crane that stands beside construction sites. */
export function craneModel(): THREE.BufferGeometry {
  let g = cache.get('crane');
  if (g) return g;
  const k = new Kit();
  k.box(0, 0, 0, 1.4, 26, 1.4, '#e0a92a');
  k.box(6, 26, 0, 22, 1.2, 1.2, '#e0a92a');
  k.box(-4, 24.5, 0, 3, 2.5, 2.5, '#666');
  g = k.geometry();
  cache.set('crane', g);
  return g;
}

/** Three-blade rotor for wind turbines, rotated about local z. */
export function rotorModel(): THREE.BufferGeometry {
  let g = cache.get('rotor');
  if (g) return g;
  const k = new Kit();
  k.cylinder(0, -1.2, 0, 1.2, 2.4, '#e6e9ea', 8);
  const blade = new Kit();
  blade.box(0, 0, 0, 1.6, 40, 0.4, '#f4f6f7');
  const bg = blade.geometry();
  const merged: number[] = [], cols: number[] = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Matrix4().makeRotationZ((i / 3) * Math.PI * 2);
    const gg = bg.clone().applyMatrix4(m);
    merged.push(...(gg.getAttribute('position').array as Float32Array));
    cols.push(...(gg.getAttribute('color').array as Float32Array));
  }
  const hub = k.geometry().clone().applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  merged.push(...(hub.getAttribute('position').array as Float32Array));
  cols.push(...(hub.getAttribute('color').array as Float32Array));
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(merged, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  cache.set('rotor', g);
  return g;
}

/** Rock-armour breakwater arm (unit length along local x). */
export function breakwaterModel(): THREE.BufferGeometry {
  let g = cache.get('breakwater');
  if (g) return g;
  const k = new Kit();
  const r = seq(99);
  for (let i = 0; i < 24; i++) k.box(-0.5 + i / 24 + 0.02, -8, (r() - 0.5) * 4, 1 / 20, 10 + r() * 1.5, 8 + r() * 3, i % 2 ? '#8c8a84' : '#a19e96');
  k.box(0, 2, 0, 1, 0.8, 4, '#b5b2aa');
  g = k.geometry();
  cache.set('breakwater', g);
  return g;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
