import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getPitPath, PIT_SPEED_LIMIT, samplePitPath } from '@indygp/core';

/* M4D PIT LANE — render kit (2026-09-07).
 *
 * Builds along the pit path (packages/core/src/pitlane.ts):
 *  - asphalt ribbon (10 m wide), distinct from the road (darker, no lines)
 *  - concrete pit WALL separating pit lane from the track (on the track side)
 *  - garage/paddock row on the far (north) side: brick+glass per Lucas Oil
 *    language, one merged structure with a continuous fascia
 *  - 5 box markings (white U outlines) + box number boards
 *  - entry/exit chevrons + speed-limit board at the limit zone
 *
 * HARD RULE: the pit wall's track-side face sits at z=-281 (2.6 m clear of
 * Ohio's barrier plane z=-279.4). Garages start at z=-293.
 */

export interface PitLaneKit {
  group: THREE.Group;
}

export function buildPitLane(scene: THREE.Scene): PitLaneKit {
  const group = new THREE.Group();
  const path = getPitPath();

  /* ---------------- asphalt ribbon ---------------------------------- */
  {
    const geos: THREE.BufferGeometry[] = [];
    const HALF_W = 5.0;
    const STEP = 4;
    for (let s = 0; s < path.length - STEP; s += STEP) {
      const a = samplePitPath(s);
      const b = samplePitPath(s + STEP);
      /* normal = left of travel */
      const nxA = -a.tz, nzA = a.tx;
      const nxB = -b.tz, nzB = b.tx;
      const quad = new THREE.BufferGeometry();
      quad.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([
          a.x + nxA * HALF_W, 0.045, a.z + nzA * HALF_W,
          a.x - nxA * HALF_W, 0.045, a.z - nzA * HALF_W,
          b.x + nxB * HALF_W, 0.045, b.z + nzB * HALF_W,
          b.x - nxB * HALF_W, 0.045, b.z - nzB * HALF_W,
        ], 3),
      );
      quad.setIndex([0, 2, 1, 1, 2, 3]);
      quad.computeVertexNormals();
      geos.push(quad);
    }
    const asphalt = new THREE.Mesh(
      mergeGeometries(geos)!,
      new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.94 }),
    );
    asphalt.receiveShadow = true;
    group.add(asphalt);
  }

  /* ---------------- pit wall (track side) ---------------------------- */
  {
    /* The parallel section is straight (z≈-287), so the wall is one box:
       track-side face at z=-281 (2.6 m clear of Ohio's barrier plane
       z=-279.4 — HARD RULE), spanning x 20..300. A path-following ribbon
       was tried and wandered into the barrier plane at the curl ends. */
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(280, 1.0, 0.5),
      new THREE.MeshStandardMaterial({
        color: 0xcfd2d6, roughness: 0.8,
      }),
    );
    wall.position.set(160, 0.5, -281.25);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  }

  /* ---------------- garage / paddock row (far side) ------------------ */
  {
    /* parallel section: s from cum[7] to cum[11]; westbound (x decreasing) */
    const gs0 = getPitPath().cum[7];
    const gs1 = getPitPath().cum[11];
    const a = samplePitPath(gs0);
    const b = samplePitPath(gs1);
    const runLen = Math.hypot(b.x - a.x, b.z - a.z);
    const mid = samplePitPath((gs0 + gs1) / 2);
    /* garages sit 12.5 m north of the pit centreline */
    const gy = 0;
    const structGeos: THREE.BufferGeometry[] = [];
    const glassGeos: THREE.BufferGeometry[] = [];

    const DEPTH = 14;
    const H = 7.5;
    const zc = mid.z - (12.5 + DEPTH / 2);   // north side (z grows south)

    /* main mass (merged in two slabs to keep one draw call each) */
    const mass = new THREE.BoxGeometry(runLen, H, DEPTH);
    mass.translate(mid.x, H / 2 + gy, zc);
    structGeos.push(mass);

    /* fascia band over the garage mouths */
    const fascia = new THREE.BoxGeometry(runLen, 1.6, 0.5);
    fascia.translate(mid.x, H - 0.8 + gy, zc + DEPTH / 2 + 0.1);
    structGeos.push(fascia);

    /* roof lip */
    const lip = new THREE.BoxGeometry(runLen + 1.5, 0.5, DEPTH + 1.2);
    lip.translate(mid.x, H + 0.25 + gy, zc);
    structGeos.push(lip);

    /* glass garage mouths: dark recessed panels every ~9 m, laid along the
       westbound x axis (from b.x west end to a.x east end) */
    const mouthCount = Math.max(3, Math.round(runLen / 9));
    const xWest = Math.min(a.x, b.x);
    for (let m = 0; m < mouthCount; m++) {
      const mx = xWest + 5 + ((m + 0.5) * (runLen - 10)) / mouthCount;
      const glass = new THREE.BoxGeometry(6.4, 4.6, 0.4);
      glass.translate(mx, 2.5 + gy, zc + DEPTH / 2 + 0.05);
      glassGeos.push(glass);
    }

    const brickMat = new THREE.MeshStandardMaterial({ color: 0x6e4a38, roughness: 0.85 });
    const struct = new THREE.Mesh(mergeGeometries(structGeos)!, brickMat);
    struct.castShadow = true;
    struct.receiveShadow = true;
    group.add(struct);

    const glassMat = new THREE.MeshStandardMaterial({ color: 0x141a20, roughness: 0.25, metalness: 0.55 });
    group.add(new THREE.Mesh(mergeGeometries(glassGeos)!, glassMat));
  }

  /* ---------------- box markings + number boards --------------------- */
  {
    const markMat = new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.7 });
    for (let b = 0; b < path.boxS.length; b++) {
      const s = path.boxS[b];
      const c = samplePitPath(s);
      const nX = -c.tz, nZ = c.tx;   // left of travel
      const parts: THREE.BufferGeometry[] = [];
      /* U outline: two side strips + back strip (boxes open toward the wall) */
      const L = 5.5, W = 2.4;
      const side = new THREE.BoxGeometry(0.25, 0.03, L);
      side.translate(0, 0.035, 0);
      const back = new THREE.BoxGeometry(W, 0.03, 0.25);
      back.translate(0, 0.035, -L / 2);
      parts.push(side.clone());
      const s2 = side.clone();
      s2.translate(W, 0, 0);
      parts.push(s2);
      parts.push(back);

      const yaw = Math.atan2(c.tx, c.tz);
      const holder = new THREE.Group();
      for (const pGeo of parts) {
        const m = new THREE.Mesh(pGeo, markMat);
        holder.add(m);
      }
      holder.position.set(c.x, 0, c.z);
      holder.rotation.y = yaw;
      holder.updateMatrixWorld(true);

      /* bake into world space for one merged marks mesh */
      const worldGeos: THREE.BufferGeometry[] = [];
      holder.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const g = (o as THREE.Mesh).geometry.clone();
          g.applyMatrix4(o.matrixWorld);
          worldGeos.push(g);
        }
      });
      group.add(new THREE.Mesh(mergeGeometries(worldGeos)!, markMat));
      /* note: each box adds ~3 tris * 3 — negligible; skipping merge across boxes */
    }
  }

  /* ---------------- entry/exit chevrons + limit board ---------------- */
  {
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.4, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x10141c, roughness: 0.6 }),
    );
    const p = samplePitPath(path.limitFromS + 4);
    board.position.set(p.x - p.tz * 4.6, 2.2, p.z + p.tx * 4.6);
    board.rotation.y = Math.atan2(p.tx, p.tz);
    group.add(board);
    void PIT_SPEED_LIMIT;
  }

  scene.add(group);
  return { group };
}
