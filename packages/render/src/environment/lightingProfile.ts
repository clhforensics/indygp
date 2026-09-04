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
    exposure: 1.12,
  },

  sun: {
    ...QUALITY.sun,
    elevationDeg: 24,
    color: 0xFFE3B8,
    intensity: 3.6,
  },

  bounce: {
    ...QUALITY.bounce,
    color: 0xA8C0DC,
    intensity: 0.55,
  },

  hemi: {
    ...QUALITY.hemi,
    sky: 0x9EC2E8,
    ground: 0x55503F,
    intensity: 0.55,
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
