
/* =============================================================================
   RENDER QUALITY - INDYGP-PBR-V1 / INDYGP-PERF-V1Presentation-only tunables. These deliberately do NOT live in
   packages/core/src/config.ts: that module is the portable simulation contract
   and stays free of renderer concerns. Nothing here changes a number the car
   reacts to.

   PHASE 2F NOTES
   Shadow maps were already 2048 in Phase 1, so "reduce to 2048" would have been
   a no-op. The actual saving is 1024 combined with a tighter span: a shadow map
   costs fill rate proportional to its area, so 2048 -> 1024 is a 4x reduction
   in the depth pass, and dropping span 180 -> 130 recovers most of the lost
   texel density (0.176 m/texel before, 0.254 m/texel after).

   To restore the Phase 1 look on a stronger machine, set TIER to 'high'.
   ========================================================================== */

export type QualityTier = 'high' | 'balanced' | 'fast';

/* Change this one line to retune the whole renderer. */
export const TIER: QualityTier = 'balanced';

const SHADOW_TIERS = {
  high:     { mapSize: 2048, span: 180, soft: true,  normalBias: 0.9,  treeCasters: true  },
  balanced: { mapSize: 1024, span: 130, soft: false, normalBias: 0.6,  treeCasters: false },
  fast:     { mapSize: 1024, span: 105, soft: false, normalBias: 0.5,  treeCasters: false }
};

const PIXEL_TIERS = { high: 2.0, balanced: 1.5, fast: 1.25 };
const ANISO_TIERS = { high: 8, balanced: 2, fast: 1 };
const GRAZE_TIERS = { high: 8, balanced: 4, fast: 2 };

const st = SHADOW_TIERS[TIER];

export const QUALITY = {
  tier: TIER,
  tone: { exposure: 1.05 },

  /* Crisp warm afternoon sun, 15 degrees above the horizon. Azimuth is measured
     clockwise from +x (east); 205 degrees puts the sun west-south-west, so the
     shadows rake east-north-east diagonally across the Mile Square grid. */
  sun: {
    elevationDeg: 15,
    azimuthDeg: 205,
    distance: 480,
    color: 0xFFE1B2,
    intensity: 2.9
  },

  bounce: { color: 0x9FB6D4, intensity: 0.38, elevationDeg: 44, azimuthDeg: 30 },
  hemi:   { sky: 0xAFC8E8, ground: 0x4A4438, intensity: 0.55 },

  shadow: {
    enabled: true,
    mapSize: st.mapSize,
    span: st.span,
    near: 5,
    far: 900,
    /* Tighter frusta give better depth precision, so this can stay shallow.
       If shadow acne appears, make it more negative before touching normalBias;
       bias costs nothing at runtime, normalBias trades away contact hardness. */
    bias: -0.0005,
    normalBias: st.normalBias,
    radius: 1.5,
    softPCF: st.soft,
    treeCasters: st.treeCasters,
    followAhead: 55,
    casterBias: 80
  },

  render: {
    /* Hard ceiling on the drawing buffer. A 4K display at native ratio is 4x
       the fragment work of 1080p for no visible gain at this art direction. */
    maxPixelRatio: PIXEL_TIERS[TIER]
  },

  /* Dynamic resolution. Measures a rolling window of frame times and nudges the
     pixel ratio inside [minScale, 1] of the cap. Conservative on purpose: a
     small step and a long window, so it settles instead of pumping.
     Set enabled=false if you would rather have a fixed, predictable buffer. */
  adaptive: {
    enabled: true,
    window: 45,
    slowMs: 15.5,
    fastMs: 11.0,
    step: 0.08,
    minScale: 0.68
  },

  /* Anything whose bounding sphere is further than this from the camera is
     skipped outright. Sits beyond CFG.world.fogFar (1250) so nothing pops. */
  cull: { distance: 1420 },

  /* Pennsylvania Street sector. INDYGP-PENN-V1
     tunnelLights adds real PointLights under the Union Station deck. Three
     lights is cheap to evaluate, but Three bakes NUM_POINT_LIGHTS into every
     material shader in the scene, so raising this recompiles the lot. Set it
     to 0 and the underpass falls back to emissive fixtures plus the deck
     shadow, which still reads correctly, just flatter. */
  penn: {
    tunnelLights: TIER === 'fast' ? 0 : 3,
    tunnelLightColor: 0xFFC15E,
    tunnelLightIntensity: 2.4,
    tunnelLightDistance: 26,
    tunnelLightDecay: 1.7,
    /* Darkening decal laid over the carriageway inside the tunnel mouth. */
    tunnelFloorTint: 0x05070A,
    tunnelFloorOpacity: 0.62
  },

  env: { domeRadius: 480, resolution: 256 },

  tex: {
    /* Anisotropic filtering is per-sample work on every textured fragment.
       Grazing surfaces (road, ground, crosswalks) genuinely need it or the
       asphalt shimmers at speed; vertical facades do not. */
    anisotropy: ANISO_TIERS[TIER],
    anisotropyGrazing: GRAZE_TIERS[TIER],
    road:      { w: 256, h: 512 },
    barrier:   { w: 64,  h: 256 },
    kerb:      { w: 32,  h: 128 },
    limestone: { w: 256, h: 256 },
    facade:    { w: 256, h: 256 },
    ground:    { w: 256, h: 256 },
    bricks:    { w: 128, h: 64  },
    crosswalk: { w: 256, h: 128 },
    roof:      { w: 128, h: 128 }
  },

  city: {
    styles: 4,
    heightBuckets: 3,
    heroRadius: 340,
    heroMinHeight: 98,
    floorHeight: 3.7,
    baySpacing: 4.4,
    /* Instances are grouped into spatial tiles so frustum culling has something
       to bite on. One city-wide InstancedMesh can never be culled: its bounding
       sphere always intersects the frustum. Smaller tiles cull better but cost
       more draw calls; 560 m lands near the knee of that curve for this map. */
    tileSize: 560
  },

  envInt: {
    road: 0.55, kerb: 0.5, wall: 0.5, stone: 0.6,
    facade: 0.9, glass: 1.4, paint: 1.2, ground: 0.4
  },

  normalScale: {
    road: 0.85, barrier: 0.95, kerb: 0.7, limestone: 0.8,
    facade: 0.7, ground: 0.45, bricks: 0.8, crosswalk: 0.7
  }
};

export type RenderQuality = typeof QUALITY;
