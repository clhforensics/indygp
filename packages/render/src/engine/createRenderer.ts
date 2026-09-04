import * as THREE from 'three';
import { LIGHTING_PROFILE } from '../environment/lightingProfile';

type RendererQuality = {
  shadow: {
    enabled: boolean;
    softPCF: boolean;
  };
};

export function createRenderer(
  canvas: HTMLCanvasElement,
  quality: RendererQuality
): THREE.WebGLRenderer {
  let renderer: THREE.WebGLRenderer;

  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
  } catch (e: any) {
    throw new Error(
      'WebGL is not available: ' + ((e && e.message) || e)
    );
  }

  if (!renderer.getContext()) {
    throw new Error('WebGL context could not be created');
  }

  renderer.setClearColor(0xB8C6CE);
  /* Modern color pipeline (three r152+): output in sRGB with full color
     management. Replaces the legacy outputEncoding/sRGBEncoding path. */
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LIGHTING_PROFILE.tone.exposure;
  renderer.shadowMap.enabled = quality.shadow.enabled;

  /*
   * PCFSoft takes many more taps per shadowed fragment than plain PCF.
   * At a 1024 map the extra softness is largely wasted, so balanced and
   * fast tiers drop to PCF and spend the budget on resolution instead.
   */
  renderer.shadowMap.type = quality.shadow.softPCF
    ? THREE.PCFSoftShadowMap
    : THREE.PCFShadowMap;

  /* three r155+ uses physically-based light units by default; the scene's
     light intensities are tuned in the legacy unit space, so keep that. */
  renderer.useLegacyLights = true;

  return renderer;
}
