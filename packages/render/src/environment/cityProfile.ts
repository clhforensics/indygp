/**
 * PR5 urban architecture profile.
 *
 * Commit 1 centralizes accepted PR4 city/world presentation values without
 * intentionally changing the scene. Later PR5 commits should tune building
 * massing, facade response, skyline depth, and urban density here rather than
 * scattering values through createWorld.ts.
 */
export const CITY_PROFILE = {
  tileSize: 240,

  tree: {
    trunkTopRadius: 0.55,
    trunkBottomRadius: 0.75,
    trunkHeight: 4.2,
    trunkSegments: 8,
  },

  architecture: {
    // Dry masonry/glass facade balance. These values deliberately reduce the
    // flat plastic response while keeping the existing facade textures intact.
    facadeEnvScale: 0.72,
    facadeNormalScale: 0.74,
    facadeRoughness: 0.68,
    facadeMetalness: 0.02,
    facadeEmissiveIntensity: 0.72,

    // Roofs should read as weathered membrane/gravel rather than the same
    // material family as the street.
    roofEnvScale: 0.64,
    roofNormalScale: 0.78,
    roofRoughness: 0.86,
    roofMetalness: 0.0,

    skylineDepthScale: 1.0,

    // Corridor-specific skyline anchors for the Washington Street approach to
    // start/finish. The goal is not a survey-grade reconstruction, but a much
    // closer read of the left-side massing visible toward Meridian.
    washingtonApproach: {
      enabled: true,
      capitol: {
        xBias: -214,
        zBias: -86,
        rx: 80,
        rz: 64,
        w: 104,
        d: 66,
        h: 22,
        domeRadius: 18,
        domeHeight: 28,

        // Readable classical frontage from Washington: central portico and
        // repeated columns, without trying to model the whole building.
        porticoW: 42,
        porticoD: 8,
        porticoH: 14,
        columnCount: 8,
      },
      conrad: {
        xBias: -128,
        zBias: -98,
        rx: 46,
        rz: 38,
        w: 54,
        d: 40,
        podiumH: 15,
        towerH: 102,

        // Pale hotel slab with darker vertical window bays.
        bayCount: 7,
        bayDepth: 0.45,
        bayWidth: 2.6,
      },
      salesforce: {
        // Salesforce Tower is a Monument Circle anchor, not a Washington
        // frontage building. Keep it north/east of the circle so the T2 exit
        // still opens onto the monument instead of being pinched by the tower.
        xBiasFromCircle: 34,
        zBiasFromCircle: -76,
        rx: 42,
        rz: 40,
        w: 52,
        d: 48,
        podiumH: 14,
        towerH: 158,
        crownH: 30,

        // Identity pass: stepped crown + strong vertical facade rhythm.
        mullionCount: 8,
        mullionDepth: 0.55,
        mullionWidth: 0.55,
        crownInset1: 8,
        crownInset2: 16,
      },

      supportingSkyline: [
        // These secondary masses sit deeper behind the hero landmarks. They are
        // intentionally generic: their job is to remove empty skyline holes,
        // not compete with the Capitol / Conrad / Salesforce silhouettes.
        { xBias: -255, zBias: -150, w: 54, d: 42, h: 78, style: 1 },
        { xBias: -178, zBias: -162, w: 46, d: 38, h: 92, style: 0 },
        { xBias: -102, zBias: -174, w: 52, d: 44, h: 112, style: 0 },
      ],
    },
  },
} as const;

export type CityProfile = typeof CITY_PROFILE;
