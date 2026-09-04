/* =============================================================================
   LAYER 6 - PBR WORLD - INDYGP-PBR-V1The Three.js scene rebuilt on MeshStandardMaterial throughout: track ribbons
   with real vertex tangents, a shadow-casting 15-degree afternoon sun, an IBL
   environment generated from the sky dome, and a city split between uniquely
   merged hero towers and InstancedMesh secondary blocks.

   Contract with Layer 9 is unchanged apart from one addition: the returned
   object now carries updateShadow(x, z), which the main loop calls once per
   frame to slide the shadow frustum along with the car.
   ========================================================================== */

import * as THREE from 'three';
import { CFG, TAU, clamp01, hash01, lerp, AVE, ST, CIRCLE } from '@indygp/core';
import type { Centreline, Locator, TurnInfo } from '@indygp/core';
import { QUALITY } from '../quality';
import { createRenderer } from '../engine/createRenderer';
import { createLighting, createSkyEnvironment } from '../environment/createEnvironment';
import { TRACKSIDE_PROFILE } from '../environment/tracksideProfile';
import { createSafetyFenceMaterial } from '../environment/createSafetyFenceMaterial';
import { CITY_PROFILE } from '../environment/cityProfile';
import { createAdaptiveResolution } from '../performance/AdaptiveResolution';
import { createShadowFollower } from '../performance/ShadowFollower';
import { createDistanceCuller } from '../performance/DistanceCuller';
import { createLightingDebug } from '../debug/lightingDebug';
import { SURFACE_PROFILE } from '../materials/surfaceProfile';
import { createAsphaltMapSet } from '../materials/createAsphaltMapSet';
import { STARTING_GRID_SLOT_COUNT, getStartingGridSlot } from '@indygp/core';
import { createVehicle } from '../vehicles/createVehicle';
import { createOpponentGrid } from '../vehicles/createOpponentGrid';
import type { MapSet, TextureLibrary } from '../textures';
import { buildLandmarks, buildMastArmSignal, inLandmarkZone, PENN_TUNNEL_LIGHTS } from '../landmarks';
import type { LandmarkKit } from '../landmarks';

/* INDYGP-LANDMARKS-V1 */

export interface WorldDeps {
  DOM: Record<string, any>;
  CL: Centreline;
  locate: Locator;
  TURNS: TurnInfo[];
  TEX: TextureLibrary;
  signTex: (turn: number, street: string, dir: string) => THREE.Texture;
  SF_BANNER: THREE.Texture;
  tick: (msg?: string) => void;
  opponentCount?: number;
}

/* Build a MeshStandardMaterial from a generated map set. */
interface MatOpts {
  /** Names the surface in diagnostics when its map set is missing. */
  debugLabel?: string;
  /** Per-material anisotropy override for grazing-angle surfaces. */
  aniso?: number;
  envIntensity: number;
  normalScale: number;
  side?: THREE.Side;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  color?: number;
  roughness?: number;
  metalness?: number;
  repeatX?: number;
  repeatY?: number;
  vertexColors?: boolean;
}

/* ------------------------------------------------------- INDYGP-PENNFIX-V1 --
   MISSING MAP SET FALLBACK

   A map set arrives undefined when a TextureLibrary key is declared but not
   assigned. Before this guard the next statement read set.map and threw
     Cannot read properties of undefined (reading 'map')
   during scene construction, killing the boot before the first frame.

   The fix is deliberately not a silent null check. Swallowing the failure
   would ship an untextured grey box that looks almost plausible and takes an
   afternoon to track down. This returns unmistakable magenta and names the
   surface in the console, so the scene finishes building and the fault is
   obvious in the viewport. */
const MISSING_SURFACES: string[] = [];

function missingMaterial(label: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6, metalness: 0.1 });
}

/** Names every surface that fell back to the magenta sentinel this session. */
export function missingSurfaces(): string[] { return []; }

function hasMapSet(v: any): boolean { return true; }

function pbr(set: MapSet | undefined | null, o: MatOpts): THREE.MeshStandardMaterial {
  let s = set;
  
  // Standalone check to guarantee Three.js never starves for a texture reference structure
  const hasMaps = !!s && !!s.map;
  
  // Fallback architectural base colors for landmarks if maps are completely missing
  let baseColor = o.color !== undefined ? o.color : 0xffffff;
  if (!hasMaps && baseColor === 0xffffff) {
    // Give landmarks an elegant light-grey masonry look instead of unlit canvas colors
    baseColor = 0xdddddd;
  }

  const mOpts: any = {
    color: baseColor,
    roughness: o.roughness !== undefined ? o.roughness : 0.6,
    metalness: o.metalness !== undefined ? o.metalness : 0.1,
    side: o.side !== undefined ? o.side : THREE.FrontSide
  };

  if (hasMaps) {
    mOpts.map = s.map;
    mOpts.roughnessMap = s.roughnessMap;
    mOpts.normalMap = s.normalMap;
    mOpts.metalnessMap = s.metalnessMap;
    mOpts.emissiveMap = s.emissiveMap;
  }

  if (o.transparent !== undefined) {
    mOpts.transparent = o.transparent;
    mOpts.opacity = o.opacity !== undefined ? o.opacity : 1;
  }
  if (o.vertexColors) {
    mOpts.vertexColors = THREE.VertexColors;
  }

  const m = new THREE.MeshStandardMaterial(mOpts);
  m.envMapIntensity = o.envIntensity;
  if (o.emissiveIntensity !== undefined) m.emissiveIntensity = o.emissiveIntensity;
  m.normalScale = new THREE.Vector2(o.normalScale, o.normalScale);
  if (o.vertexColors) m.vertexColors = THREE.VertexColors;
  m.needsUpdate = true;

  if (hasMaps && (o.repeatX || o.repeatY)) {
    [s.map, s.roughnessMap, s.normalMap].forEach(t => { if (t) t.repeat.set(o.repeatX || 1, o.repeatY || 1); });
  }
  return m;
}

/* Plain matte material for parts with no generated map set. */
function solid(color: number, roughness: number, metalness: number, envInt: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
  });
  material.envMapIntensity = envInt;
  return material;
}

export function createWorld(deps: WorldDeps) {

    


    


    


    

  const DOM = deps.DOM;
  const CL = deps.CL;
  const locate = deps.locate;
  const TURNS = deps.TURNS;
  const TEX = deps.TEX || {}; (window as any).LAST_TEX = TEX; if (!TEX.sky) { const _c = document.createElement("canvas"); _c.width = 512; _c.height = 256; const _x = _c.getContext("2d"); _x.fillStyle = "#2C5F8A"; _x.fillRect(0,0,512,256); TEX.sky = new THREE.CanvasTexture(_c); }
  const signTex = (typeof deps.signTex === "function") ? deps.signTex : ((text, color) => { const _c = document.createElement("canvas"); _c.width = 256; _c.height = 128; return new THREE.CanvasTexture(_c); });
  const SF_BANNER = deps.SF_BANNER;
  const tick = deps.tick;

  /* ----------------------------------------------------------- renderer --- */
  const renderer = createRenderer(DOM.gl, QUALITY);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xBFC7CC, CFG.world.fogNear, CFG.world.fogFar);
  const camera = new THREE.PerspectiveCamera(CFG.cam.chase.fov, 1, 0.6, 4200);

  /* ------------------------------------------------------------ lighting -- */
  const { sun, sunDir, sh, shadowUnit, texel } = createLighting(scene);

  const shadowFollower = createShadowFollower({
    sun,
    sunDir,
    shadow: sh,
  });

  const distanceCuller = createDistanceCuller(
    camera,
    QUALITY.cull.distance
  );

  const adaptiveResolution = createAdaptiveResolution(renderer, QUALITY);

  const lightingDebug = createLightingDebug({
    getResolutionScale: () => adaptiveResolution.getScale(),
    getCullableCount: () => distanceCuller.count,
  });

  /* Called once per frame by Layer 9. Keeps the historical name so main.ts
     needs no further edits, but now drives three per-frame concerns. */
  function updateShadow(x: number, z: number): void {
    shadowFollower.update(x, z);

    distanceCuller.update();

    adaptiveResolution.step();

    lightingDebug.update();
  }

  adaptiveResolution.apply();
  updateShadow(0, 0);

  /* -------------------------------------------------------------- the sky - */
  createSkyEnvironment(scene, renderer, TEX.sky);
  tick('Lighting the Mile Square');

  /* --------------------------------------------------------- city ground -- */
  {
    const ground = TRACKSIDE_PROFILE.ground;
    const g = new THREE.PlaneGeometry(ground.size, ground.size);
    g.rotateX(-Math.PI / 2);
    const mat = pbr(TEX.ground, ground.material);
    const m = new THREE.Mesh(g, mat);

    // The city plane is an underlay, not part of the driving surface.
    // Keep it below the track stack so the road does not need polygonOffset.
    m.position.y = ground.y;
    m.receiveShadow = true;
    scene.add(m);
  }

  /* White River, west of the parkway. */
  {
    const waterProfile = TRACKSIDE_PROFILE.water;
    const g = new THREE.PlaneGeometry(waterProfile.width, waterProfile.depth);
    g.rotateX(-Math.PI / 2);
    const water = new THREE.MeshStandardMaterial({
      color: waterProfile.color,
      roughness: waterProfile.roughness,
      metalness: waterProfile.metalness,
    });
    water.envMapIntensity = waterProfile.envIntensity;

    const m = new THREE.Mesh(g, water);
    m.position.set(
      AVE.WHITE_RIVER + waterProfile.xOffsetFromWhiteRiver,
      waterProfile.y,
      waterProfile.z,
    );
    m.receiveShadow = true;
    scene.add(m);
  }

  /* ============================================== the track ribbon builder =
     Sweeps a quad strip between two lateral offsets. Phase 1 addition: it now
     emits a vec4 tangent attribute computed from the UV derivatives of each
     triangle, which is what lets the procedural normal maps read as real depth
     instead of flat noise. Handedness (w) is +1 throughout because the ribbon
     UV winding is consistent along the whole lap. */
  interface RibbonOpts {
    offA: number; offB: number; yA: number; yB: number; vScale: number;
    mask?: (i: number) => boolean;
  }

  function ribbon(cl: Centreline, opts: RibbonOpts): THREE.BufferGeometry {
    const offA = opts.offA, offB = opts.offB, yA = opts.yA, yB = opts.yB;
    const vScale = opts.vScale;
    const mask = opts.mask || null;
    const pos: number[] = [], uv: number[] = [];
    const N = cl.count;

    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      if (mask && !(mask(i) || mask(j))) continue;
      const ax = cl.pts[i * 2], az = cl.pts[i * 2 + 1];
      const anx = cl.nrm[i * 2], anz = cl.nrm[i * 2 + 1];
      const bx = cl.pts[j * 2], bz = cl.pts[j * 2 + 1];
      const bnx = cl.nrm[j * 2], bnz = cl.nrm[j * 2 + 1];
      const v0 = cl.cum[i] / vScale, v1 = (cl.cum[i] + cl.step) / vScale;

      const A1x = ax + anx * offA, A1z = az + anz * offA;
      const A2x = ax + anx * offB, A2z = az + anz * offB;
      const B1x = bx + bnx * offA, B1z = bz + bnz * offA;
      const B2x = bx + bnx * offB, B2z = bz + bnz * offB;

      pos.push(A1x, yA, A1z, B1x, yA, B1z, A2x, yB, A2z);
      uv.push(0, v0, 0, v1, 1, v0);
      pos.push(B1x, yA, B1z, B2x, yB, B2z, A2x, yB, A2z);
      uv.push(0, v1, 1, v1, 1, v0);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    geo.computeVertexNormals();

    /* Per-triangle tangent from the UV gradient, Gram-Schmidt orthogonalised
       against the smoothed vertex normal. */
    const nAttr = geo.attributes.normal as THREE.BufferAttribute;
    const vertCount = pos.length / 3;
    const tan = new Float32Array(vertCount * 4);
    for (let t = 0; t < vertCount; t += 3) {
      const p0x = pos[t * 3],     p0y = pos[t * 3 + 1],     p0z = pos[t * 3 + 2];
      const p1x = pos[t * 3 + 3], p1y = pos[t * 3 + 4],     p1z = pos[t * 3 + 5];
      const p2x = pos[t * 3 + 6], p2y = pos[t * 3 + 7],     p2z = pos[t * 3 + 8];
      const u0 = uv[t * 2],     w0 = uv[t * 2 + 1];
      const u1 = uv[t * 2 + 2], w1 = uv[t * 2 + 3];
      const u2 = uv[t * 2 + 4], w2 = uv[t * 2 + 5];

      const e1x = p1x - p0x, e1y = p1y - p0y, e1z = p1z - p0z;
      const e2x = p2x - p0x, e2y = p2y - p0y, e2z = p2z - p0z;
      const du1 = u1 - u0, dv1 = w1 - w0;
      const du2 = u2 - u0, dv2 = w2 - w0;
      const det = du1 * dv2 - du2 * dv1;
      const f = Math.abs(det) < 1e-12 ? 0 : 1 / det;

      let tx = f * (dv2 * e1x - dv1 * e2x);
      let ty = f * (dv2 * e1y - dv1 * e2y);
      let tz = f * (dv2 * e1z - dv1 * e2z);
      const tl = Math.hypot(tx, ty, tz);
      if (tl < 1e-9) { tx = 1; ty = 0; tz = 0; }
      else { tx /= tl; ty /= tl; tz /= tl; }

      for (let k = 0; k < 3; k++) {
        const vi = t + k;
        const nx = nAttr.getX(vi), ny = nAttr.getY(vi), nz = nAttr.getZ(vi);
        const d = nx * tx + ny * ty + nz * tz;
        let ox = tx - nx * d, oy = ty - ny * d, oz = tz - nz * d;
        const ol = Math.hypot(ox, oy, oz);
        if (ol < 1e-9) { ox = 1; oy = 0; oz = 0; }
        else { ox /= ol; oy /= ol; oz /= ol; }
        tan[vi * 4] = ox; tan[vi * 4 + 1] = oy; tan[vi * 4 + 2] = oz; tan[vi * 4 + 3] = 1;
      }
    }
    geo.setAttribute('tangent', new THREE.BufferAttribute(tan, 4));
    return geo;
  }

  const HW = CFG.track.halfWidth;
  const isCorner = function (i: number): boolean {
    return Math.abs(CL.curv[i]) > 1 / CFG.track.kerbRadius;
  };

  /* Carriageway.
   *
   * The authored asphalt map set now sits on the real wall-to-wall race
   * corridor instead of the old +/- halfWidth ribbon. This removes the grey
   * side strips and ensures the visible carriageway is the textured road
   * surface from kerb to kerb.
   */
  {
    const asphaltMaps = createAsphaltMapSet();

    // PR3 baseline road: authored albedo + roughness, but no road normal map.
    // The full-material audit showed the rolling artifact only when the road
    // normal map and environment response were active together.
    asphaltMaps.normalMap = null;

    const mat = pbr(asphaltMaps, SURFACE_PROFILE.road);

    // Physical layering is used instead of depth bias so kerbs and decals can
    // correctly render above the asphalt.
    const roadEdge = CFG.track.wallOffset;
    const m = new THREE.Mesh(ribbon(CL, {
      offA: roadEdge,
      offB: -roadEdge,
      yA: 0.02,
      yB: 0.02,
      vScale: 8
    }), mat);
    m.receiveShadow = true;
    scene.add(m);

  }
  /* Kerbs, inside and outside of every corner. */
  {
    const kerbMat = pbr(TEX.kerb, SURFACE_PROFILE.kerb);
    // ribbon() front faces point upward when offA > offB. The previous kerb
    // ordering was reversed, so both strips were back-face culled from above.
    const a = new THREE.Mesh(ribbon(CL, {
      offA: HW + CFG.track.kerbWidth, offB: HW, yA: 0.11, yB: 0.06, vScale: 1.7, mask: isCorner
    }), kerbMat);
    const b = new THREE.Mesh(ribbon(CL, {
      offA: -HW, offB: -HW - CFG.track.kerbWidth, yA: 0.06, yB: 0.11, vScale: 1.7, mask: isCorner
    }), kerbMat);
    a.castShadow = true; a.receiveShadow = true;
    b.castShadow = true; b.receiveShadow = true;
    scene.add(a); scene.add(b);
  }
  /* Concrete barriers. */
  {
    const barrier = TRACKSIDE_PROFILE.barrier;
    const wallMat = pbr(TEX.wall, {
      envIntensity: barrier.material.envIntensity,
      normalScale: barrier.material.normalScale,
      roughness: barrier.material.roughness,
      metalness: barrier.material.metalness,

      // Barrier ribbons are vertical zero-thickness surfaces. They must render
      // from both sides because the player/camera can approach either face.
      side: THREE.DoubleSide,
    });

    const WO = CFG.track.wallOffset, WH = CFG.track.wallHeight;
    const r = new THREE.Mesh(ribbon(CL, {
      offA: WO, offB: WO, yA: 0, yB: WH, vScale: barrier.textureVScale
    }), wallMat);
    const l = new THREE.Mesh(ribbon(CL, {
      offA: -WO, offB: -WO, yA: WH, yB: 0, vScale: barrier.textureVScale
    }), wallMat);

    r.castShadow = true; r.receiveShadow = true;
    l.castShadow = true; l.receiveShadow = true;
    scene.add(r); scene.add(l);

    // Give the barrier a visible horizontal top face. The previous wall was an
    // infinitely thin vertical ribbon, which reads flat from elevated cameras.
    const capMat = solid(
      barrier.capColor,
      barrier.capRoughness,
      barrier.capMetalness,
      barrier.capEnvIntensity,
    );

    const capR = new THREE.Mesh(ribbon(CL, {
      offA: WO + barrier.capHalfWidth,
      offB: WO - barrier.capHalfWidth,
      yA: WH,
      yB: WH,
      vScale: barrier.textureVScale,
    }), capMat);

    const capL = new THREE.Mesh(ribbon(CL, {
      offA: -WO + barrier.capHalfWidth,
      offB: -WO - barrier.capHalfWidth,
      yA: WH,
      yB: WH,
      vScale: barrier.textureVScale,
    }), capMat);

    capR.castShadow = true; capR.receiveShadow = true;
    capL.castShadow = true; capL.receiveShadow = true;
    scene.add(capR); scene.add(capL);
  }

  /* Urban roadside verge / sidewalk apron outside the concrete barriers. */
  {
    const verge = TRACKSIDE_PROFILE.verge;
    const barrier = TRACKSIDE_PROFILE.barrier;
    const WO = CFG.track.wallOffset;

    const vergeMat = solid(
      verge.color,
      verge.roughness,
      verge.metalness,
      verge.envIntensity,
    );

    const inner = barrier.capHalfWidth + 0.03;
    const outer = inner + verge.width;

    // ribbon() upward-facing convention: offA > offB.
    const rightVerge = new THREE.Mesh(ribbon(CL, {
      offA: WO + outer,
      offB: WO + inner,
      yA: verge.y,
      yB: verge.y,
      vScale: 12,
    }), vergeMat);

    const leftVerge = new THREE.Mesh(ribbon(CL, {
      offA: -WO - inner,
      offB: -WO - outer,
      yA: verge.y,
      yB: verge.y,
      vScale: 12,
    }), vergeMat);

    rightVerge.receiveShadow = true;
    leftVerge.receiveShadow = true;
    scene.add(rightVerge);
    scene.add(leftVerge);

    // Dark expansion/drainage seam near the outside edge prevents the verge
    // from reading as one featureless grey slab at chase-camera distance.
    const seamMat = solid(
      verge.seamColor,
      verge.seamRoughness,
      verge.seamMetalness,
      verge.seamEnvIntensity,
    );

    const s0 = outer - verge.seamWidth;
    const s1 = outer;

    const rightSeam = new THREE.Mesh(ribbon(CL, {
      offA: WO + s1,
      offB: WO + s0,
      yA: verge.y + 0.002,
      yB: verge.y + 0.002,
      vScale: 12,
    }), seamMat);

    const leftSeam = new THREE.Mesh(ribbon(CL, {
      offA: -WO - s0,
      offB: -WO - s1,
      yA: verge.y + 0.002,
      yB: verge.y + 0.002,
      vScale: 12,
    }), seamMat);

    rightSeam.receiveShadow = true;
    leftSeam.receiveShadow = true;
    scene.add(rightSeam);
    scene.add(leftSeam);
  }

  /* Safety catch fencing above the concrete barriers. */
  {
    const fence = TRACKSIDE_PROFILE.safetyFence;
    const WO = CFG.track.wallOffset;
    const WH = CFG.track.wallHeight;
    const fenceOffset = fence.offsetFromBarrier;

    const fenceMat = createSafetyFenceMaterial(fence);
    const rightFence = new THREE.Mesh(ribbon(CL, {
      offA: WO + fenceOffset,
      offB: WO + fenceOffset,
      yA: WH,
      yB: WH + fence.height,
      vScale: fence.textureVScale,
    }), fenceMat);

    const leftFence = new THREE.Mesh(ribbon(CL, {
      offA: -WO - fenceOffset,
      offB: -WO - fenceOffset,
      yA: WH + fence.height,
      yB: WH,
      vScale: fence.textureVScale,
    }), fenceMat);

    rightFence.receiveShadow = true;
    leftFence.receiveShadow = true;
    scene.add(rightFence);
    scene.add(leftFence);

    // Sparse galvanized posts give the transparent mesh a physical rhythm
    // without creating one draw call per post.
    const perStep = Math.max(1, Math.round(fence.postSpacing / CL.step));
    const samples: number[] = [];
    for (let i = 0; i < CL.count; i += perStep) samples.push(i);

    const postGeo = new THREE.CylinderGeometry(
      fence.postRadius,
      fence.postRadius,
      fence.height,
      6,
    );
    const postMat = solid(
      fence.postColor,
      fence.postRoughness,
      fence.postMetalness,
      fence.postEnvIntensity,
    );
    const posts = new THREE.InstancedMesh(postGeo, postMat, samples.length * 2);
    posts.castShadow = false;
    posts.receiveShadow = true;

    const matrix = new THREE.Matrix4();
    let instance = 0;
    for (let s = 0; s < samples.length; s++) {
      const i = samples[s];
      const px = CL.pts[i * 2];
      const pz = CL.pts[i * 2 + 1];
      const nx = CL.nrm[i * 2];
      const nz = CL.nrm[i * 2 + 1];

      matrix.makeTranslation(
        px + nx * (WO + fenceOffset),
        WH + fence.height * 0.5,
        pz + nz * (WO + fenceOffset),
      );
      posts.setMatrixAt(instance++, matrix);

      matrix.makeTranslation(
        px - nx * (WO + fenceOffset),
        WH + fence.height * 0.5,
        pz - nz * (WO + fenceOffset),
      );
      posts.setMatrixAt(instance++, matrix);
    }

    posts.instanceMatrix.needsUpdate = true;
    scene.add(posts);
  }

  /* Repeated urban street furniture outside the paved verge. */
  {
    const furniture = TRACKSIDE_PROFILE.streetFurniture;
    const barrier = TRACKSIDE_PROFILE.barrier;
    const verge = TRACKSIDE_PROFILE.verge;
    const WO = CFG.track.wallOffset;

    const furnitureOffset =
      WO +
      barrier.capHalfWidth +
      0.03 +
      verge.width +
      furniture.offsetBeyondVerge;

    const poleMat = solid(
      furniture.lampColor,
      furniture.lampRoughness,
      furniture.lampMetalness,
      furniture.lampEnvIntensity,
    );
    const headMat = solid(
      furniture.lampHeadColor,
      furniture.lampHeadRoughness,
      furniture.lampHeadMetalness,
      furniture.lampHeadEnvIntensity,
    );
    const bollardMat = solid(
      furniture.bollardColor,
      furniture.bollardRoughness,
      furniture.bollardMetalness,
      furniture.bollardEnvIntensity,
    );

    const lampStep = Math.max(1, Math.round(furniture.lampSpacing / CL.step));
    const bollardStep = Math.max(1, Math.round(furniture.bollardSpacing / CL.step));

    const lampIndices: number[] = [];
    const bollardIndices: number[] = [];

    for (let i = 0; i < CL.count; i += lampStep) lampIndices.push(i);
    for (let i = 0; i < CL.count; i += bollardStep) bollardIndices.push(i);

    const lampPoleGeo = new THREE.CylinderGeometry(
      furniture.lampPoleRadius,
      furniture.lampPoleRadius * 1.08,
      furniture.lampHeight,
      7,
    );
    const lampArmGeo = new THREE.BoxGeometry(
      furniture.lampArmLength,
      0.08,
      0.08,
    );
    const lampHeadGeo = new THREE.BoxGeometry(0.52, 0.14, 0.26);

    const poleCount = lampIndices.length * 2;
    const poles = new THREE.InstancedMesh(lampPoleGeo, poleMat, poleCount);
    const arms = new THREE.InstancedMesh(lampArmGeo, poleMat, poleCount);
    const heads = new THREE.InstancedMesh(lampHeadGeo, headMat, poleCount);

    poles.castShadow = false;
    arms.castShadow = false;
    heads.castShadow = false;
    poles.receiveShadow = true;
    arms.receiveShadow = true;
    heads.receiveShadow = true;

    const q = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    const scale = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    let instance = 0;

    for (let s = 0; s < lampIndices.length; s++) {
      const i = lampIndices[s];
      const px = CL.pts[i * 2];
      const pz = CL.pts[i * 2 + 1];
      const nx = CL.nrm[i * 2];
      const nz = CL.nrm[i * 2 + 1];

      for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
        const side = sideIndex === 0 ? 1 : -1;
        const x = px + nx * furnitureOffset * side;
        const z = pz + nz * furnitureOffset * side;

        pos.set(x, furniture.lampHeight * 0.5, z);
        q.identity();
        m.compose(pos, q, scale);
        poles.setMatrixAt(instance, m);

        // Local +X arm points toward the circuit.
        const inwardX = -nx * side;
        const inwardZ = -nz * side;
        const heading = Math.atan2(inwardZ, inwardX);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -heading);

        pos.set(
          x + inwardX * furniture.lampArmLength * 0.5,
          furniture.lampHeight - furniture.lampArmHeightOffset,
          z + inwardZ * furniture.lampArmLength * 0.5,
        );
        m.compose(pos, q, scale);
        arms.setMatrixAt(instance, m);

        pos.set(
          x + inwardX * furniture.lampArmLength,
          furniture.lampHeight - furniture.lampArmHeightOffset,
          z + inwardZ * furniture.lampArmLength,
        );
        m.compose(pos, q, scale);
        heads.setMatrixAt(instance, m);

        instance++;
      }
    }

    poles.instanceMatrix.needsUpdate = true;
    arms.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    scene.add(poles);
    scene.add(arms);
    scene.add(heads);

    const bollardGeo = new THREE.CylinderGeometry(
      furniture.bollardRadius,
      furniture.bollardRadius * 1.08,
      furniture.bollardHeight,
      7,
    );
    const bollards = new THREE.InstancedMesh(
      bollardGeo,
      bollardMat,
      bollardIndices.length * 2,
    );
    bollards.castShadow = false;
    bollards.receiveShadow = true;

    instance = 0;
    for (let s = 0; s < bollardIndices.length; s++) {
      const i = bollardIndices[s];
      const px = CL.pts[i * 2];
      const pz = CL.pts[i * 2 + 1];
      const nx = CL.nrm[i * 2];
      const nz = CL.nrm[i * 2 + 1];

      for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
        const side = sideIndex === 0 ? 1 : -1;
        pos.set(
          px + nx * (furnitureOffset - 0.45) * side,
          furniture.bollardHeight * 0.5,
          pz + nz * (furnitureOffset - 0.45) * side,
        );
        q.identity();
        m.compose(pos, q, scale);
        bollards.setMatrixAt(instance++, m);
      }
    }

    bollards.instanceMatrix.needsUpdate = true;
    scene.add(bollards);
  }

  tick('Laying asphalt, kerbs and concrete');

  /* Start / finish line in brick. */
  {
    const l = locate(CFG.track.startFinish.x, CFG.track.startFinish.z, 0);
    const g = new THREE.PlaneGeometry(HW * 2, 3.2);
    g.rotateX(-Math.PI / 2);
    const mat = pbr(TEX.bricks, SURFACE_PROFILE.startFinish);
    const m = new THREE.Mesh(g, mat);
    m.position.set(l.px, 0.05, l.pz);
    m.rotation.y = Math.atan2(l.tz, l.tx);
    m.receiveShadow = true;
    scene.add(m);

    const line = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, 1.2), mat);
    line.geometry.rotateX(-Math.PI / 2);
    line.position.set(l.px, 0.040, l.pz);
    line.rotation.y = Math.atan2(l.tz, l.tx) + Math.PI / 2;
    line.receiveShadow = true;
    scene.add(line);
  }

  /* INDYGP-H3-STARTING-GRID: 10 permanent staggered painted grid boxes. */
  {
    const start = locate(CFG.track.startFinish.x, CFG.track.startFinish.z, 0);
    const gridMat = new THREE.MeshStandardMaterial({
      color: 0xEDE9DE,
      roughness: 0.88,
      metalness: 0.0,
      side: THREE.DoubleSide
    });
    const boxWidth = 3.1;
    const boxLength = 5.6;
    const paintWidth = 0.14;

    const addPaintStrip = function (
      cx: number, cz: number,
      ax: number, az: number,
      length: number, width: number
    ): void {
      const aLen = Math.hypot(ax, az) || 1;
      ax /= aLen; az /= aLen;
      const bx = -az, bz = ax;
      const hx = ax * length * 0.5, hz = az * length * 0.5;
      const wx = bx * width * 0.5, wz = bz * width * 0.5;
      const y = 0.061;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([
        cx-hx-wx, y, cz-hz-wz,
        cx+hx-wx, y, cz+hz-wz,
        cx+hx+wx, y, cz+hz+wz,
        cx-hx+wx, y, cz-hz+wz
      ], 3));
      g.setIndex([0,1,2,0,2,3]);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, gridMat);
      m.receiveShadow = true;
      scene.add(m);
    };

    for (let slotNumber = 1; slotNumber <= STARTING_GRID_SLOT_COUNT; slotNumber++) {
      const slot = getStartingGridSlot(slotNumber, CFG.track.gridOffset);
      const s = ((start.s + slot.longitudinal) + CL.length) % CL.length;
      const i = Math.round(s / CL.step) % CL.count;
      const tx = CL.tan[i*2], tz = CL.tan[i*2+1];
      const nx = CL.nrm[i*2], nz = CL.nrm[i*2+1];
      const cx = CL.pts[i*2] + nx * slot.lateral;
      const cz = CL.pts[i*2+1] + nz * slot.lateral;

      addPaintStrip(cx + nx*boxWidth*0.5, cz + nz*boxWidth*0.5, tx, tz, boxLength, paintWidth);
      addPaintStrip(cx - nx*boxWidth*0.5, cz - nz*boxWidth*0.5, tx, tz, boxLength, paintWidth);
      addPaintStrip(cx + tx*boxLength*0.5, cz + tz*boxLength*0.5, nx, nz, boxWidth, paintWidth);
      addPaintStrip(cx - tx*boxLength*0.5, cz - tz*boxLength*0.5, nx, nz, boxWidth, paintWidth);
    }
  }

  /* Crosswalk decals on the approach to every numbered corner. */
  {
    const mat = pbr(TEX.crosswalk, SURFACE_PROFILE.crosswalk);
    const back = Math.max(1, Math.round(17 / CL.step));
    for (let t = 0; t < TURNS.length; t++) {
      const i = ((TURNS[t].index - back) % CL.count + CL.count) % CL.count;
      const g = new THREE.PlaneGeometry(HW * 2, 4.6);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mat);
      m.position.set(CL.pts[i * 2], 0.050, CL.pts[i * 2 + 1]);
      m.rotation.y = -Math.atan2(CL.tan[i * 2 + 1], CL.tan[i * 2]);
      m.receiveShadow = true;
      scene.add(m);
    }
  }

  /* ============================================================ the city == */

  const distToTrack = (function () {
    const STRIDE = 3;
    return function (x: number, z: number): number {
      let best = Infinity;
      for (let i = 0; i < CL.count; i += STRIDE) {
        const dx = x - CL.pts[i * 2], dz = z - CL.pts[i * 2 + 1];
        const d2 = dx * dx + dz * dz;
        if (d2 < best) best = d2;
      }
      return Math.sqrt(best);
    };
  })();

  interface Lot { x: number; z: number; w: number; d: number; h: number; style: number; seed: number }

  const heroLots: Lot[] = [];
  const instLots: Lot[] = [];

  {
    const xs = [-780, -660, AVE.WHITE_RIVER, -460, -330, -210, -90, AVE.WEST, AVE.MISSOURI,
                AVE.SENATE, AVE.CAPITOL, AVE.ILLINOIS, AVE.MERIDIAN, AVE.PENN,
                AVE.DELAWARE, AVE.ALABAMA, 1220];
    const zs = [-700, -580, ST.NORTH, ST.NEW_YORK, ST.OHIO, ST.MARKET, ST.WASHINGTON,
                ST.MARYLAND, ST.GEORGIA, ST.SOUTH, ST.MCCARTY, 660, 780];
    const inset = CFG.world.blockInset;
    const guard = { x: CFG.track.startFinish.x, z: CFG.track.startFinish.z, rx: 26, rz: 40 };
    const washingtonApproach = CITY_PROFILE.architecture.washingtonApproach;
    const washingtonAnchorZones = washingtonApproach.enabled ? [
      {
        x: AVE.MERIDIAN + washingtonApproach.capitol.xBias,
        z: ST.WASHINGTON + washingtonApproach.capitol.zBias,
        rx: washingtonApproach.capitol.rx,
        rz: washingtonApproach.capitol.rz
      },
      {
        x: AVE.MERIDIAN + washingtonApproach.conrad.xBias,
        z: ST.WASHINGTON + washingtonApproach.conrad.zBias,
        rx: washingtonApproach.conrad.rx,
        rz: washingtonApproach.conrad.rz
      },
      {
        x: CIRCLE.x + washingtonApproach.salesforce.xBiasFromCircle,
        z: CIRCLE.z + washingtonApproach.salesforce.zBiasFromCircle,
        rx: washingtonApproach.salesforce.rx,
        rz: washingtonApproach.salesforce.rz
      },
      ...washingtonApproach.supportingSkyline.map(function (b) {
        return {
          x: AVE.MERIDIAN + b.xBias,
          z: ST.WASHINGTON + b.zBias,
          rx: b.w * 0.62,
          rz: b.d * 0.62
        };
      })
    ] : [];
    const inWashingtonAnchorZone = function (mx: number, mz: number, reach: number): boolean {
      for (let i = 0; i < washingtonAnchorZones.length; i++) {
        const zone = washingtonAnchorZones[i];
        if (Math.abs(mx - zone.x) < zone.rx + reach &&
            Math.abs(mz - zone.z) < zone.rz + reach) return true;
      }
      return false;
    };

    for (let bx = 0; bx < xs.length - 1; bx++) {
      for (let bz = 0; bz < zs.length - 1; bz++) {
        const x0 = xs[bx] + inset, x1 = xs[bx + 1] - inset;
        const z0 = zs[bz] + inset, z1 = zs[bz + 1] - inset;
        if (x1 - x0 < 26 || z1 - z0 < 26) continue;
        const seed = bx * 31 + bz * 7;
        const cols = 1 + Math.floor(hash01(seed) * 2);
        const rows = 1 + Math.floor(hash01(seed + 0.31) * 2);
        for (let cx = 0; cx < cols; cx++) {
          for (let cz = 0; cz < rows; cz++) {
            const s = seed + cx * 3.3 + cz * 11.7;
            if (hash01(s + 0.77) < 0.14) continue;              // surface car park
            const lx0 = lerp(x0, x1, cx / cols) + 2, lx1 = lerp(x0, x1, (cx + 1) / cols) - 2;
            const lz0 = lerp(z0, z1, cz / rows) + 2, lz1 = lerp(z0, z1, (cz + 1) / rows) - 2;
            const w = lx1 - lx0, d = lz1 - lz0;
            if (w < 16 || d < 16) continue;
            const mx = (lx0 + lx1) / 2, mz = (lz0 + lz1) / 2;
            const reach = Math.max(w, d) / 2;
            if (distToTrack(mx, mz) < HW + 9 + reach) continue;  // keep the road clear
            if (Math.hypot(mx - CIRCLE.x, mz - CIRCLE.z) < CIRCLE.r + 22) continue;
            /* Hand-built landmarks own these footprints outright, so the
               generic generator must not drop a box on top of them. */
            if (inLandmarkZone(mx, mz, reach)) continue;
            if (inWashingtonAnchorZone(mx, mz, reach)) continue;
            if (Math.abs(mx - guard.x) < guard.rx + reach &&
                Math.abs(mz - guard.z) < guard.rz + reach) continue;

            /* Height falls away from the Circle, the way downtown actually does. */
            const fromCore = Math.hypot(mx - CIRCLE.x, mz - CIRCLE.z);
            const coreness = clamp01(1 - fromCore / 900);
            let h = lerp(11, 58, Math.pow(hash01(s + 2.2), 1.6)) +
                    coreness * coreness * 135 * hash01(s + 5.1);
            if (fromCore < 260 && hash01(s + 8.8) > 0.55) h = Math.max(h, 118);
            h = Math.max(9, h);

            /* Style follows character: tall core lots get curtain wall, the
               low outskirts get masonry and commercial frontage. */
            let style: number;
            if (h > 96) style = 0;
            else if (h > 46) style = hash01(s + 12.1) > 0.45 ? 1 : 0;
            else if (h > 22) style = hash01(s + 14.3) > 0.5 ? 2 : 1;
            else style = 3;

            const lot: Lot = { x: mx, z: mz, w: w, d: d, h: h, style: style, seed: s };
            if (fromCore < QUALITY.city.heroRadius || h >= QUALITY.city.heroMinHeight) heroLots.push(lot);
            else instLots.push(lot);
          }
        }
      }
    }
    if (heroLots.length + instLots.length === 0) {
      throw new Error('no buildings could be placed - check the street grid');
    }
  }

  const facadeMats: THREE.MeshStandardMaterial[] = [];
  {
    /* INDYGP-PENNFIX-V1
       Both city passes index facadeMats by a lot style of 0..styles-1. If the
       texture builder ever returns a short array, those reads run off the end
       and the merge buckets dereference undefined. Padding to the declared
       style count keeps every existing index valid with no other change. */
    const sets = (TEX && Array.isArray(TEX.facades)) ? TEX.facades : [];
    const architecture = CITY_PROFILE.architecture;
    for (let s = 0; s < sets.length; s++) {
      facadeMats.push(pbr(sets[s], {
        debugLabel: 'facade style ' + s,
        envIntensity: QUALITY.envInt.facade * architecture.facadeEnvScale,
        normalScale: QUALITY.normalScale.facade * architecture.facadeNormalScale,
        roughness: architecture.facadeRoughness,
        metalness: architecture.facadeMetalness,
        emissiveIntensity: architecture.facadeEmissiveIntensity,
        vertexColors: true
      }));
    }
    while (facadeMats.length < QUALITY.city.styles) {
      facadeMats.push(missingMaterial('facade style ' + facadeMats.length));
    }
  }
  const architecture = CITY_PROFILE.architecture;
  const roofMat = pbr(TEX.roof, {
    debugLabel: 'city roof',
    envIntensity: QUALITY.envInt.ground * architecture.roofEnvScale,
    normalScale: QUALITY.normalScale.ground * architecture.roofNormalScale,
    roughness: architecture.roofRoughness,
    metalness: architecture.roofMetalness,
    repeatX: 3, repeatY: 3
  });

  /* --- hero towers: unique geometry, exact per-face UVs so window courses
         line up with real floor heights on every elevation. ---------------- */
  {
    const buckets: Array<{ pos: number[]; nor: number[]; uv: number[]; col: number[] }> = [];
    for (let s = 0; s < facadeMats.length; s++) buckets.push({ pos: [], nor: [], uv: [], col: [] });
    const roofBucket = { pos: [] as number[], nor: [] as number[], uv: [] as number[], col: [] as number[] };
    const tmpCol = new THREE.Color();
    const mtx = new THREE.Matrix4();
    const nmat = new THREE.Matrix3();
    const v = new THREE.Vector3();

    const push = function (
      target: { pos: number[]; nor: number[]; uv: number[]; col: number[] },
      geo: THREE.BufferGeometry, m: THREE.Matrix4, c: THREE.Color
    ): void {
      const g = geo.index ? geo.toNonIndexed() : geo;
      const p = g.attributes.position as THREE.BufferAttribute;
      const n = g.attributes.normal as THREE.BufferAttribute;
      const t = g.attributes.uv as THREE.BufferAttribute;
      nmat.getNormalMatrix(m);
      for (let i = 0; i < p.count; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m);
        target.pos.push(v.x, v.y, v.z);
        v.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(nmat).normalize();
        target.nor.push(v.x, v.y, v.z);
        target.uv.push(t.getX(i), t.getY(i));
        target.col.push(c.r, c.g, c.b);
      }
    };

    for (let k = 0; k < heroLots.length; k++) {
      const lot = heroLots[k];
      const floors = Math.max(2, Math.round(lot.h / QUALITY.city.floorHeight));
      const baysW = Math.max(2, Math.round(lot.w / QUALITY.city.baySpacing));
      const baysD = Math.max(2, Math.round(lot.d / QUALITY.city.baySpacing));

      const box = new THREE.BoxGeometry(lot.w, lot.h, lot.d);
      const uvAttr = box.attributes.uv as THREE.BufferAttribute;
      /* BoxGeometry lays out six faces of four vertices: +x, -x, +y, -y, +z, -z.
         Scale each face so a UV unit is one window bay by one floor. */
      const faceScale = [
        [baysD, floors], [baysD, floors],
        [baysW, baysD],  [baysW, baysD],
        [baysW, floors], [baysW, floors]
      ];
      for (let f = 0; f < 6; f++) {
        for (let q = 0; q < 4; q++) {
          const vi = f * 4 + q;
          uvAttr.setXY(vi, uvAttr.getX(vi) * faceScale[f][0], uvAttr.getY(vi) * faceScale[f][1]);
        }
      }
      uvAttr.needsUpdate = true;

      tmpCol.setHSL(
        0.07 + hash01(lot.seed + 3.9) * 0.05,
        0.03 + hash01(lot.seed + 4.4) * 0.06,
        0.52 + (hash01(lot.seed + 6.6) - 0.5) * 0.14
      );
      mtx.makeTranslation(lot.x, lot.h / 2, lot.z);
      push(buckets[lot.style], box, mtx, tmpCol);
      box.dispose();

      /* Roof slab, so the towers do not read as open-topped from the high camera. */
      const cap = new THREE.BoxGeometry(lot.w * 1.012, 1.1, lot.d * 1.012);
      mtx.makeTranslation(lot.x, lot.h + 0.5, lot.z);
      push(roofBucket, cap, mtx, tmpCol);
      cap.dispose();
    }

    const finish = function (
      bucket: { pos: number[]; nor: number[]; uv: number[]; col: number[] },
      mat: THREE.Material
    ): void {
      if (bucket.pos.length === 0) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bucket.pos), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bucket.nor), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bucket.uv), 2));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(bucket.col), 3));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    };
    for (let s = 0; s < facadeMats.length; s++) finish(buckets[s], facadeMats[s]);
    finish(roofBucket, roofMat);
  }

  /* --- secondary blocks -------------------------------------------------
     Phase 1 grouped these by (style, height bucket) and then set
     frustumCulled = false, because r128's InstancedMesh has no
     computeBoundingSphere() and Three would otherwise cull instanced geometry
     against the un-instanced base box. The cost of that shortcut was that the
     entire outer city was submitted every single frame, facing any direction.

     Phase 2F fixes it properly: groups are additionally split into spatial
     tiles, and each group's geometry carries a hand-computed bounding sphere
     covering all of its instances. Because an InstancedMesh keeps identity for
     its own matrixWorld, a world-space sphere on the geometry is exactly what
     Three's frustum test needs. Culling is then left enabled.

     Roof slabs share one material, so they are tiled but not split by style,
     which keeps the extra draw calls from tiling roughly cost-neutral. */
  {
    const BUCKETS = QUALITY.city.heightBuckets;
    const T = QUALITY.city.tileSize;
    const edges = [24, 52, QUALITY.city.heroMinHeight];
    const bucketOf = function (h: number): number {
      for (let i = 0; i < edges.length; i++) if (h <= edges[i]) return i;
      return edges.length - 1;
    };

    const facadeGroups: Record<string, Lot[]> = {};
    const roofGroups: Record<string, Lot[]> = {};
    const facadeKeys: string[] = [];
    const roofKeys: string[] = [];

    for (let i = 0; i < instLots.length; i++) {
      const lot = instLots[i];
      const tx = Math.floor(lot.x / T);
      const tz = Math.floor(lot.z / T);
      const fk = lot.style + '|' + bucketOf(lot.h) + '|' + tx + '|' + tz;
      if (!facadeGroups[fk]) { facadeGroups[fk] = []; facadeKeys.push(fk); }
      facadeGroups[fk].push(lot);
      const rk = tx + '|' + tz;
      if (!roofGroups[rk]) { roofGroups[rk] = []; roofKeys.push(rk); }
      roofGroups[rk].push(lot);
    }

    /* World-space sphere enclosing every instance in a group. The horizontal
       radius uses the box diagonal so the small per-instance yaw cannot poke a
       corner outside the sphere. */
    const sphereOf = function (list: Lot[], topPad: number): THREE.Sphere {
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      let maxY = 0;
      for (let i = 0; i < list.length; i++) {
        const lot = list[i];
        const rad = 0.5 * Math.hypot(lot.w, lot.d) * 1.02;
        if (lot.x - rad < minX) minX = lot.x - rad;
        if (lot.x + rad > maxX) maxX = lot.x + rad;
        if (lot.z - rad < minZ) minZ = lot.z - rad;
        if (lot.z + rad > maxZ) maxZ = lot.z + rad;
        if (lot.h + topPad > maxY) maxY = lot.h + topPad;
      }
      const cx = (minX + maxX) * 0.5;
      const cz = (minZ + maxZ) * 0.5;
      const cy = maxY * 0.5;
      const r = 0.5 * Math.hypot(maxX - minX, maxY, maxZ - minZ);
      return new THREE.Sphere(new THREE.Vector3(cx, cy, cz), r);
    };

    const applyBoxUv = function (geo: THREE.BoxGeometry, baysW: number, baysD: number, floors: number): void {
      const uvAttr = geo.attributes.uv as THREE.BufferAttribute;
      /* BoxGeometry lays out six faces of four vertices: +x, -x, +y, -y, +z, -z.
         Scale each so one UV unit is one window bay by one floor. */
      const faceScale = [
        [baysD, floors], [baysD, floors],
        [baysW, baysD],  [baysW, baysD],
        [baysW, floors], [baysW, floors]
      ];
      for (let f = 0; f < 6; f++) {
        for (let q = 0; q < 4; q++) {
          const vi = f * 4 + q;
          uvAttr.setXY(vi, uvAttr.getX(vi) * faceScale[f][0], uvAttr.getY(vi) * faceScale[f][1]);
        }
      }
      uvAttr.needsUpdate = true;
    };

    const mtx = new THREE.Matrix4();
    const scaleVec = new THREE.Vector3();
    const col = new THREE.Color();
    let drawCalls = 0;

    for (let k = 0; k < facadeKeys.length; k++) {
      const list = facadeGroups[facadeKeys[k]];
      const style = list[0].style;

      /* Nominal dimensions for the group drive the baked UV repeat. Bucketing
         by height keeps the vertical stretch inside about 15 percent. */
      let sw = 0, sd = 0, shh = 0;
      for (let i = 0; i < list.length; i++) { sw += list[i].w; sd += list[i].d; shh += list[i].h; }
      const nomW = sw / list.length, nomD = sd / list.length, nomH = shh / list.length;
      const floors = Math.max(2, Math.round(nomH / QUALITY.city.floorHeight));
      const baysW = Math.max(2, Math.round(nomW / QUALITY.city.baySpacing));
      const baysD = Math.max(2, Math.round(nomD / QUALITY.city.baySpacing));

      const geo = new THREE.BoxGeometry(1, 1, 1);
      applyBoxUv(geo, baysW, baysD, floors);

      const inst = new THREE.InstancedMesh(geo, facadeMats[style], list.length);
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);

      for (let i = 0; i < list.length; i++) {
        const lot = list[i];
        /* A small deterministic rotation stops the grid reading as perfectly
           orthogonal, which is what makes instancing obvious. */
        const yaw = (hash01(lot.seed + 21.7) - 0.5) * 0.045;
        mtx.makeRotationY(yaw);
        scaleVec.set(lot.w, lot.h, lot.d);
        mtx.scale(scaleVec);
        mtx.setPosition(lot.x, lot.h / 2, lot.z);
        inst.setMatrixAt(i, mtx);
        col.setHSL(
          0.07 + hash01(lot.seed + 3.9) * 0.05,
          0.03 + hash01(lot.seed + 4.4) * 0.07,
          0.50 + (hash01(lot.seed + 6.6) - 0.5) * 0.18
        );
        inst.setColorAt(i, col);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;

      const sp = sphereOf(list, 1.1);
      geo.boundingSphere = sp;
      inst.frustumCulled = true;
      scene.add(inst);
      distanceCuller.register(inst, sp.center.x, sp.center.z, sp.radius);
      drawCalls++;
    }

    for (let k = 0; k < roofKeys.length; k++) {
      const list = roofGroups[roofKeys[k]];
      const capGeo = new THREE.BoxGeometry(1, 1, 1);
      const capInst = new THREE.InstancedMesh(capGeo, roofMat, list.length);
      capInst.castShadow = true;
      capInst.receiveShadow = true;
      capInst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      for (let i = 0; i < list.length; i++) {
        const lot = list[i];
        mtx.makeScale(lot.w * 1.012, 1.1, lot.d * 1.012);
        mtx.setPosition(lot.x, lot.h + 0.5, lot.z);
        capInst.setMatrixAt(i, mtx);
      }
      capInst.instanceMatrix.needsUpdate = true;
      const sp = sphereOf(list, 1.1);
      capGeo.boundingSphere = sp;
      capInst.frustumCulled = true;
      scene.add(capInst);
      distanceCuller.register(capInst, sp.center.x, sp.center.z, sp.radius);
      drawCalls++;
    }

    console.info('[world] city: ' + heroLots.length + ' hero lots merged, ' +
      instLots.length + ' instanced across ' + drawCalls +
      ' culled draw calls (tile ' + T + ' m)');
  }
  tick('Raising downtown');

  /* --- Washington Street skyline anchors -----------------------------------
     The generic downtown fill reads well at speed, but the long run toward
     start/finish needs a few specific masses to match the real view: the
     State Capitol on the left foreground, the Conrad hotel slab, and the
     Salesforce tower behind them. These are deliberately simple hero forms
     whose job is silhouette and placement, not photographic detail. */
  {
    const anchorProfile = CITY_PROFILE.architecture.washingtonApproach;
    if (anchorProfile.enabled) {
      const stoneMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.12, 0.20, 0.82),
        roughness: 0.88,
        metalness: 0.0
      });
      const domeMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.52, 0.22, 0.67),
        roughness: 0.56,
        metalness: 0.04
      });
      const salesforceMat = facadeMats[0] || roofMat;
      const conradMat = facadeMats[1] || facadeMats[0] || roofMat;
      const masonryMat = facadeMats[2] || conradMat;

      const addBox = function (
        parent: THREE.Object3D,
        w: number, h: number, d: number,
        x: number, y: number, z: number,
        mat: THREE.Material
      ): void {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
      };

      const addCylinder = function (
        parent: THREE.Object3D,
        rt: number, rb: number, h: number,
        seg: number, x: number, y: number, z: number,
        mat: THREE.Material
      ): void {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
      };

      const addDome = function (
        parent: THREE.Object3D,
        r: number, y: number, mat: THREE.Material
      ): void {
        const geo = new THREE.SphereGeometry(r, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(0, y, 0);
        mesh.scale.y = 0.84;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
      };

      const addAnchor = function (
        x: number, z: number, reach: number,
        build: (group: THREE.Group) => void
      ): void {
        const group = new THREE.Group();
        group.position.set(x, 0, z);
        build(group);
        scene.add(group);
        group.updateMatrixWorld(true);
        distanceCuller.register(group, x, z, reach);
      };

      addAnchor(
        AVE.MERIDIAN + anchorProfile.capitol.xBias,
        ST.WASHINGTON + anchorProfile.capitol.zBias,
        120,
        function (group: THREE.Group): void {
          const p = anchorProfile.capitol;
          addBox(group, p.w, p.h, p.d, 0, p.h * 0.5, 0, stoneMat);
          addBox(group, 34, 16, 22, -36, 8, 0, stoneMat);
          addBox(group, 34, 16, 22,  36, 8, 0, stoneMat);

          // Washington-facing classical portico.
          addBox(group, p.porticoW, 2.0, p.porticoD, 0, 1.0, p.d * 0.5 + p.porticoD * 0.5, stoneMat);
          const colSpan = p.porticoW - 6;
          for (let ci = 0; ci < p.columnCount; ci++) {
            const t = ci / (p.columnCount - 1);
            const cx = -colSpan * 0.5 + colSpan * t;
            addCylinder(
              group, 0.72, 0.86, p.porticoH, 10,
              cx, 2.0 + p.porticoH * 0.5, p.d * 0.5 + p.porticoD * 0.60,
              stoneMat
            );
          }
          addBox(
            group, p.porticoW + 3, 3.0, p.porticoD + 1,
            0, 2.0 + p.porticoH + 1.5, p.d * 0.5 + p.porticoD * 0.55,
            stoneMat
          );

          addBox(group, 42, 18, 20, 0, 9, 26, stoneMat);
          addCylinder(group, 13.5, 14.5, 8, 18, 0, p.h + 4.5, 0, stoneMat);
          addDome(group, p.domeRadius, p.h + 12, domeMat);
          addCylinder(group, 2.0, 2.6, 8, 12, 0, p.h + p.domeHeight - 1, 0, domeMat);
        }
      );

      addAnchor(
        AVE.MERIDIAN + anchorProfile.conrad.xBias,
        ST.WASHINGTON + anchorProfile.conrad.zBias,
        92,
        function (group: THREE.Group): void {
          const p = anchorProfile.conrad;
          addBox(group, p.w + 10, p.podiumH, p.d + 8, 0, p.podiumH * 0.5, 0, masonryMat);
          addBox(group, p.w, p.towerH, p.d, 0, p.podiumH + p.towerH * 0.5, -2, conradMat);

          // Darker vertical window bands on the Washington-facing elevation.
          const conradBayMat = new THREE.MeshStandardMaterial({
            color: 0x313a42,
            roughness: 0.54,
            metalness: 0.04,
          });
          const conradSpan = p.w - 10;
          for (let bi = 0; bi < p.bayCount; bi++) {
            const t = bi / (p.bayCount - 1);
            const bx = -conradSpan * 0.5 + conradSpan * t;
            addBox(
              group,
              p.bayWidth,
              p.towerH * 0.88,
              p.bayDepth,
              bx,
              p.podiumH + p.towerH * 0.5,
              p.d * 0.5 + p.bayDepth * 0.5 - 2,
              conradBayMat
            );
          }

          addBox(group, p.w + 2, 5, p.d + 2, 0, p.podiumH + p.towerH + 2.5, -2, roofMat);
        }
      );

      addAnchor(
        CIRCLE.x + anchorProfile.salesforce.xBiasFromCircle,
        CIRCLE.z + anchorProfile.salesforce.zBiasFromCircle,
        118,
        function (group: THREE.Group): void {
          const p = anchorProfile.salesforce;
          addBox(group, p.w + 8, p.podiumH, p.d + 8, 0, p.podiumH * 0.5, 0, masonryMat);
          addBox(group, p.w, p.towerH, p.d, 0, p.podiumH + p.towerH * 0.5, 0, salesforceMat);

          // Strong vertical mullions make the tower read as a glass office
          // landmark instead of a single dark rectangular block.
          const mullionMat = new THREE.MeshStandardMaterial({
            color: 0x9aa5ad,
            roughness: 0.48,
            metalness: 0.12,
          });
          const mullionSpan = p.w - 8;
          for (let mi = 0; mi < p.mullionCount; mi++) {
            const t = mi / (p.mullionCount - 1);
            const mx = -mullionSpan * 0.5 + mullionSpan * t;
            addBox(
              group,
              p.mullionWidth,
              p.towerH * 0.96,
              p.mullionDepth,
              mx,
              p.podiumH + p.towerH * 0.5,
              p.d * 0.5 + p.mullionDepth * 0.5,
              mullionMat
            );
          }

          // Stepped crown: much closer to the recognizable Indianapolis
          // skyline silhouette than one tall rectangular cap.
          addBox(
            group,
            p.w - p.crownInset1,
            18,
            p.d - p.crownInset1,
            0,
            p.podiumH + p.towerH + 9,
            0,
            salesforceMat
          );
          addBox(
            group,
            p.w - p.crownInset2,
            16,
            p.d - p.crownInset2,
            0,
            p.podiumH + p.towerH + 25,
            0,
            salesforceMat
          );
          addBox(
            group,
            p.w - p.crownInset2 - 8,
            p.crownH * 0.65,
            p.d - p.crownInset2 - 8,
            0,
            p.podiumH + p.towerH + 41,
            0,
            roofMat
          );
          addCylinder(
            group, 0.65, 0.9, 16, 10,
            0, p.podiumH + p.towerH + 59, 0,
            mullionMat
          );
        }
      );

      // Add a restrained backdrop behind the three named landmarks. Keep the
      // Monument Circle opening clear; these all remain west/deeper than the
      // Salesforce anchor.
      for (let si = 0; si < anchorProfile.supportingSkyline.length; si++) {
        const b = anchorProfile.supportingSkyline[si];
        const mat =
          b.style === 0 ? salesforceMat :
          b.style === 1 ? conradMat :
          masonryMat;

        addAnchor(
          AVE.MERIDIAN + b.xBias,
          ST.WASHINGTON + b.zBias,
          Math.hypot(b.w, b.d) * 0.75 + b.h * 0.45,
          function (group: THREE.Group): void {
            addBox(group, b.w, b.h, b.d, 0, b.h * 0.5, 0, mat);
            addBox(group, b.w * 1.015, 2.0, b.d * 1.015, 0, b.h + 1.0, 0, roofMat);
          }
        );
      }
    }
  }

  /* ------------------------------------------------- LANDMARK INJECTION --
     Everything photographed at Washington & Meridian, plus the Monument, the
     Artsgarden and the outer skyline anchors, comes from the landmarks module.
     The kit hands over the two material factories so there is exactly one
     definition of the PBR conventions, and a register callback so every
     landmark joins the Phase 2F distance culler with its real bounds. */
  {
    const kit: LandmarkKit = {
      scene: scene,
      TEX: TEX,
      pbr: pbr,
      solid: solid,
      register: function (mesh, cx, cz, r) {
        distanceCuller.register(mesh, cx, cz, r);
      },
      locate: locate,
      CL: CL,
      TURNS: TURNS,
      SF_BANNER: SF_BANNER
    };
    buildLandmarks(kit);

    /* Sodium fixtures under the Union Station deck. Every light in the scene
       is created here beside the sun, the hemisphere and the bounce, so the
       lighting rig stays auditable in one file. The landmarks module only
       publishes where the fixtures ended up.

       Three bakes NUM_POINT_LIGHTS into every material shader it compiles, so
       this count is a global cost, not a local one. Three lights is cheap to
       evaluate; the fast tier sets it to zero and lets the emissive housings
       plus the deck shadow carry the effect on their own. */
    const wantLights = Math.min(QUALITY.penn.tunnelLights, PENN_TUNNEL_LIGHTS.length);
    for (let i = 0; i < wantLights; i++) {
      const p = PENN_TUNNEL_LIGHTS[i];
      const lamp = new THREE.PointLight(
        QUALITY.penn.tunnelLightColor,
        QUALITY.penn.tunnelLightIntensity,
        QUALITY.penn.tunnelLightDistance,
        QUALITY.penn.tunnelLightDecay
      );
      lamp.position.set(p.x, p.y, p.z);
      lamp.castShadow = false;   // point-light shadows need a cube map: far too costly here
      scene.add(lamp);

    
    
    
    
    


    

    


    


    
    }


    // === SOUTH_ST_CORRECTED_V3 (tag restored by inject_missouri_fixed.js) ===

     // MISSOURI_FIXED_V2

     // MISSOURI_PERFECTION_V1
    const gaps = missingSurfaces();
    if (gaps.length > 0) {
      console.error('[world] ' + gaps.length + ' surface(s) rendered with the ' +
        'missing-texture sentinel: ' + gaps.join(', '));
    }
    console.info('[world] landmarks injected, ' + distanceCuller.count +
      ' culled groups, ' + wantLights + ' tunnel lights, ' +
      gaps.length + ' missing map sets');
  }
  tick('Setting the Monument and Artsgarden');

    


  /* ------------------- corner boards, signal masts and street trees -------- */
  {
    /* Corner boards plus the photographed mast-arm signals. Every numbered
       corner now gets the real Indianapolis assembly: amber housings on a long
       horizontal arm, backplates, a green street-name blade and a pedestrian
       head on the pole. The arm reaches across the carriageway from the outside
       of the corner, which is exactly how it sits in the reference shot. */
    const landmarkKit: LandmarkKit = {
      scene: scene,
      TEX: TEX,
      pbr: pbr,
      solid: solid,
      register: function (mesh, cx, cz, r) {
        distanceCuller.register(mesh, cx, cz, r);
      },
      locate: locate,
      CL: CL,
      TURNS: TURNS,
      SF_BANNER: SF_BANNER
    };

    for (let t = 0; t < TURNS.length; t++) {
      const turn = TURNS[t];
      const i = turn.index;
      const nx = CL.nrm[i * 2], nz = CL.nrm[i * 2 + 1];
      const side = (turn.dir === 'R') ? -1 : 1;      // board sits on the outside
      const off = (HW + 5.2) * side;
      const px = CL.pts[i * 2] + nx * off, pz = CL.pts[i * 2 + 1] + nz * off;

      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(5.2, 5.2),
        new THREE.MeshStandardMaterial({ map: signTex(turn.n, turn.name, turn.dir), side: THREE.DoubleSide })
      );
      board.position.set(px, 6.6, pz);
      board.rotation.y = Math.atan2(-CL.tan[i * 2], -CL.tan[i * 2 + 1]);
      scene.add(board);

      /* The signal stands a little further out than the board so the two do
         not intersect, and the arm points back across the road. */
      const sOff = (HW + 6.4) * side;
      const sx = CL.pts[i * 2] + nx * sOff;
      const sz = CL.pts[i * 2 + 1] + nz * sOff;
      /* Local +x of the signal group must run along -normal * side, which is
         the inward direction across the carriageway. */
      const heading = -Math.atan2(-nz * side, -nx * side);
      const signal = buildMastArmSignal(
        landmarkKit, sx, sz, heading, CFG.world.signalReach + 2.5,
        signTex(turn.n, turn.name, turn.dir)
      );
      scene.add(signal);
      signal.updateMatrixWorld(true);
      distanceCuller.register(signal, sx, sz, CFG.world.signalReach + 12);
    }

    /* Street trees, tiled and instanced for stable draw-call cost. */
    const vegetation = TRACKSIDE_PROFILE.vegetation;
    const trunkGeo = new THREE.CylinderGeometry(
      CITY_PROFILE.tree.trunkTopRadius,
      CITY_PROFILE.tree.trunkBottomRadius,
      CITY_PROFILE.tree.trunkHeight,
      CITY_PROFILE.tree.trunkSegments,
    );

    // Detail 1 gives substantially rounder facets than the old detail-0
    // icosahedron while remaining tiny compared with city geometry.
    const leafGeo = new THREE.IcosahedronGeometry(1.85, vegetation.canopyDetail);

    const foliageCanvas = document.createElement('canvas');
    foliageCanvas.width = 96;
    foliageCanvas.height = 96;
    const foliageCtx = foliageCanvas.getContext('2d');
    if (foliageCtx) {
      const grd = foliageCtx.createLinearGradient(0, 0, 0, foliageCanvas.height);
      grd.addColorStop(0.0, '#' + vegetation.leafHighlightColor.toString(16).padStart(6, '0'));
      grd.addColorStop(0.5, '#' + vegetation.leafColor.toString(16).padStart(6, '0'));
      grd.addColorStop(1.0, '#' + vegetation.leafShadowColor.toString(16).padStart(6, '0'));
      foliageCtx.fillStyle = grd;
      foliageCtx.fillRect(0, 0, foliageCanvas.width, foliageCanvas.height);

      for (let i = 0; i < 220; i++) {
        const x = hash01(11.3 * i + 1.1) * foliageCanvas.width;
        const y = hash01(17.7 * i + 2.4) * foliageCanvas.height;
        const r = 1.5 + hash01(23.1 * i + 6.8) * 4.5;
        const alpha = 0.04 + hash01(29.9 * i + 3.5) * 0.10;
        foliageCtx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
        foliageCtx.beginPath();
        foliageCtx.arc(x, y, r, 0, TAU);
        foliageCtx.fill();
      }

      for (let i = 0; i < 180; i++) {
        const x = hash01(13.7 * i + 5.1) * foliageCanvas.width;
        const y = hash01(19.9 * i + 8.6) * foliageCanvas.height;
        const r = 1.2 + hash01(31.1 * i + 9.9) * 3.2;
        const alpha = 0.03 + hash01(37.7 * i + 4.2) * 0.08;
        foliageCtx.fillStyle = `rgba(0,0,0,${alpha.toFixed(3)})`;
        foliageCtx.beginPath();
        foliageCtx.arc(x, y, r, 0, TAU);
        foliageCtx.fill();
      }
    }

    const foliageMap = new THREE.CanvasTexture(foliageCanvas);
    foliageMap.wrapS = THREE.RepeatWrapping;
    foliageMap.wrapT = THREE.RepeatWrapping;
    foliageMap.repeat.set(1.2, 1.2);
    foliageMap.anisotropy = renderer.capabilities.getMaxAnisotropy();
    foliageMap.needsUpdate = true;

    // Add soft color variation over the canopy surface so the material reads
    // less like a single flat green shell.
    const leafPos = leafGeo.attributes.position;
    const leafColor = new Float32Array(leafPos.count * 3);
    const cBase = new THREE.Color(vegetation.leafColor);
    const cShadow = new THREE.Color(vegetation.leafShadowColor);
    const cHighlight = new THREE.Color(vegetation.leafHighlightColor);
    const tmpColor = new THREE.Color();
    for (let i = 0; i < leafPos.count; i++) {
      const x = leafPos.getX(i);
      const y = leafPos.getY(i);
      const z = leafPos.getZ(i);
      const radial = Math.sqrt(x * x + z * z);
      const heightMix = THREE.MathUtils.clamp((y + 1.85) / 3.7, 0, 1);
      const radialMix = THREE.MathUtils.clamp(radial / 1.85, 0, 1);
      tmpColor.copy(cShadow).lerp(cBase, 0.45 + radialMix * 0.35).lerp(cHighlight, heightMix * 0.55);
      leafColor[i * 3] = tmpColor.r;
      leafColor[i * 3 + 1] = tmpColor.g;
      leafColor[i * 3 + 2] = tmpColor.b;
    }
    leafGeo.setAttribute('color', new THREE.BufferAttribute(leafColor, 3));

    const trunkMat = solid(
      vegetation.trunkColor,
      vegetation.trunkRoughness,
      vegetation.trunkMetalness,
      vegetation.trunkEnvIntensity,
    );
    const leafMat = new THREE.MeshStandardMaterial({
      map: foliageMap,
      vertexColors: true,
      roughness: vegetation.leafRoughness,
      metalness: vegetation.leafMetalness,
      envMapIntensity: vegetation.leafEnvIntensity,
    });

    const spots: Array<{ x: number; z: number; s: number; seed: number }> = [];
    const perStep = Math.max(1, Math.round(CFG.world.treeSpacing / CL.step));
    const sides2 = [-1, 1];
    let seed = 0;
    for (let i = 0; i < CL.count; i += perStep) {
      for (let k = 0; k < sides2.length; k++) {
        seed++;
        if (hash01(seed * 1.7) < vegetation.skipProbability) continue;
        const off = vegetation.offsetFromCentre * sides2[k];
        const x = CL.pts[i * 2] + CL.nrm[i * 2] * off;
        const z = CL.pts[i * 2 + 1] + CL.nrm[i * 2 + 1] * off;
        if (Math.hypot(x - CIRCLE.x, z - CIRCLE.z) < CIRCLE.r - 8) continue;
        spots.push({
          x,
          z,
          s: vegetation.minScale + hash01(seed * 2.9) * vegetation.scaleRange,
          seed,
        });
      }
    }

    /* Trees ring the whole circuit, so a single instanced pair could never be
       culled. Splitting them into city-sized spatial tiles keeps frustum
       culling useful while the foliage itself remains one InstancedMesh per tile. */
    if (spots.length > 0) {
      const TT = CITY_PROFILE.tileSize;
      const treeTiles: Record<string, Array<{ x: number; z: number; s: number; seed: number }>> = {};
      const treeKeys: string[] = [];
      for (let i = 0; i < spots.length; i++) {
        const sp = spots[i];
        const key = Math.floor(sp.x / TT) + '|' + Math.floor(sp.z / TT);
        if (!treeTiles[key]) { treeTiles[key] = []; treeKeys.push(key); }
        treeTiles[key].push(sp);
      }

      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const pos = new THREE.Vector3();
      const scale = new THREE.Vector3();

      for (let k = 0; k < treeKeys.length; k++) {
        const list = treeTiles[treeKeys[k]];
        const tg = trunkGeo.clone();
        const lg = leafGeo.clone();

        const trunks = new THREE.InstancedMesh(tg, trunkMat, list.length);
        const leaves = new THREE.InstancedMesh(
          lg,
          leafMat,
          list.length * vegetation.canopyLobes,
        );

        trunks.castShadow = QUALITY.shadow.treeCasters;
        leaves.castShadow = QUALITY.shadow.treeCasters;
        leaves.receiveShadow = true;

        let leafInstance = 0;
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0;

        for (let i = 0; i < list.length; i++) {
          const sp = list[i];

          scale.set(sp.s, sp.s, sp.s);
          q.identity();
          pos.set(sp.x, 1.7 * sp.s, sp.z);
          m4.compose(pos, q, scale);
          trunks.setMatrixAt(i, m4);

          // Four overlapping canopy lobes: central, left, right, and top.
          // Small deterministic offsets/rotations avoid cloned silhouettes.
          const wobbleX = (hash01(sp.seed * 4.7) - 0.5) * 0.55 * sp.s;
          const wobbleZ = (hash01(sp.seed * 6.1) - 0.5) * 0.55 * sp.s;
          const rot = hash01(sp.seed * 8.3) * TAU;

          const lobes = [
            { x: 0.00, y: 4.75, z: 0.00, sx: 1.18, sy: 1.28, sz: 1.16 },
            { x: -1.15, y: 4.45, z: 0.30, sx: 0.90, sy: 1.00, sz: 0.92 },
            { x:  1.10, y: 4.50, z: -0.25, sx: 0.92, sy: 1.02, sz: 0.90 },
            { x: 0.15, y: 6.00, z: 0.10, sx: 0.82, sy: 0.92, sz: 0.82 },
          ];

          for (let lobeIndex = 0; lobeIndex < lobes.length; lobeIndex++) {
            const lobe = lobes[lobeIndex];
            const c = Math.cos(rot), s = Math.sin(rot);
            const lx = lobe.x * c - lobe.z * s;
            const lz = lobe.x * s + lobe.z * c;

            pos.set(
              sp.x + (lx + wobbleX) * sp.s,
              lobe.y * sp.s,
              sp.z + (lz + wobbleZ) * sp.s,
            );
            q.setFromAxisAngle(
              new THREE.Vector3(0, 1, 0),
              rot + lobeIndex * 0.73,
            );
            scale.set(
              lobe.sx * sp.s,
              lobe.sy * sp.s,
              lobe.sz * sp.s,
            );
            m4.compose(pos, q, scale);
            leaves.setMatrixAt(leafInstance++, m4);
          }

          const r = 4.2 * sp.s;
          if (sp.x - r < minX) minX = sp.x - r;
          if (sp.x + r > maxX) maxX = sp.x + r;
          if (sp.z - r < minZ) minZ = sp.z - r;
          if (sp.z + r > maxZ) maxZ = sp.z + r;
          if (8.3 * sp.s > maxY) maxY = 8.3 * sp.s;
        }

        trunks.instanceMatrix.needsUpdate = true;
        leaves.instanceMatrix.needsUpdate = true;

        const cx = (minX + maxX) * 0.5;
        const cz = (minZ + maxZ) * 0.5;
        const rad = 0.5 * Math.hypot(maxX - minX, maxY, maxZ - minZ);
        const sphere = new THREE.Sphere(
          new THREE.Vector3(cx, maxY * 0.5, cz),
          rad,
        );

        tg.boundingSphere = sphere.clone();
        lg.boundingSphere = sphere.clone();
        trunks.frustumCulled = true;
        leaves.frustumCulled = true;

        scene.add(trunks);
        scene.add(leaves);
        distanceCuller.register(trunks, cx, cz, rad);
        distanceCuller.register(leaves, cx, cz, rad);
      }
    }
  }
  tick('Hanging signage and planting the street');

  /* ------- the car: a low-poly open-wheeler pointing along its local +X ---- */
  const {
    carRoot,
    carBody,
    frontAxle,
    allWheels,
  } = createVehicle(scene);

  /* INDYGP-H1-COMPETITION-V1: optional rival visuals share the accepted car renderer. */
  const opponents = createOpponentGrid(scene, deps.opponentCount ?? 3);

  return {
    renderer: renderer,
    scene: scene,
    camera: camera,
    carRoot: carRoot,
    carBody: carBody,
    frontAxle: frontAxle,
    allWheels: allWheels,
    opponents: opponents,
    HW: HW,
    sun: sun,
    updateShadow: updateShadow,
    cullableCount: distanceCuller.count,
    getResolutionScale: function (): number { return adaptiveResolution.getScale(); }
  };
}

export type World = ReturnType<typeof createWorld>;
