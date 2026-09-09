import { isPitDrivable } from './pitlane';

/* =============================================================================
   LAYER 4 - VEHICLE
   Pure physics, extracted verbatim from IndyGP_Phase1.html. No DOM, no
   renderer, no globals. Port this module to React Native or Flutter and it
   behaves identically.
   ========================================================================== */

import { TAU, clamp, clamp01, lerp, sgn } from './config';
import type { CarConfig, SurfaceProfile } from './config';
import type { Centreline, LocateResult } from './geometry';

export interface Vehicle {
  x: number;
  z: number;
  yaw: number;
  vLong: number;
  vLat: number;
  steer: number;
  wheelSpin: number;
  latAccel: number;
  slipping: boolean;
  hitWall: number;
}

export interface VehicleInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
}

/** The flat tuning object the physics step consumes. */
export interface PhysicsConfig extends CarConfig {
  scrub: number;
  wallOffset: number;
}

export interface GearBand { g: number; lo: number; hi: number }

/* ---------- begin verbatim Layer 4 ---------- */

export function createVehicle(x: number, z: number, yaw: number): Vehicle {
  return { x, z, yaw, vLong:0, vLat:0, steer:0, wheelSpin:0,
           latAccel:0, slipping:false, hitWall:0 };
}
export function stepVehicle(v: Vehicle, input: VehicleInput, dt: number, surf: SurfaceProfile, cfg: PhysicsConfig): Vehicle {
  const speed = Math.abs(v.vLong);
  const grip  = surf.grip * (input.handbrake ? cfg.handbrakeGrip : 1);

  // steering: lock tapers off with speed so top-gear corrections stay smooth
  const lock   = lerp(cfg.maxSteer, cfg.maxSteerHigh, clamp01(speed/cfg.steerFalloff));
  const target = input.steer * lock;
  const rate   = (Math.abs(target) > Math.abs(v.steer) ? cfg.steerRate : cfg.steerReturn) * dt;
  v.steer += clamp(target - v.steer, -rate, rate);

  // yaw, budgeted against available lateral grip
  let yawRate = (v.vLong / cfg.wheelBase) * Math.tan(v.steer);
  const yawCap = (cfg.latGrip * grip) / Math.max(speed, 4);
  const wanted = yawRate;
  yawRate = clamp(yawRate, -yawCap, yawCap);
  v.yaw = (v.yaw + yawRate*dt) % TAU;

  // longitudinal: power curve, brakes, drag, rolling and surface resistance
  let a = 0;
  const nrm = clamp01(v.vLong / cfg.topSpeed);
  if (input.throttle > 0)
    a += input.throttle * cfg.power * Math.pow(1-nrm, 0.8) * (0.35 + 0.65*grip);
  if (input.brake > 0)
    a -= (v.vLong > 0.5) ? input.brake * cfg.brake * grip : input.brake * cfg.reversePower;
  a -= sgn(v.vLong) * (cfg.dragK*v.vLong*v.vLong + cfg.rollK + surf.extraDrag);
  v.vLong += a*dt;
  if (v.vLong < -cfg.reverseTop) v.vLong = -cfg.reverseTop;
  if (!input.throttle && !input.brake && Math.abs(v.vLong) < 0.25) v.vLong = 0;

  // lateral: yawing the body leaves the velocity behind, grip drags it back
  v.vLat -= yawRate * v.vLong * dt;
  const bite = cfg.latGrip * grip * dt;
  v.vLat = Math.abs(v.vLat) <= bite ? 0 : v.vLat - sgn(v.vLat)*bite;
  v.vLat = clamp(v.vLat, -cfg.maxSlip, cfg.maxSlip);

  v.latAccel = yawRate * v.vLong;
  v.slipping = Math.abs(v.vLat) > 2.2 || Math.abs(wanted) > yawCap*1.25;

  // integrate in world space
  const fx = Math.cos(v.yaw), fz = Math.sin(v.yaw);
  v.x += (fx*v.vLong - fz*v.vLat) * dt;
  v.z += (fz*v.vLong + fx*v.vLat) * dt;
  v.wheelSpin += (v.vLong / 0.36) * dt;
  return v;
}
/* Keep the car inside the concrete. Returns the impact strength, 0-1.
   CRASH HARDENING (2026-09-09, Chris QA): wall contact fed NaN into vLong
   via cfg.scrub being undefined at one call path, and a nose-in wedge could
   pin the car. Now: severity-scaled scrub, non-finite guards, and a bounce
   that lifts the nose off the wall plane. */
export function applyBarriers(v: Vehicle, loc: LocateResult, cl: Centreline, cfg: PhysicsConfig): number {
  if (isPitDrivable(v.x,v.z)) return 0;
  const limit = cfg.wallOffset;
  if (Math.abs(loc.lateral) <= limit) return 0;
  const over = Math.abs(loc.lateral) - limit;
  const side = sgn(loc.lateral);
  v.x = loc.px + (-loc.tz)*limit*side;
  v.z = loc.pz + ( loc.tx)*limit*side;
  const before = Math.hypot(v.vLong, v.vLat);
  /* Severity: gentle kisses keep most speed; big hits shed much more. */
  const severity = clamp01((before / 45) * 0.6 + Math.min(over, 3) / 3 * 0.4);
  const keep = 0.85 - 0.40 * severity;         // 85% .. 45%
  const scrub = Number.isFinite(cfg.scrub) ? cfg.scrub : 0.62;
  v.vLat  = 0;
  /* Bounce: a nose-in wedge gets pushed off the wall plane. */
  v.vLong = v.vLong * keep * scrub - (1.2 + 2.2 * severity) * 0.25;
  if (!Number.isFinite(v.vLong) || !Number.isFinite(v.x) || !Number.isFinite(v.z)) {
    v.vLong = 0; v.vLat = 0;
    v.x = loc.px; v.z = loc.pz;
  }
  return clamp01((before*0.02) + Math.min(over,3)*0.12);
}
export function gearFor(kph: number, bands: number[]): GearBand {
  for (let i = bands.length-1; i >= 1; i--) if (kph >= bands[i-1]) return { g:i, lo:bands[i-1], hi:bands[i] };
  return { g:1, lo:0, hi:bands[1] };
}
export function fmtTime(ms: number | null): string {
  if (ms == null || !isFinite(ms)) return '—:—.———';
  const t = Math.max(0, ms), m = Math.floor(t/60000),
        s = Math.floor(t/1000)%60, f = Math.floor(t%1000);
  return m + ':' + String(s).padStart(2,'0') + '.' + String(f).padStart(3,'0');
}

/* ---------- end verbatim Layer 4 ---------- */
