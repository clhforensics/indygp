import { QUALITY } from '../quality';

/*
 * R1 lighting profile — realism pass.
 *
 * Calibrated for a convincing downtown Indianapolis afternoon:
 *   - warmer, stronger low sun with deeper directional contrast
 *   - slightly cooler sky fill so shadowed canyon walls read blue, not grey
 *   - stronger ground bounce (pale limestone/concrete albedo downtown)
 *   - exposure trimmed so ACES handles the added contrast cleanly
 */
export const LIGHTING_PROFILE = {
  tone: {
    ...QUALITY.tone,
    // R2: 1.12 -> 1.18 — the matte-road + dark-verge pass pulled mid-tones
    // down; this restores the sunny-afternoon luminance without re-blowing
    // the verge (which is fixed at the material level now).
    exposure: 1.18,
  },

  sun: {
    ...QUALITY.sun,
    elevationDeg: 34,        // higher sun: shorter, crisper shadows
    color: 0xFFE7C4,         // warmer afternoon key
    intensity: 3.9,
  },

  bounce: {
    ...QUALITY.bounce,
    color: 0x9FB6D4,         // cooler sky fill in shadowed canyons
    intensity: 0.62,
  },

  hemi: {
    ...QUALITY.hemi,
    sky: 0x9EC2E8,
    ground: 0x55503F,
    intensity: 0.50,         // slightly less ambient: deeper directional contrast
  },

  shadow: {
    ...QUALITY.shadow,
    span: 122,
    normalBias: 0.50,
    radius: 1.25,
  },

  env: QUALITY.env,
} as const;

export type LightingProfile = typeof LIGHTING_PROFILE;
