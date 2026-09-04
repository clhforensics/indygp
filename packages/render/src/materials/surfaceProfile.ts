import * as THREE from 'three';
import { QUALITY } from '../quality';

/*
 * PR3 surface profile.
 *
 * Commit 1 centralizes the existing track-surface material inputs without
 * changing their values. Later PR3 commits can tune road, kerb, barrier,
 * start/finish, and paint response from one stable module.
 */
export const SURFACE_PROFILE = {
  road: {
    // Reference-derived authored asphalt maps. The material is intentionally
    // matte and nearly flat at macro scale; fine photographic aggregate does
    // the visual work instead of a large procedural normal pattern.
    envIntensity: QUALITY.envInt.road * 0.52,
    normalScale: 0.0,
    roughness: 0.93,
    metalness: 0.0,
    repeatX: 5,
    repeatY: 2,
    aniso: QUALITY.tex.anisotropyGrazing,
  },

  kerb: {
    // Painted concrete kerbs should read harder/smoother than asphalt while
    // remaining dry rather than glossy.
    envIntensity: QUALITY.envInt.kerb * 0.82,
    normalScale: QUALITY.normalScale.kerb * 0.72,
    roughness: 0.74,
    metalness: 0.0,
  },

  barrier: {
    envIntensity: QUALITY.envInt.wall,
    normalScale: QUALITY.normalScale.barrier,
    side: THREE.DoubleSide,
  },

  startFinish: {
    // Brick/paver surface: matte, slightly coarse, and distinct from both road
    // asphalt and thermoplastic paint.
    envIntensity: QUALITY.envInt.road * 0.72,
    normalScale: QUALITY.normalScale.bricks * 0.78,
    roughness: 0.86,
    metalness: 0.0,
    repeatX: 6,
    repeatY: 1,
  },

  crosswalk: {
    // Weathered thermoplastic paint: smoother than asphalt, but never wet or
    // mirror-like.
    envIntensity: QUALITY.envInt.road * 0.76,
    normalScale: QUALITY.normalScale.crosswalk * 0.58,
    roughness: 0.70,
    metalness: 0.0,
    aniso: QUALITY.tex.anisotropyGrazing,
  },
} as const;

export type SurfaceProfile = typeof SURFACE_PROFILE;
