// The material of tiled surfaces: one rectangle (a tile) of an atlas repeated over every face. Used by level blocks,
// by the instances of tile-mapped models and by the model editor.

import * as THREE from 'three';

export interface UvRect {
  u0: number;
  v0: number; // bottom
  u1: number;
  v1: number; // top
}

export function tileUvRect(col: number, row: number, tileSize: number, texW: number, texH: number): UvRect {
  const inset = 0.01; // texel fraction, avoids bleeding from neighbouring tiles
  return {
    u0: (col * tileSize + inset) / texW,
    u1: ((col + 1) * tileSize - inset) / texW,
    v0: 1 - ((row + 1) * tileSize - inset) / texH,
    v1: 1 - (row * tileSize + inset) / texH,
  };
}

/**
 * A Lambert material that repeats one rectangle of an atlas over every face: the fragment shader wraps
 * the per-vertex tile coordinates with fract() into the tile's sub-rectangle. Nearest filtering and no
 * mipmaps (see TextureLibrary) make the wrap seamless.
 */
export function tiledMaterial(
  map: THREE.Texture,
  rect: UvRect,
  color: THREE.Color,
  side: THREE.Side,
  opacity = 1,
  scroll?: THREE.Vector2,
): THREE.MeshLambertMaterial {
  // alphaTest: pixels that are more than half transparent are cut out (grass, leaves, fences)
  const mat = new THREE.MeshLambertMaterial({ map, color, alphaTest: 0.5, side });
  if (opacity < 1) {
    // see-through: water, glass. Drawn after the solid things and not written to the depth buffer
    mat.transparent = true;
    mat.opacity = opacity;
    mat.depthWrite = false;
  }
  const tile = new THREE.Vector4(rect.u0, rect.v0, rect.u1 - rect.u0, rect.v1 - rect.v0);
  const offset = scroll ?? new THREE.Vector2(0, 0);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTile = { value: tile };
    shader.uniforms.uScroll = { value: offset };
    shader.vertexShader =
      'attribute vec2 aTileUv;\nvarying vec2 vTileUv;\n' +
      shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vTileUv = aTileUv;');
    shader.fragmentShader =
      'uniform vec4 uTile;\nuniform vec2 uScroll;\nvarying vec2 vTileUv;\n' +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec2 tileCoord = uTile.xy + fract(vTileUv + uScroll) * uTile.zw;
          vec4 sampledDiffuseColor = texture2D( map, tileCoord );
          diffuseColor *= sampledDiffuseColor;
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'polyhop-tiled-lambert';
  return mat;
}
