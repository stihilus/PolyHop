// How a level looks: the sky and the fog, the sun, the ambient light, shadows. Plain data kept in every level.
// The color of the sky itself (the horizon) is `LevelData.sky`; this holds the rest.

/** What is behind the world: a flat color, a gradient up to a top color, a gradient with clouds or stars, or a picture. */
export type SkyStyle = 'color' | 'gradient' | 'clouds' | 'stars' | 'texture';

export const SKY_STYLES: { value: SkyStyle; label: string; hint: string }[] = [
  { value: 'color', label: 'Flat color', hint: 'One color, like a plain backdrop' },
  { value: 'gradient', label: 'Gradient', hint: 'From the sky color at the horizon up to the top color' },
  { value: 'clouds', label: 'Clouds', hint: 'A gradient with soft pixel clouds' },
  { value: 'stars', label: 'Stars', hint: 'A gradient with a night sky of stars' },
  { value: 'texture', label: 'Picture', hint: 'A wide picture from your textures that wraps around the world' },
];

export interface LevelLook {
  /** What is behind the world. The horizon color is the level's sky color. */
  skyStyle: SkyStyle;
  /** The color at the top of the sky for gradient, clouds and stars. */
  skyTop: string;
  /** For the picture style: the name of a texture (a wide 2:1 picture works best). */
  skyTexture: string | null;
  /** Color of the fog; null follows the sky (its horizon color). */
  fogColor: string | null;
  /** How much the fog covers the sky itself: 0 not at all, 1 the whole sky is fog. The horizon is always fogged. */
  fogSky: number;
  /** Distances (m) where the fog starts and where it hides everything. */
  fogNear: number;
  fogFar: number;
  /** Direction of the sun: the compass angle it shines from and its height above the horizon, degrees. */
  sunYaw: number;
  sunPitch: number;
  sunColor: string;
  sunIntensity: number;
  /** Strength of the soft light that comes from all around (sky above, ground below). */
  ambient: number;
  /** Draw real shadows (otherwise a round blob under the player). */
  shadows: boolean;
}

export const DEFAULT_LOOK: LevelLook = {
  skyStyle: 'color',
  skyTop: '#3f78c8',
  skyTexture: null,
  fogColor: null,
  fogSky: 0.3,
  fogNear: 60,
  fogFar: 160,
  sunYaw: 30,
  sunPitch: 58,
  sunColor: '#fff4e0',
  sunIntensity: 1.9,
  ambient: 1.7,
  shadows: true,
};

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const color = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback);

/** A look of unknown origin made valid. */
export function normalizeLook(raw: unknown): LevelLook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<LevelLook>;
  const near = num(r.fogNear, 0, 1000, DEFAULT_LOOK.fogNear);
  const far = Math.max(near + 1, num(r.fogFar, 1, 2000, DEFAULT_LOOK.fogFar));
  const style = SKY_STYLES.find((x) => x.value === r.skyStyle)?.value ?? DEFAULT_LOOK.skyStyle;
  return {
    skyStyle: style,
    skyTop: color(r.skyTop, DEFAULT_LOOK.skyTop),
    skyTexture: typeof r.skyTexture === 'string' && r.skyTexture ? r.skyTexture : null,
    fogColor: typeof r.fogColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.fogColor) ? r.fogColor : null,
    fogSky: num(r.fogSky, 0, 1, DEFAULT_LOOK.fogSky),
    fogNear: near,
    fogFar: far,
    sunYaw: num(r.sunYaw, -360, 360, DEFAULT_LOOK.sunYaw),
    sunPitch: num(r.sunPitch, 5, 90, DEFAULT_LOOK.sunPitch),
    sunColor: color(r.sunColor, DEFAULT_LOOK.sunColor),
    sunIntensity: num(r.sunIntensity, 0, 6, DEFAULT_LOOK.sunIntensity),
    ambient: num(r.ambient, 0, 6, DEFAULT_LOOK.ambient),
    shadows: typeof r.shadows === 'boolean' ? r.shadows : DEFAULT_LOOK.shadows,
  };
}

/** Unit vector toward the sun (from the ground up into the sky). */
export function sunDirection(look: Pick<LevelLook, 'sunYaw' | 'sunPitch'>): [number, number, number] {
  const yaw = (look.sunYaw * Math.PI) / 180;
  const pitch = (look.sunPitch * Math.PI) / 180;
  const c = Math.cos(pitch);
  return [Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c];
}

/** A time of day: the sky and the light that go with it, to start from. */
export interface SkyPreset {
  id: string;
  label: string;
  /** The level's sky (horizon) color. */
  sky: string;
  look: Pick<LevelLook, 'skyStyle' | 'skyTop' | 'sunPitch' | 'sunColor' | 'sunIntensity' | 'ambient'>;
}

export const SKY_PRESETS: SkyPreset[] = [
  { id: 'day', label: 'Day', sky: '#bfe0f5', look: { skyStyle: 'clouds', skyTop: '#4a8fe0', sunPitch: 58, sunColor: '#fff4e0', sunIntensity: 1.9, ambient: 1.7 } },
  { id: 'dawn', label: 'Dawn', sky: '#ffd7b0', look: { skyStyle: 'gradient', skyTop: '#7fa8e0', sunPitch: 22, sunColor: '#ffd9a8', sunIntensity: 1.6, ambient: 1.5 } },
  { id: 'sunset', label: 'Sunset', sky: '#ff9a5a', look: { skyStyle: 'clouds', skyTop: '#3b3466', sunPitch: 12, sunColor: '#ffb27a', sunIntensity: 1.5, ambient: 1.2 } },
  { id: 'night', label: 'Night', sky: '#1c2540', look: { skyStyle: 'stars', skyTop: '#05070f', sunPitch: 40, sunColor: '#8fa8ff', sunIntensity: 0.55, ambient: 0.8 } },
  { id: 'overcast', label: 'Overcast', sky: '#aab4bf', look: { skyStyle: 'clouds', skyTop: '#7d8a99', sunPitch: 60, sunColor: '#e8edf2', sunIntensity: 0.9, ambient: 2.2 } },
];
