import * as THREE from 'three';
import { LIGHTING_PROFILE } from './lightingProfile';

const DEG = Math.PI / 180;

/* Place a light on a sphere. Azimuth is clockwise from +x (east), elevation is
   degrees above the horizon. */
function polar(azDeg: number, elDeg: number, dist: number): THREE.Vector3 {
  const az = azDeg * DEG;
  const el = elDeg * DEG;

  return new THREE.Vector3(
    Math.cos(az) * Math.cos(el) * dist,
    Math.sin(el) * dist,
    Math.sin(az) * Math.cos(el) * dist
  );
}

export function createLighting(scene: THREE.Scene) {
  scene.add(
    new THREE.HemisphereLight(
      LIGHTING_PROFILE.hemi.sky,
      LIGHTING_PROFILE.hemi.ground,
      LIGHTING_PROFILE.hemi.intensity
    )
  );

  const sunDir = polar(
    LIGHTING_PROFILE.sun.azimuthDeg,
    LIGHTING_PROFILE.sun.elevationDeg,
    LIGHTING_PROFILE.sun.distance
  );

  const sun = new THREE.DirectionalLight(
    LIGHTING_PROFILE.sun.color,
    LIGHTING_PROFILE.sun.intensity
  );

  sun.position.copy(sunDir);
  sun.castShadow = LIGHTING_PROFILE.shadow.enabled;

  const sh = LIGHTING_PROFILE.shadow;
  sun.shadow.mapSize.set(sh.mapSize, sh.mapSize);
  sun.shadow.camera.near = sh.near;
  sun.shadow.camera.far = sh.far;
  sun.shadow.camera.left = -sh.span;
  sun.shadow.camera.right = sh.span;
  sun.shadow.camera.top = sh.span;
  sun.shadow.camera.bottom = -sh.span;
  sun.shadow.bias = sh.bias;
  sun.shadow.normalBias = sh.normalBias;
  sun.shadow.radius = sh.radius;

  scene.add(sun);
  scene.add(sun.target);

  /* Cool bounce from the opposite quarter, filling shadowed canyon walls. */
  const bounce = new THREE.DirectionalLight(
    LIGHTING_PROFILE.bounce.color,
    LIGHTING_PROFILE.bounce.intensity
  );
  bounce.position.copy(
    polar(
      LIGHTING_PROFILE.bounce.azimuthDeg,
      LIGHTING_PROFILE.bounce.elevationDeg,
      400
    )
  );
  scene.add(bounce);

  const shadowUnit = sunDir.clone().normalize();
  const texel = (sh.span * 2) / sh.mapSize;

  return {
    sun,
    sunDir,
    sh,
    shadowUnit,
    texel,
  };
}

export function createSkyEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  skyTexture: THREE.Texture
): void {
  const skyMat = new THREE.MeshStandardMaterial({
    map: skyTexture,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });

  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(3000, 32, 18),
    skyMat
  );
  scene.add(skyDome);

  /* Image-based lighting generated from a miniature copy of the same dome, so
     every reflective surface picks up the real sky gradient and sun colour. */
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  const radius = LIGHTING_PROFILE.env.domeRadius;

  envScene.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(radius, 32, 18),
      new THREE.MeshStandardMaterial({
        map: skyTexture,
        side: THREE.BackSide,
      })
    )
  );

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.98, 32),
    new THREE.MeshStandardMaterial({
      color: 0x2E2C27,
      side: THREE.DoubleSide,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1;
  envScene.add(floor);

  /* R2 FIX (fake-glow defect): a large near-white sun disc was baked into the
     IBL here. Every surface sampled it as a searing specular hotspot — on the
     road at chase-cam grazing angles it rendered as a soft bright ellipse
     fixed in world space, looking like a fake light pool. The actual sun is
     the DirectionalLight above; the IBL only needs the sky gradient for
     ambient reflection, so the disc is gone. */

  const rt = pmrem.fromScene(envScene, 0.02);
  scene.environment = rt.texture;
  pmrem.dispose();
}
