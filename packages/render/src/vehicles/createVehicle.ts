import * as THREE from 'three';
import {
  DEFAULT_VEHICLE_LIVERY_ID,
  resolveVehicleLivery,
  type VehicleLivery,
  type VehicleLiveryId,
} from './liveries';
import { getTeam, type TeamSpec } from '@indygp/core';

export interface VehicleView {
  carRoot: THREE.Group;
  carBody: THREE.Group;
  frontAxle: THREE.Group[];
  allWheels: THREE.Mesh[];
  /* M3-BRAKELIGHTS: rear rain-light strip; competition layer toggles color. */
  brakeLight: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

/** Project a TeamSpec into the livery shape this renderer consumes. */
export function teamLivery(team: TeamSpec): VehicleLivery {
  const fallback = resolveVehicleLivery(DEFAULT_VEHICLE_LIVERY_ID);
  return {
    ...fallback,
    id: team.id as VehicleLiveryId,
    label: team.name,
    body: team.body,
    bodyHighlight: team.bodyHighlight,
    accentPrimary: team.accentPrimary,
    accentSecondary: team.accentSecondary,
    helmet: team.helmet,
  };
}

/**
 * TEAMS-V1: resolve which team paints this car. Priority:
 * explicit TeamSpec arg > ?team= URL param > legacy livery mapping > default.
 */
export function resolveCarTeam(
  requestedTeam?: TeamSpec | null,
  requestedLivery?: VehicleLiveryId | null
): TeamSpec {
  if (requestedTeam) return requestedTeam;
  const query = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : null;
  const teamParam = query?.get('team');
  if (teamParam) return getTeam(teamParam);
  const legacy = requestedLivery
    ?? (query?.get('livery') as VehicleLiveryId | null);
  if (legacy === 'azure') return getTeam('keystone');
  if (legacy === 'heritage') return getTeam('novalis');
  return getTeam('hogan');
}

export function createVehicle(
  scene: THREE.Scene,
  requestedLivery?: VehicleLiveryId,
  requestedTeam?: TeamSpec | null
): VehicleView {
  const carRoot = new THREE.Group();
  const carBody = new THREE.Group();

  /*
   * PR5 Car G1.3
   * Smooth procedural Formula silhouette: fuller monocoque, sidepods and engine
   * cover, realistic tyre proportions, cleaner wings, visible halo and helmet.
   * Local +X is forward and +Z is lateral. VehicleView integration is unchanged.
   */
  carRoot.add(carBody);
  scene.add(carRoot);

  const frontAxle: THREE.Group[] = [];
  const allWheels: THREE.Mesh[] = [];

  /* PR5 Car G3: typed livery presets; URL query can override the default. */
  /* TEAMS-V1: team spec wins; legacy livery is only a fallback mapping. */
  const team = resolveCarTeam(requestedTeam, requestedLivery);
  const queryLivery = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('livery')
    : null;
  const livery = teamLivery(team);
  void queryLivery;

  const material = (color: number, roughness: number, metalness: number) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });

  const navy = material(livery.body, 0.46, 0.22);
  const navyHighlight = material(livery.bodyHighlight, 0.44, 0.20);
  const carbon = material(livery.carbon, 0.90, 0.00);
  const carbonEdge = material(livery.carbonEdge, 0.78, 0.05);
  const accentPrimary = material(livery.accentPrimary, 0.55, 0.08);
  const accentSecondary = material(livery.accentSecondary, 0.50, 0.04);
  const helmetMat = material(livery.helmet, 0.50, 0.04);
  const cockpit = material(livery.cockpit, 0.96, 0.00);
  const tyreMat = material(livery.tyre, 1.00, 0.00);
  const rimMat = material(livery.rim, 0.46, 0.62);
  const brakeMat = material(livery.brake, 0.44, 0.74);

  const shadow = (object: THREE.Object3D): void => {
    object.castShadow = true;
    object.receiveShadow = true;
  };

  const addBox = (
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    rx = 0,
    ry = 0,
    rz = 0
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    shadow(mesh);
    carBody.add(mesh);
    return mesh;
  };

  const addRod = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    radius: number,
    material: THREE.Material
  ): THREE.Mesh => {
    const delta = new THREE.Vector3().subVectors(b, a);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, delta.length(), 8),
      material
    );
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      delta.clone().normalize()
    );
    shadow(mesh);
    carBody.add(mesh);
    return mesh;
  };

  const addLoft = (
    length: number,
    rearHeight: number,
    rearWidth: number,
    frontHeight: number,
    frontWidth: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    segments = 14
  ): THREE.Mesh => {
    const hx = length * 0.5;
    const positions: number[] = [];
    const indices: number[] = [];

    for (let ring = 0; ring < 2; ring++) {
      const px = ring === 0 ? -hx : hx;
      const height = ring === 0 ? rearHeight : frontHeight;
      const width = ring === 0 ? rearWidth : frontWidth;

      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        positions.push(
          px,
          Math.cos(a) * height * 0.5,
          Math.sin(a) * width * 0.5
        );
      }
    }

    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const a = i;
      const b = next;
      const c = segments + i;
      const d = segments + next;
      indices.push(a, c, b, b, c, d);
    }

    const rearCenter = positions.length / 3;
    positions.push(-hx, 0, 0);
    const frontCenter = positions.length / 3;
    positions.push(hx, 0, 0);

    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      indices.push(rearCenter, next, i);
      indices.push(frontCenter, segments + i, segments + next);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    shadow(mesh);
    carBody.add(mesh);
    return mesh;
  };

  /* ------------------------------ floor --------------------------------- */
  addBox(4.55, 0.055, 1.45, 0.0, 0.13, 0, carbon);
  addBox(2.85, 0.045, 0.12, -0.15, 0.18, 0.78, carbonEdge);
  addBox(2.85, 0.045, 0.12, -0.15, 0.18, -0.78, carbonEdge);
  addBox(0.88, 0.05, 1.62, -1.64, 0.15, 0, carbon);

  /* ------------------------- central monocoque --------------------------- */
  addLoft(1.5, 0.48, 0.86, 0.34, 0.62, 0.32, 0.42, 0, navy, 16);
  addLoft(0.95, 0.32, 0.62, 0.2, 0.4, 1.42, 0.39, 0, navyHighlight, 16);

  /* Long narrow nose. */
  addLoft(1.64, 0.2, 0.38, 0.11, 0.14, 2.18, 0.32, 0, accentSecondary, 14);
  addLoft(1.34, 0.08, 0.23, 0.045, 0.1, 2.1, 0.47, 0, navy, 12);

  /* ------------------------------ cockpit ------------------------------- */
  addLoft(0.78, 0.16, 0.58, 0.12, 0.48, 0.1, 0.61, 0, cockpit, 14);

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 14, 10),
    helmetMat
  );
  helmet.scale.set(1.0, 0.82, 0.92);
  helmet.position.set(-0.18, 0.78, 0);
  shadow(helmet);
  carBody.add(helmet);

  /* Halo. */
  addRod(
    new THREE.Vector3(0.28, 0.62, 0),
    new THREE.Vector3(0.28, 0.88, 0),
    0.034,
    carbon
  );
  addRod(
    new THREE.Vector3(0.28, 0.87, 0),
    new THREE.Vector3(-0.32, 0.79, 0.33),
    0.036,
    carbon
  );
  addRod(
    new THREE.Vector3(0.28, 0.87, 0),
    new THREE.Vector3(-0.32, 0.79, -0.33),
    0.036,
    carbon
  );
  addRod(
    new THREE.Vector3(-0.32, 0.79, 0.33),
    new THREE.Vector3(-0.48, 0.68, 0.23),
    0.034,
    carbon
  );
  addRod(
    new THREE.Vector3(-0.32, 0.79, -0.33),
    new THREE.Vector3(-0.48, 0.68, -0.23),
    0.034,
    carbon
  );

  /* ------------------------------ sidepods ------------------------------ */
  for (const side of [-1, 1]) {
    addLoft(
      1.62,
      0.34,
      0.45,
      0.42,
      0.56,
      -0.48,
      0.42,
      side * 0.52,
      navy,
      14
    );

    addBox(0.32, 0.22, 0.4, 0.18, 0.45, side * 0.53, cockpit);
    addBox(1.0, 0.05, 0.11, -0.42, 0.6, side * 0.72, accentPrimary);
    addBox(1.28, 0.04, 0.08, -0.4, 0.22, side * 0.78, carbonEdge);

    /* PR5 Car G2: sidepod inlet lip and restrained floor-edge strakes. */
    addBox(0.09, 0.26, 0.46, 0.31, 0.45, side * 0.53, carbonEdge);
    const strakeX = [-0.92, -0.52, -0.12];
    for (let i = 0; i < strakeX.length; i++) {
      addBox(0.26, 0.07, 0.035, strakeX[i], 0.255, side * 0.82, carbon);
    }
  }

  /* Upper shoulders make the body read as one continuous volume. */
  addLoft(1.08, 0.24, 0.82, 0.2, 0.66, -0.18, 0.56, 0, navy, 16);
  addLoft(0.72, 0.14, 0.64, 0.12, 0.5, 0.04, 0.69, 0, navyHighlight, 14);

  /* ------------------------- engine cover ------------------------------- */
  addLoft(1.42, 0.48, 0.6, 0.32, 0.3, -1.18, 0.5, 0, navy, 16);
  addLoft(0.88, 0.3, 0.36, 0.2, 0.22, -1.8, 0.42, 0, navyHighlight, 14);
  addBox(0.72, 0.05, 0.16, -0.98, 0.72, 0, accentPrimary);
  addBox(0.32, 0.24, 0.22, -0.52, 0.82, 0, navy);
  addBox(0.17, 0.2, 0.16, -0.46, 0.98, 0, cockpit);

  /* G2 engine-cover spine / shark-fin cue. */
  addBox(1.34, 0.10, 0.055, -1.14, 0.79, 0, carbonEdge);
  addBox(0.82, 0.16, 0.045, -1.34, 0.87, 0, navyHighlight, 0, 0, 0.10);
  addBox(0.66, 0.045, 0.07, -1.04, 0.86, 0, accentPrimary);

  /* ----------------------------- front wing ----------------------------- */
  addBox(0.38, 0.045, 2.08, 2.9, 0.16, 0, carbon);
  addBox(0.28, 0.04, 1.9, 2.66, 0.215, 0, carbonEdge);
  addBox(0.22, 0.036, 1.58, 2.44, 0.255, 0, carbon);
  addBox(0.42, 0.036, 0.3, 2.74, 0.24, 0, accentPrimary);
  addBox(0.16, 0.28, 0.05, 2.84, 0.26, 1.04, carbon);
  addBox(0.16, 0.28, 0.05, 2.84, 0.26, -1.04, carbon);
  addBox(0.24, 0.035, 0.30, 2.78, 0.205, 0.89, carbonEdge, 0, 0.08, 0);
  addBox(0.24, 0.035, 0.30, 2.78, 0.205, -0.89, carbonEdge, 0, -0.08, 0);
  addBox(0.08, 0.16, 0.035, 2.63, 0.245, 0.64, carbon);
  addBox(0.08, 0.16, 0.035, 2.63, 0.245, -0.64, carbon);

  /* ------------------------------ rear wing ----------------------------- */
  addBox(0.32, 0.08, 1.72, -2.23, 0.92, 0, carbon);
  addBox(0.24, 0.065, 1.56, -2.05, 0.78, 0, carbonEdge);
  addBox(0.08, 0.56, 0.06, -2.18, 0.7, 0.86, carbon);
  addBox(0.08, 0.56, 0.06, -2.18, 0.7, -0.86, carbon);
  addBox(0.44, 0.045, 0.12, -1.98, 0.48, 0, accentPrimary);
  addBox(0.12, 0.48, 0.07, -2.08, 0.67, 0, carbonEdge);
  addBox(0.26, 0.055, 1.32, -2.02, 0.46, 0, carbon);
  addBox(0.42, 0.10, 0.055, -1.98, 0.28, 0.43, carbonEdge, 0, 0, 0.12);
  addBox(0.42, 0.10, 0.055, -1.98, 0.28, -0.43, carbonEdge, 0, 0, -0.12);

  /* ---------------------------- suspension ------------------------------ */
  const frontX = 1.82;
  const rearX = -1.68;
  const frontTrack = 0.92;
  const rearTrack = 0.94;

  for (const side of [-1, 1]) {
    const frontHub = new THREE.Vector3(frontX, 0.37, side * frontTrack);
    addRod(new THREE.Vector3(1.02, 0.27, side * 0.34), frontHub, 0.018, carbon);
    addRod(new THREE.Vector3(0.94, 0.5, side * 0.31), frontHub, 0.016, carbon);

    const rearHub = new THREE.Vector3(rearX, 0.38, side * rearTrack);
    addRod(new THREE.Vector3(-0.96, 0.28, side * 0.4), rearHub, 0.019, carbon);
    addRod(new THREE.Vector3(-1.0, 0.51, side * 0.34), rearHub, 0.016, carbon);
    addRod(new THREE.Vector3(-1.16, 0.39, side * 0.24), rearHub, 0.014, carbonEdge);
    addRod(new THREE.Vector3(1.18, 0.41, side * 0.22), frontHub, 0.014, carbonEdge);
  }

  /* ------------------------------- wheels ------------------------------- */
  const frontTyreGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.31, 28, 1);
  frontTyreGeo.rotateX(Math.PI * 0.5);

  const rearTyreGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.39, 28, 1);
  rearTyreGeo.rotateX(Math.PI * 0.5);

  const frontRimGeo = new THREE.CylinderGeometry(0.205, 0.205, 0.325, 22, 1);
  frontRimGeo.rotateX(Math.PI * 0.5);

  const rearRimGeo = new THREE.CylinderGeometry(0.215, 0.215, 0.405, 22, 1);
  rearRimGeo.rotateX(Math.PI * 0.5);

  const frontBrakeGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.07, 20, 1);
  frontBrakeGeo.rotateX(Math.PI * 0.5);

  const rearBrakeGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.075, 20, 1);
  rearBrakeGeo.rotateX(Math.PI * 0.5);

  const axles = [
    {
      x: frontX,
      z: frontTrack,
      y: 0.37,
      tyre: frontTyreGeo,
      rim: frontRimGeo,
      brake: frontBrakeGeo,
      steer: true,
    },
    {
      x: rearX,
      z: rearTrack,
      y: 0.38,
      tyre: rearTyreGeo,
      rim: rearRimGeo,
      brake: rearBrakeGeo,
      steer: false,
    },
  ];

  for (const axle of axles) {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(axle.x, axle.y, side * axle.z);

      const tyre = new THREE.Mesh(axle.tyre, tyreMat);
      const rim = new THREE.Mesh(axle.rim, rimMat);
      const brake = new THREE.Mesh(axle.brake, brakeMat);

      /* PR5 Car G4: sidewall shoulder, rim lip, hub, and brake depth. */
      /* PR5 Car G4.1: keep ring axes on Z and mechanical parts inside tire width. */
      const tyreRadius = axle.steer ? 0.37 : 0.38;
      const tyreWidth = axle.steer ? 0.31 : 0.39;
      const sidewallGeo = new THREE.TorusGeometry(
        tyreRadius * 0.82,
        tyreRadius * 0.07,
        8,
        24
      );
      const sidewall = new THREE.Mesh(sidewallGeo, tyreMat);

      const lipGeo = new THREE.TorusGeometry(
        tyreRadius * 0.56,
        tyreRadius * 0.025,
        8,
        20
      );
      const rimLip = new THREE.Mesh(lipGeo, rimMat);

      const hubGeo = new THREE.CylinderGeometry(
        tyreRadius * 0.12,
        tyreRadius * 0.12,
        tyreWidth * 0.82,
        14
      );
      hubGeo.rotateX(Math.PI * 0.5);
      const hub = new THREE.Mesh(hubGeo, rimMat);

      const nutGeo = new THREE.CylinderGeometry(
        tyreRadius * 0.055,
        tyreRadius * 0.055,
        tyreWidth * 0.58,
        12
      );
      nutGeo.rotateX(Math.PI * 0.5);
      const wheelNut = new THREE.Mesh(nutGeo, brakeMat);

      const discGeo = new THREE.TorusGeometry(
        tyreRadius * 0.34,
        tyreRadius * 0.035,
        8,
        20
      );
      discGeo.rotateY(Math.PI * 0.5);
      const brakeDisc = new THREE.Mesh(discGeo, brakeMat);

      shadow(tyre);
      shadow(rim);
      shadow(brake);
      shadow(sidewall);
      shadow(rimLip);
      shadow(hub);
      shadow(wheelNut);
      shadow(brakeDisc);

      pivot.add(tyre);
      pivot.add(rim);
      pivot.add(brake);
      pivot.add(sidewall);
      pivot.add(rimLip);
      pivot.add(hub);
      pivot.add(wheelNut);
      pivot.add(brakeDisc);
      carBody.add(pivot);

      allWheels.push(tyre, rim, sidewall, rimLip, hub, wheelNut, brakeDisc);
      if (axle.steer) frontAxle.push(pivot);
    }
  }

  /* M3-BRAKELIGHTS + W1b: F1-style rear rain light on the crash structure.
     Must be VISIBLE from the chase cam: two placements failed. v1
     (-1.78, 0.55) hid under the rear wing; v2 (-2.05, 0.78) sat UNDER the
     wing plane (x -2.39..-2.07, y 0.88..0.96) which still shadowed it from
     the above-behind camera (AABB-verified headlessly, 2026-09-09). Final:
     x=-2.45 AFT of the wing entirely, y=0.82 — reads like the FIA rain light
     poking out of the crash structure. Widened to a strip so it reads at
     chase-cam distance. Dim dark red at rest; brake layers pulse it bright
     red (createCompetition + main.ts). */
  const brakeLightMat = new THREE.MeshBasicMaterial({ color: 0x4a0806 });
  const brakeLightGeo = new THREE.BoxGeometry(0.05, 0.09, 0.34);
  const brakeLight = new THREE.Mesh(brakeLightGeo, brakeLightMat);
  brakeLight.position.set(-2.45, 0.82, 0);
  carBody.add(brakeLight);

  return {
    carRoot,
    carBody,
    frontAxle,
    allWheels,
    brakeLight,
  };
}
