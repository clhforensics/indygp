/* =============================================================================
   LAYER 1 - CONFIG
   Every tunable value, extracted verbatim from IndyGP_Phase1.html by
   scaffold.js. Only export keywords and type annotations were added; not one
   numeric literal was touched. Nothing downstream of this module invents a
   number.
   ========================================================================== */

export interface SurfaceProfile { grip: number; extraDrag: number }

export interface TrackConfig {
  halfWidth: number;
  kerbWidth: number;
  kerbRadius: number;
  wallOffset: number;
  wallHeight: number;
  sampleStep: number;
  startFinish: { x: number; z: number };
  gridOffset: number;
}

export interface CarConfig {
  wheelBase: number;
  topSpeed: number;
  power: number;
  brake: number;
  reversePower: number;
  reverseTop: number;
  dragK: number;
  rollK: number;
  latGrip: number;
  maxSlip: number;
  maxSteer: number;
  maxSteerHigh: number;
  steerFalloff: number;
  steerRate: number;
  steerReturn: number;
  handbrakeGrip: number;
  gears: number[];
}

export interface SurfaceConfig {
  onTrack: SurfaceProfile;
  offTrack: SurfaceProfile;
  wallScrub: number;
}

export interface CameraRig {
  back: number; up: number; lookAhead: number; lag: number; fov: number;
}

export interface CameraConfig {
  chase: CameraRig;
  bonnet: CameraRig;
  high: CameraRig;
  names: string[];
  shakeDecay: number;
}

export interface WorldConfig {
  fogNear: number; fogFar: number; blockInset: number;
  treeSpacing: number; maxPixelRatio: number; signalReach: number;
}

export interface SimConfig { step: number; maxFrame: number }

export interface GameConfig {
  track: TrackConfig;
  car: CarConfig;
  surface: SurfaceConfig;
  cam: CameraConfig;
  world: WorldConfig;
  sim: SimConfig;
}

/* ---------- begin verbatim Layer 1 ---------- */

export const CFG: GameConfig = {
  track: {
    halfWidth:   7.0,     // 14 m carriageway, typical of a modern street circuit
    kerbWidth:   1.4,
    kerbRadius:  70,      // fit kerbs where the corner radius is tighter than this
    wallOffset:  9.4,     // concrete face, measured from the centreline
    wallHeight:  1.15,
    sampleStep:  2.0,     // centreline resample resolution, metres
    startFinish: { x: 540, z: 0 },   // Washington & Illinois, under the Artsgarden
    gridOffset:  45       // metres behind the line the car is placed
  },
  car: {
    wheelBase:      3.5,
    topSpeed:       95,   // m/s ceiling used by the power curve (~342 km/h)
    power:          32,   // m/s^2 at zero speed
    brake:          45,   // m/s^2, roughly 4.6 g
    reversePower:   9,
    reverseTop:     11,
    dragK:          0.00085,
    rollK:          0.40,
    latGrip:        33,   // m/s^2 lateral ceiling, roughly 3.4 g
    maxSlip:        14,
    maxSteer:       0.52, // rad at standstill
    maxSteerHigh:   0.075,// rad at steerFalloff and above
    steerFalloff:   70,   // m/s at which steering lock bottoms out
    steerRate:      3.2,  // rad/s toward the target angle
    steerReturn:    6.0,  // rad/s back to centre
    handbrakeGrip:  0.42,
    gears:          [0,42,78,118,158,198,238,278,345]  // km/h band edges, 8 speeds
  },
  surface: {
    onTrack:  { grip:1.00, extraDrag:0.0 },
    offTrack: { grip:0.55, extraDrag:5.0 },
    wallScrub: 0.62      // speed retained after kissing the concrete
  },
  cam: {
    chase:   { back:9.5, up:3.5, lookAhead:22, lag:6.5,  fov:68 },
    bonnet:  { back:0.15,up:1.28,lookAhead:34, lag:26,   fov:78 },
    high:    { back:19,  up:9.5, lookAhead:30, lag:4.0,  fov:60 },
    names:   ['Chase','Bonnet','Trackside high'],
    shakeDecay: 5.5
  },
  world: {
    fogNear: 180, fogFar: 1250,
    blockInset: 13,        // pavement width between the kerb line and a building
    treeSpacing: 34,
    maxPixelRatio: 1.6,
    signalReach: 11
  },
  sim: { step: 1/120, maxFrame: 0.10 }
};

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number): number => v < a ? a : (v > b ? b : v);
export const clamp01 = (v: number): number => clamp(v,0,1);
export const lerp = (a: number, b: number, t: number): number => a + (b-a)*t;
export const sgn = (v: number): number => v < 0 ? -1 : (v > 0 ? 1 : 0);
export function hash01(n: number): number { const s = Math.sin(n*127.1+n*311.7)*43758.5453; return s - Math.floor(s); }

/* ---------- end verbatim Layer 1 ---------- */
