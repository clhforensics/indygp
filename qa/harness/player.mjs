/* =============================================================================
   PLAYER MODELS (QA-AUDIT H-1 remediation, 2026-09-10)
   Scripted "Chris" stand-ins that drive the real competition.step() feed.
   The lane-0 robot that broke the last three rounds is gone: these models
   follow the actual reference line/speed profile the AI follow, so the
   player-in-pack dynamics match the game.

   Model contract:
     init(core, CL, S_LINE, CFG) -> { progress, speed, lane, laneVel }
     tick(ctx) -> feed | null    // ctx: { raceT, dt, CL, S_LINE, core, comp, seed }
     advance(dt)                 // integrate own kinematics after comp.step
   ============================================================================= */

/** Track the reference-lap racing line like an AI: speed = profile, lane = 0 offset. */
export function profilePlayer({ paceMul = 1.0, lane = null, label = 'profile' } = {}) {
  return {
    label,
    init(core, CL, S_LINE, CFG) {
      this.core = core;
      this.CL = CL;
      this.L = CL.length;
      this.refProfile = core.REF_LAP_SPEEDS;
      this.refBrake = core.REF_LAP_BRAKE ?? null;
      const slot = core.getStartingGridSlot(core.PLAYER_STARTING_GRID_SLOT, CFG.track.gridOffset);
      this.progress = ((S_LINE + slot.longitudinal - S_LINE) % this.L + this.L) % this.L;
      this.speed = 0;
      this.lane = lane ?? slot.lateral; // start on the player's grid box unless overridden
      this.laneVel = 0;
      this.started = false;
      return { progress: this.progress, speed: this.speed, lane: this.lane, laneVel: 0 };
    },
    tick(ctx) {
      const { raceT, CL } = ctx;
      if (raceT <= 0) return null; // launch with the field at green
      this.started = true;
      const idx = Math.floor(this.progress / 10) % this.refProfile.length;
      const targetV = this.refProfile[idx] * paceMul;
      // accelerate/brake like a driver: 9 m/s² forward, profile-led braking
      const dv = targetV - this.speed;
      this.speed += Math.max(-38 * ctx.dt, Math.min(9 * ctx.dt, dv));
      // lane: drift toward the requested lane at AI-like slew
      if (lane !== null) {
        const err = lane - this.lane;
        this.laneVel += (err * 3.4 - this.laneVel * 3.4) * ctx.dt;
        this.laneVel = Math.max(-2.3, Math.min(2.3, this.laneVel));
      }
      return {
        s: this.progress,
        lane: this.lane,
        speed: this.speed,
        laneVel: this.laneVel,
      };
    },
    advance(dt) {
      if (!this.started) return;
      this.progress = (this.progress + this.speed * dt) % this.L;
    },
  };
}

/** A slow blocker: runs the profile at a fraction of pace, ON the racing line.
    The honest "slower car ahead" test — passes MUST be possible around it. */
export function blockerPlayer({ paceMul = 0.6 } = {}) {
  return profilePlayer({ paceMul, label: `blocker-${paceMul}` });
}

/** Parked car (roadblock): tests filing-around behavior, not avoidance. */
export function stationaryPlayer({ atProgress = 0.5 } = {}) {
  return {
    label: 'stationary',
    init(core, CL, S_LINE, CFG) {
      this.L = CL.length;
      this.progress = atProgress * this.L;
      this.speed = 0;
      this.lane = 0;
      this.laneVel = 0;
      return { progress: this.progress, speed: 0, lane: 0, laneVel: 0 };
    },
    tick() {
      return { s: this.progress, lane: this.lane, speed: 0, laneVel: 0 };
    },
    advance() {},
  };
}

/** Weaver: sine-lane wobble at profile speed — stressor for contact geometry. */
export function weaverPlayer({ amp = 1.5, periodS = 6 } = {}) {
  const base = profilePlayer({ paceMul: 1.0, label: 'weaver' });
  return {
    ...base,
    label: 'weaver',
    tick(ctx) {
      const feed = base.tick(ctx);
      if (!feed) return null;
      const wobble = amp * Math.sin((2 * Math.PI * ctx.raceT) / periodS);
      return { ...feed, lane: wobble, laneVel: (amp * 2 * Math.PI) / periodS * Math.cos((2 * Math.PI * ctx.raceT) / periodS) };
    },
  };
}

/** No player: pure AI field (used for pace-band gates). */
export const noPlayer = null;
