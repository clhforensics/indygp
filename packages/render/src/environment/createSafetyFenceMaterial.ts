import * as THREE from 'three';

export interface SafetyFenceMaterialProfile {
  meshColor: number;
  meshRoughness: number;
  meshMetalness: number;
  meshOpacity: number;
  alphaTest: number;
}

/**
 * Builds a small procedural diamond-mesh texture for catch fencing.
 *
 * alphaTest is used instead of fully blended transparency so the fence keeps
 * stable depth ordering against buildings, trees, and the concrete barrier.
 */
export function createSafetyFenceMaterial(
  profile: SafetyFenceMaterialProfile,
): THREE.MeshStandardMaterial {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.MeshStandardMaterial({
      color: profile.meshColor,
      roughness: profile.meshRoughness,
      metalness: profile.meshMetalness,
      side: THREE.DoubleSide,
    });
  }

  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = `rgba(255,255,255,${profile.meshOpacity})`;
  ctx.lineWidth = 3;

  // Repeating diagonal wires. Drawing beyond the tile edges makes the pattern
  // seamless once Clamp/Repeat wrapping is applied by Three.js.
  const spacing = 22;
  for (let k = -size; k <= size * 2; k += spacing) {
    ctx.beginPath();
    ctx.moveTo(k, 0);
    ctx.lineTo(k + size, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(k, size);
    ctx.lineTo(k + size, 0);
    ctx.stroke();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.needsUpdate = true;

  const material = new THREE.MeshStandardMaterial({
    map,
    color: profile.meshColor,
    roughness: profile.meshRoughness,
    metalness: profile.meshMetalness,
    side: THREE.DoubleSide,
    alphaTest: profile.alphaTest,
    transparent: false,
  });

  material.envMapIntensity = 0.30;
  return material;
}
