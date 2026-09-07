/*
 * Compatibility entry point for Layer 6.
 *
 * Existing callers continue importing from './world'. The implementation now
 * lives in world/createWorld.ts so future rendering work can grow without
 * rebuilding a monolithic world.ts.
 */
export {
  createWorld,
  missingSurfaces,
} from './world/createWorld';

export { buildGrandstand, GRANDSTAND_SITES } from './world/grandstands';
export { buildPitLane } from './world/pitlane';
export type { GrandstandSpec } from './world/grandstands';

export type {
  World,
  WorldDeps,
} from './world/createWorld';
