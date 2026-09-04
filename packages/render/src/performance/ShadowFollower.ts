import * as THREE from 'three';

type ShadowQuality = {
  enabled: boolean;
  span: number;
  mapSize: number;
  casterBias: number;
};

type ShadowFollowerDeps = {
  sun: THREE.DirectionalLight;
  sunDir: THREE.Vector3;
  shadow: ShadowQuality;
};

export function createShadowFollower({
  sun,
  sunDir,
  shadow,
}: ShadowFollowerDeps) {
  const shadowUnit = sunDir.clone().normalize();
  const texel = (shadow.span * 2) / shadow.mapSize;

  function update(x: number, z: number): void {
    if (!shadow.enabled) {
      return;
    }

    /* Quantise the focus to whole shadow texels. Without this the map crawls
       sub-texel as the car moves and every shadow edge shimmers. */
    const focusX = Math.round(x / texel) * texel;
    const focusZ = Math.round(z / texel) * texel;

    sun.target.position.set(focusX, 0, focusZ);
    sun.target.updateMatrixWorld();

    sun.position.set(
      focusX + shadowUnit.x * shadow.casterBias + sunDir.x,
      sunDir.y + shadowUnit.y * shadow.casterBias,
      focusZ + shadowUnit.z * shadow.casterBias + sunDir.z
    );

    sun.shadow.camera.updateProjectionMatrix();
  }

  return {
    update,
  };
}
