import * as THREE from 'three';
import { PixelBuffer } from '../core/pixels';
import type { ProjectTexture } from '../core/types';

export interface TextureInfo {
  name: string;
  width: number;
  height: number;
  /** Size of one tile in pixels. Built-ins parse it from the file name ("Textures-16.png" => 16). */
  tileSize: number;
  texture: THREE.Texture;
  /** True for textures owned by the project (their pixels can be painted). */
  editable: boolean;
}

export function tileSizeFromName(name: string): number {
  const m = /-(\d+)\.[a-z]+$/i.exec(name);
  const n = m ? parseInt(m[1]!, 10) : 16;
  return n > 0 ? n : 16;
}

interface ProjectEntry {
  pixels: PixelBuffer;
  canvas: HTMLCanvasElement;
  info: TextureInfo;
}

function configure(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
}

/**
 * Pixel-art texture atlases. Two sources: read-only files from `assets/textures` ("built-in") and
 * editable textures stored in the project. A project texture with the same name as a built-in one
 * shadows it, so editing a stock atlas simply copies it into the project first.
 * Everything is nearest-filtered so pixels stay crisp.
 */
export class TextureLibrary {
  private urls = new Map<string, string>();
  private builtins = new Map<string, TextureInfo>();
  private project = new Map<string, ProjectEntry>();
  private getProjectTextures: () => ProjectTexture[] = () => [];

  /** Tell the library where the project's editable textures live. */
  bind(get: () => ProjectTexture[]): void {
    this.getProjectTextures = get;
    this.dropProjectCache();
  }

  /** Forget cached GPU textures of project textures (call after the project object was replaced). */
  dropProjectCache(): void {
    for (const e of this.project.values()) e.info.texture.dispose();
    this.project.clear();
  }

  register(name: string, url: string): void {
    this.urls.set(name, url);
    this.builtins.delete(name);
  }

  async preload(): Promise<void> {
    await Promise.all(
      [...this.urls.entries()]
        .filter(([name]) => !this.builtins.has(name))
        .map(async ([name, url]) => {
          const img = await loadImage(url);
          const texture = new THREE.Texture(img);
          configure(texture);
          texture.needsUpdate = true;
          this.builtins.set(name, {
            name,
            width: img.naturalWidth,
            height: img.naturalHeight,
            tileSize: tileSizeFromName(name),
            texture,
            editable: false,
          });
        }),
    );
  }

  /** Project textures first, then built-ins that the project has not replaced. */
  names(): string[] {
    const own = this.getProjectTextures().map((t) => t.name);
    const set = new Set(own);
    // built-ins in the order they were registered (loading finishes in any order)
    return [...own, ...[...this.urls.keys()].filter((n) => this.builtins.has(n) && !set.has(n))];
  }

  isProjectTexture(name: string): boolean {
    return this.getProjectTextures().some((t) => t.name === name);
  }

  isBuiltin(name: string): boolean {
    return this.builtins.has(name);
  }

  get(name: string): TextureInfo | null {
    const tex = this.getProjectTextures().find((t) => t.name === name);
    if (tex) return this.projectInfo(tex).info;
    return this.builtins.get(name) ?? null;
  }

  /** Editable pixels of a project texture, or null. */
  pixels(name: string): PixelBuffer | null {
    return this.getProjectTextures().find((t) => t.name === name)?.pixels ?? null;
  }

  /** How much of the tile at (col, row) of an atlas is opaque (0..1); 0 when there is no such tile. */
  tileCoverage(name: string, col: number, row: number): number {
    const info = this.get(name);
    if (!info || (col + 1) * info.tileSize > info.width || (row + 1) * info.tileSize > info.height) return 0;
    const pixels = this.pixels(name) ?? this.builtinPixels(name);
    return pixels ? pixels.coverage(col * info.tileSize, row * info.tileSize, info.tileSize, info.tileSize) : 0;
  }

  /**
   * The first atlas (project ones first) whose tile at (col, row) is mostly opaque: the tile a new block
   * or model face starts with must not be see-through, which some atlases (skins, plants) are.
   */
  atlasWithTile(col: number, row: number): string | null {
    return this.names().find((name) => this.tileCoverage(name, col, row) >= 0.5) ?? null;
  }

  /** Decode a built-in atlas into pixels (used to make an editable copy). */
  builtinPixels(name: string): PixelBuffer | null {
    const info = this.builtins.get(name);
    if (!info) return null;
    const canvas = document.createElement('canvas');
    canvas.width = info.width;
    canvas.height = info.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(info.texture.image as CanvasImageSource, 0, 0);
    const data = ctx.getImageData(0, 0, info.width, info.height).data;
    return new PixelBuffer(info.width, info.height, new Uint8ClampedArray(data));
  }

  /** Pixels of a project texture changed: re-upload (optionally only a dirty rectangle). */
  touch(name: string, rect?: { x: number; y: number; w: number; h: number }): void {
    const tex = this.getProjectTextures().find((t) => t.name === name);
    if (!tex) return;
    const entry = this.projectInfo(tex);
    const ctx = entry.canvas.getContext('2d')!;
    const img = new ImageData(tex.pixels.data, tex.pixels.w, tex.pixels.h);
    if (rect) {
      const x = Math.max(0, rect.x);
      const y = Math.max(0, rect.y);
      const w = Math.min(tex.pixels.w - x, rect.w);
      const h = Math.min(tex.pixels.h - y, rect.h);
      if (w > 0 && h > 0) ctx.putImageData(img, 0, 0, x, y, w, h);
    } else {
      ctx.putImageData(img, 0, 0);
    }
    entry.info.texture.needsUpdate = true;
  }

  private projectInfo(tex: ProjectTexture): ProjectEntry {
    const cached = this.project.get(tex.name);
    if (cached && cached.pixels === tex.pixels && cached.info.width === tex.pixels.w && cached.info.height === tex.pixels.h) {
      cached.info.tileSize = tex.tileSize;
      return cached;
    }
    cached?.info.texture.dispose();
    const canvas = document.createElement('canvas');
    canvas.width = tex.pixels.w;
    canvas.height = tex.pixels.h;
    canvas.getContext('2d')!.putImageData(new ImageData(tex.pixels.data, tex.pixels.w, tex.pixels.h), 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    configure(texture);
    texture.needsUpdate = true;
    const entry: ProjectEntry = {
      pixels: tex.pixels,
      canvas,
      info: {
        name: tex.name,
        width: tex.pixels.w,
        height: tex.pixels.h,
        tileSize: tex.tileSize,
        texture,
        editable: true,
      },
    };
    this.project.set(tex.name, entry);
    return entry;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load texture: ${url}`));
    img.src = url;
  });
}
