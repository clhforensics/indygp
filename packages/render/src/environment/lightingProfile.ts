import { QUALITY } from '../quality';

/*
 * PR2 lighting profile.
 *
 * Commit 2 reduced artificial ambient fill.
 * Commit 3 calibrates the directional daylight/shadow response conservatively:
 *
 *   sun elevation:   15 -> 18 degrees
 *   sun intensity: 2.90 -> 2.75
 *   sun color:        warm amber -> slightly more neutral warm daylight
 *   shadow span:       130 -> 122
 *   normal bias:      0.60 -> 0.50
 *   shadow radius:    1.50 -> 1.25
 *
 * These changes preserve the existing azimuth, shadow-map resolution,
 * shadow-follow behavior, exposure, and environment generation.
 */
export const LIGHTING_PROFILE = {
  tone: {
    ...QUALITY.tone,
    exposure: 1.03,
  },

  sun: {
    ...QUALITY.sun,
    elevationDeg: 18,
    color: 0xFFE9C8,
    intensity: 2.75,
  },

  bounce: {
    ...QUALITY.bounce,
    intensity: 0.18,
  },

  hemi: {
    ...QUALITY.hemi,
    intensity: 0.38,
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
