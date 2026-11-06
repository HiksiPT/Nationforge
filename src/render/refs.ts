// Shared mutable render state (outside React, read every frame).

import * as THREE from 'three';

export const rig = {
  target: new THREE.Vector3(0, 0, 0),
  dist: 3000,
  yaw: 0.6, // radians around Y
  pitch: 0.9, // radians above the horizon
  minDist: 40,
  maxDist: 30000,
};

export const fp = {
  pos: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  vy: 0,
  keys: new Set<string>(),
  locked: false,
};

export const env = {
  timeOfDay: 10.5, // hours
  sunDir: new THREE.Vector3(0.3, 0.8, 0.2),
  daylight: 1,
};

export const renderRefs: {
  camera: THREE.PerspectiveCamera | null;
  gl: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  canvas: HTMLCanvasElement | null;
  fps: number;
  vegetationCount: number;
} = { camera: null, gl: null, scene: null, canvas: null, fps: 0, vegetationCount: 0 };

/** Cursor position on the ground (world x/z) or null. Updated by the tool layer. */
export const cursor = { x: 0, z: 0, valid: false, screenX: 0, screenY: 0 };
