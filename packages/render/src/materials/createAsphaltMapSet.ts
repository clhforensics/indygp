import * as THREE from 'three';
import type { MapSet } from '../textures';

const ASPHALT_ROOT = '/assets/textures/asphalt';

function loadTexture(path: string, color = false): THREE.Texture {
  const texture = new THREE.TextureLoader().load(`${ASPHALT_ROOT}/${path}`);
  /* The road spans 0..1 across width and repeats only along the lap. Clamp
     laterally so edge sampling cannot bleed across the texture seam. */
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;

  if (color) texture.encoding = THREE.sRGBEncoding;

  return texture;
}

/**
 * Authored asphalt map set derived from the supplied Indianapolis reference.
 *
 * The source photograph contributes real aggregate variation. The albedo and
 * roughness maps also carry restrained, symmetric wheel-path wear so the road
 * reads as a used racing surface without an obvious painted racing-line stripe.
 * The road normal map remains disabled by the world baseline because the PR3
 * material audit showed it produced an unrealistic rolling response.
 */
export function createAsphaltMapSet(): MapSet {
  return {
    map: loadTexture('asphalt-albedo.png', true),
    roughnessMap: loadTexture('asphalt-roughness.png'),
    normalMap: loadTexture('asphalt-normal.png'),
  };
}
