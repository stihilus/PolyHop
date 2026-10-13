import * as THREE from 'three';

import { type LevelLook, DEFAULT_LOOK, sunDirection } from '../core/look';
import { DEFAULT_SKY } from '../core/types';
import { SKY_HEIGHT, SKY_WIDTH, fogDepth, fogPicture, horizonOf, parseHex, skyPixels } from './skyboxes';

export const SKY_COLOR = DEFAULT_SKY;

/** Where a picture sky finds its texture (the project's textures). */
export interface SkyTextures {
  get(name: string): { texture: THREE.Texture } | null;
}

export interface Environment {
  fog: THREE.Fog;
  /** The sky (and the fog that fades into it) takes this color. */
  setSky(color: string): void;
  /** Fog distances, the sun, the ambient light and the shadows of a level. */
  setLook(look: LevelLook): void;
  /**
   * Everything a level looks like at once: the sky (flat, generated or a picture of the project's textures),
   * the fog with its color, and the light.
   */
  setLevel(level: { sky: string; look: LevelLook }, textures?: SkyTextures | null): void;
  /** Keep the box the sun's shadows are drawn in around a point (call every frame, it is cheap). */
  followSun(center: THREE.Vector3): void;
}

const SHADOW_HALF = 30; // m: the shadow box reaches this far from its center
const SHADOW_MAP = 2048;

/**
 * Sky, fog and lights of a level. The editor view and the exported player build the same world.
 * Shadows are hard-edged (PCF): they sit well with pixel textures.
 */
export function createEnvironment(scene: THREE.Scene, renderer?: THREE.WebGLRenderer): Environment {
  if (renderer) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
  }
  const fog = new THREE.Fog(SKY_COLOR, DEFAULT_LOOK.fogNear, DEFAULT_LOOK.fogFar);
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = fog;
  const hemi = new THREE.HemisphereLight('#ffffff', '#7d8794', DEFAULT_LOOK.ambient);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(DEFAULT_LOOK.sunColor, DEFAULT_LOOK.sunIntensity);
  sun.castShadow = DEFAULT_LOOK.shadows;
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  const cam = sun.shadow.camera;
  cam.left = -SHADOW_HALF;
  cam.right = SHADOW_HALF;
  cam.top = SHADOW_HALF;
  cam.bottom = -SHADOW_HALF;
  cam.near = 1;
  cam.far = 220;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  let direction = sunDirection(DEFAULT_LOOK);
  const snap = (SHADOW_HALF * 2) / SHADOW_MAP;
  const sky = new THREE.Color();
  /** The generated sky texture on the scene now, with what it was made from. */
  let generated: { key: string; texture: THREE.Texture } | null = null;
  /** A texture of the project used as a sky (a clone, so its mapping does not touch the original). */
  let picture: THREE.Texture | null = null;

  const releaseSky = () => {
    generated?.texture.dispose();
    generated = null;
    picture?.dispose();
    picture = null;
  };

  const flat = (color: string, fogColor?: string) => {
    try {
      sky.set(color);
    } catch {
      sky.set(SKY_COLOR);
    }
    releaseSky();
    if (scene.background instanceof THREE.Color) scene.background.copy(sky);
    else scene.background = sky.clone();
    try {
      fog.color.set(fogColor ?? color);
    } catch {
      fog.color.copy(sky);
    }
  };

  /**
   * A wide texture as the background: the left and right edges meet, the middle row is the horizon.
   * Pixel pictures keep their hard edges (`crisp`), big photographs are smoothed.
   */
  const panorama = (texture: THREE.Texture, crisp: boolean): THREE.Texture => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = crisp ? THREE.NearestFilter : THREE.LinearFilter;
    texture.magFilter = crisp ? THREE.NearestFilter : THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  };

  const environment: Environment = {
    fog,
    setSky(color: string) {
      flat(color);
    },
    setLevel(level, textures) {
      const look = level.look;
      this.setLook(look);
      const horizon = level.sky;
      const style = look.skyStyle;
      // the fog is also laid over the sky: thick at the horizon, clearing upward
      const tau = fogDepth(look.fogSky, look.fogFar);

      if (style === 'texture' && look.skyTexture) {
        const info = textures?.get(look.skyTexture);
        if (info) {
          releaseSky();
          const image = info.texture.image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
          // the fog follows the horizon of the picture unless it has a color of its own
          const fogHex = look.fogColor ?? (image ? horizonOf(image) : null) ?? horizon;
          const fogged = tau > 0.004 && image ? fogPicture(image, parseHex(fogHex), tau) : null;
          if (fogged) picture = panorama(new THREE.CanvasTexture(fogged), true);
          else picture = panorama(info.texture.clone(), (Number(image?.width) || 0) <= 1024);
          scene.background = picture;
          fog.color.set(fogHex);
          return;
        }
      }

      // a flat sky with a fog of another color still gets that fog over its lower part: a gradient from sky to fog
      const fogHex = look.fogColor ?? horizon;
      const generate: 'gradient' | 'clouds' | 'stars' | null =
        style === 'gradient' || style === 'clouds' || style === 'stars'
          ? style
          : style === 'color' && tau > 0.004 && fogHex.toLowerCase() !== horizon.toLowerCase()
            ? 'gradient'
            : style === 'texture' && tau > 0.004
              ? 'gradient'
              : null;
      if (generate && typeof document !== 'undefined') {
        const top = style === 'color' || style === 'texture' ? horizon : look.skyTop;
        const key = `${generate}|${horizon}|${top}|${fogHex}|${tau.toFixed(3)}`;
        if (generated?.key !== key) {
          const canvas = document.createElement('canvas');
          canvas.width = SKY_WIDTH;
          canvas.height = SKY_HEIGHT;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const data = skyPixels(generate, SKY_WIDTH, SKY_HEIGHT, parseHex(horizon), parseHex(top), parseHex(fogHex), 1, tau);
            const image = ctx.createImageData(SKY_WIDTH, SKY_HEIGHT);
            image.data.set(data);
            ctx.putImageData(image, 0, 0);
            releaseSky();
            generated = { key, texture: panorama(new THREE.CanvasTexture(canvas), true) };
          }
        }
        if (generated) {
          scene.background = generated.texture;
          fog.color.set(fogHex);
          return;
        }
      }

      flat(horizon, look.fogColor ?? undefined);
    },
    setLook(look: LevelLook) {
      fog.near = look.fogNear;
      fog.far = look.fogFar;
      hemi.intensity = look.ambient;
      sun.color.set(look.sunColor);
      sun.intensity = look.sunIntensity;
      sun.castShadow = look.shadows;
      direction = sunDirection(look);
    },
    followSun(center: THREE.Vector3) {
      // snapped to the texel size, so the shadows do not shimmer as the box follows
      const x = Math.round(center.x / snap) * snap;
      const y = Math.round(center.y / snap) * snap;
      const z = Math.round(center.z / snap) * snap;
      sun.target.position.set(x, y, z);
      sun.position.set(x + direction[0] * 90, y + direction[1] * 90, z + direction[2] * 90);
      sun.target.updateMatrixWorld();
    },
  };
  return environment;
}
