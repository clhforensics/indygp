import * as THREE from 'three';

interface Cullable {
  mesh: THREE.Object3D;
  cx: number;
  cz: number;
  r: number;
}

export function createDistanceCuller(
  camera: THREE.Camera,
  baseDistance: number
) {
  const cullables: Cullable[] = [];

  function register(
    mesh: THREE.Object3D,
    cx: number,
    cz: number,
    radius: number
  ): void {
    cullables.push({
      mesh,
      cx,
      cz,
      r: radius,
    });
  }

  function update(): void {
    if (cullables.length === 0) {
      return;
    }

    const cameraX = camera.position.x;
    const cameraZ = camera.position.z;

    for (let i = 0; i < cullables.length; i++) {
      const cullable = cullables[i];
      const dx = cameraX - cullable.cx;
      const dz = cameraZ - cullable.cz;
      const limit = baseDistance + cullable.r;

      cullable.mesh.visible =
        dx * dx + dz * dz < limit * limit;
    }
  }

  return {
    register,
    update,
    get count(): number {
      return cullables.length;
    },
  };
}
