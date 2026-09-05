import { QUALITY } from '../quality';

/**
 * PR4 trackside environment profile.
 *
 * Commit 1 centralizes the accepted PR3 trackside/world values without
 * intentionally changing the scene. Later PR4 commits should tune trackside
 * presentation here instead of scattering constants through createWorld.ts.
 */
export const TRACKSIDE_PROFILE = {
  ground: {
    size: 6000,
    y: -0.10,
    material: {
      envIntensity: QUALITY.envInt.ground,
      normalScale: QUALITY.normalScale.ground,
      aniso: QUALITY.tex.anisotropyGrazing,
      repeatX: 120,
      repeatY: 120,
    },
  },

  water: {
    width: 230,
    depth: 1900,
    xOffsetFromWhiteRiver: -165,
    y: -0.55,
    z: -200,
    color: 0x556677,
    roughness: 0.60,
    metalness: 0.10,
    envIntensity: 1.0,
  },

  barrier: {
    textureVScale: 6,

    // Dry precast concrete: high roughness, zero metalness, and restrained
    // environment response so the barriers do not read like painted plastic.
    material: {
      envIntensity: 0.34,
      normalScale: 0.42,
      roughness: 0.88,
      metalness: 0.0,
    },

    // A narrow horizontal cap gives the wall a believable physical thickness
    // without changing the canonical collision/track corridor dimensions.
    capHalfWidth: 0.16,
    capColor: 0xb8b6af,
    capRoughness: 0.90,
    capMetalness: 0.0,
    capEnvIntensity: 0.28,
  },

  verge: {
    // Indianapolis street sections should read as paved urban edges first,
    // not as a continuous grass circuit. This apron sits outside the barrier.
    // R1 note: the previous 0x7f817f + full sun blew out to paper-white at
    // chase-camera angles; a darker warm concrete keeps it grounded.
    width: 4.2,
    y: -0.015,
    color: 0x5c5e5b,
    roughness: 0.98,
    metalness: 0.0,
    envIntensity: 0.10,

    // A narrow dark expansion/drainage seam breaks up the large sidewalk slab.
    seamWidth: 0.10,
    seamColor: 0x4a4c4b,
    seamRoughness: 0.98,
    seamMetalness: 0.0,
    seamEnvIntensity: 0.12,
  },

  safetyFence: {
    // Catch fencing sits directly above the concrete wall, outside the car.
    // It is intentionally lightweight so the streetscape remains readable.
    offsetFromBarrier: 0.04,
    height: 2.45,
    textureVScale: 2.8,

    postSpacing: 8.0,
    postRadius: 0.045,
    postColor: 0x555a5d,
    postRoughness: 0.74,
    postMetalness: 0.18,
    postEnvIntensity: 0.34,

    meshColor: 0x686d70,
    meshRoughness: 0.78,
    meshMetalness: 0.12,
    meshOpacity: 0.88,
    alphaTest: 0.34,
  },

  streetFurniture: {
    // Repeated urban furniture adds scale cues without introducing real light
    // sources or expensive per-object draw calls.
    offsetBeyondVerge: 0.85,

    lampSpacing: 34.0,
    lampHeight: 7.6,
    lampPoleRadius: 0.075,
    lampArmLength: 1.25,
    lampArmHeightOffset: 0.18,
    lampColor: 0x4f5457,
    lampRoughness: 0.72,
    lampMetalness: 0.20,
    lampEnvIntensity: 0.34,
    lampHeadColor: 0xc9c8bd,
    lampHeadRoughness: 0.55,
    lampHeadMetalness: 0.08,
    lampHeadEnvIntensity: 0.42,

    bollardSpacing: 17.0,
    bollardHeight: 0.92,
    bollardRadius: 0.075,
    bollardColor: 0x676b6c,
    bollardRoughness: 0.78,
    bollardMetalness: 0.16,
    bollardEnvIntensity: 0.28,
  },

  vegetation: {
    offsetFromCentre: 19.5,

    // Light enough to read against shadowed verge and fence at race distance;
    // a dark trunk disappears into the ground plane and the canopy floats.
    trunkColor: 0x8a6a48,
    trunkRoughness: 0.96,
    trunkMetalness: 0.0,
    trunkEnvIntensity: 0.18,

    leafColor: 0x6b9152,
    leafShadowColor: 0x47663a,
    leafHighlightColor: 0xa3c67f,
    leafRoughness: 0.92,
    leafMetalness: 0.0,
    leafEnvIntensity: 0.16,

    minScale: 0.88,
    scaleRange: 0.42,
    skipProbability: 0.30,

    // Four overlapping higher-detail lobes read as a crown of foliage instead
    // of one large low-poly gemstone.
    canopyDetail: 1,
    canopyLobes: 4,
  },
} as const;

export type TracksideProfile = typeof TRACKSIDE_PROFILE;
