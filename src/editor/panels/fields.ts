// Which properties the inspector shows for the player and for blocks.

import { HUMANOID_SKINS } from '../../core/humanoid';
import type { Field } from '../ui/form';

/** The look of the player: model and skin. Attachments follow (see playerPanel.ts). */
export function playerLookFields(models: { id: string; name: string }[], textures: string[], modelId: string | null = null): Field[] {
  // the skins made for the chosen character come first
  const own = modelId ? (HUMANOID_SKINS[modelId] ?? []) : [];
  const ordered = [...own.filter((n) => textures.includes(n)), ...textures.filter((n) => !own.includes(n))];
  const template = own[own.length - 1] ?? 'the template of the character';
  return [
    { kind: 'section', label: 'Look' },
    {
      kind: 'select',
      key: 'modelId',
      label: 'Model',
      nullable: true,
      noneLabel: 'None (placeholder cube)',
      options: models.map((m) => ({ value: m.id, label: m.name })),
      hint: 'Use a model from the Models editor as the player. Its origin is the feet and +Z is the front. A model with bones is animated.',
    },
    {
      kind: 'select',
      key: 'skin',
      label: 'Skin',
      nullable: true,
      noneLabel: 'Model default',
      options: ordered.map((t) => ({ value: t, label: t.replace(/\.png$/i, '') })),
      hint: `A texture drawn on the model instead of its own. It must use the same layout as the model (see ${template}).`,
    },
    { kind: 'color', key: 'color', label: 'Cube color', hint: 'Only used by the placeholder cube' },
  ];
}

/** Where the player starts in the level being edited (the settings below are the same for every level). */
export const SPAWN_FIELDS: Field[] = [
  { kind: 'section', label: 'Start of this level' },
  { kind: 'vec3', key: 'spawn', label: 'Position', step: 0.5, unit: 'm', hint: 'Where the player starts (feet position). Drag the gizmo in the view.' },
  { kind: 'number', key: 'spawnYaw', label: 'Facing', step: 15, unit: '°', hint: 'Direction the player faces at the start' },
];

export function playerFields(sounds: { id: string; name: string }[]): Field[] {
  const options = sounds.map((x) => ({ value: x.id, label: x.name }));
  const sound = (key: string, label: string): Field => ({ kind: 'select', key, label, nullable: true, noneLabel: 'Silent', options });
  return [
    { kind: 'section', label: 'Size' },
    { kind: 'number', key: 'width', label: 'Width', min: 0.2, max: 4, step: 0.1, unit: 'm' },
    { kind: 'number', key: 'height', label: 'Height', min: 0.2, max: 4, step: 0.1, unit: 'm', hint: 'How tall the player is. The model is scaled to this height, and it is the size of the collision shape.' },
    { kind: 'number', key: 'crouchHeight', label: 'Crouch height', min: 0.1, max: 4, step: 0.1, unit: 'm' },

    { kind: 'section', label: 'Movement' },
    { kind: 'number', key: 'walkSpeed', label: 'Walk speed', min: 0, max: 30, step: 0.5, unit: 'm/s' },
    { kind: 'number', key: 'runSpeed', label: 'Run speed', min: 0, max: 40, step: 0.5, unit: 'm/s' },
    { kind: 'number', key: 'crouchSpeed', label: 'Crouch speed', min: 0, max: 20, step: 0.5, unit: 'm/s' },
    { kind: 'number', key: 'acceleration', label: 'Acceleration', min: 1, max: 300, step: 5, hint: 'How fast the player reaches full speed' },
    { kind: 'number', key: 'deceleration', label: 'Deceleration', min: 1, max: 300, step: 5, hint: 'How fast the player stops (low = icy)' },
    { kind: 'number', key: 'airControl', label: 'Air control', min: 0, max: 1, step: 0.05, hint: '0 = no steering in the air, 1 = same as ground' },
    { kind: 'number', key: 'maxSlope', label: 'Max slope', min: 5, max: 85, step: 5, unit: '°', hint: 'Steepest ramp the player can walk up. Steeper slopes are slid down.' },
    { kind: 'number', key: 'stepHeight', label: 'Step height', min: 0, max: 1, step: 0.05, unit: 'm', hint: 'Highest edge the player walks up without jumping (stairs, curbs). 0 = never' },
    { kind: 'number', key: 'steerSpeed', label: 'Steering speed', min: 30, max: 720, step: 10, unit: '°/s', hint: 'Behind-the-player camera: how fast A / D turn the player' },
    { kind: 'number', key: 'turnSpeed', label: 'Turn speed', min: 1, max: 60, step: 1, unit: 'rad/s', hint: 'Free camera: how fast the player turns toward the direction they walk' },

    { kind: 'section', label: 'Jump' },
    { kind: 'number', key: 'jumpHeight', label: 'Jump height', min: 0, max: 20, step: 0.1, unit: 'm' },
    { kind: 'number', key: 'gravity', label: 'Gravity', min: 1, max: 150, step: 1, unit: 'm/s²' },
    { kind: 'number', key: 'fallMultiplier', label: 'Fall multiplier', min: 1, max: 5, step: 0.1, hint: 'Extra gravity while falling, for a snappier landing' },
    { kind: 'number', key: 'jumpCut', label: 'Short-hop factor', min: 0, max: 1, step: 0.05, hint: 'Upward speed kept when releasing jump early. 1 = fixed jump height' },
    { kind: 'number', key: 'coyoteTime', label: 'Coyote time', min: 0, max: 0.5, step: 0.01, unit: 's', hint: 'Grace period to still jump after leaving a ledge' },
    { kind: 'number', key: 'jumpBuffer', label: 'Jump buffer', min: 0, max: 0.5, step: 0.01, unit: 's', hint: 'Jump pressed this early before landing still counts' },
    { kind: 'bool', key: 'doubleJump', label: 'Double jump', hint: 'Allows one more jump in mid-air' },
    { kind: 'bool', key: 'glide', label: 'Glide', hint: 'Let go of jump in the air, then hold it while falling to float down slowly' },
    { kind: 'number', key: 'glideFall', label: 'Glide fall speed', min: 0.2, max: 10, step: 0.2, unit: 'm/s' },

    { kind: 'section', label: 'Sounds' },
    sound('soundJump', 'Jump'),
    sound('soundDoubleJump', 'Double jump'),
    sound('soundLand', 'Landing'),

    { kind: 'section', label: 'Camera' },
    {
      kind: 'select',
      key: 'cameraMode',
      label: 'Mode',
      options: [
        { value: 'chase', label: 'Behind the player' },
        { value: 'free', label: 'Free orbit' },
      ],
      hint: 'Behind the player: the camera always stays at their back and turns with them. Free orbit: you steer the camera with the mouse and move relative to it.',
    },
    { kind: 'number', key: 'cameraDistance', label: 'Distance', min: 1, max: 30, step: 0.5, unit: 'm' },
    { kind: 'number', key: 'cameraHeight', label: 'Height offset', min: -2, max: 6, step: 0.1, unit: 'm' },
    { kind: 'number', key: 'cameraFov', label: 'Field of view', min: 30, max: 110, step: 1, unit: '°' },
  ];
}

export const BLOCK_FIELDS: Field[] = [
  { kind: 'text', key: 'name', label: 'Name' },
  { kind: 'vec3', key: 'position', label: 'Position', step: 0.5, unit: 'm' },
  { kind: 'vec3', key: 'rotation', label: 'Rotation', step: 15, unit: '°' },
  { kind: 'vec3', key: 'size', label: 'Size', step: 0.5, unit: 'm', hint: 'Bounding size of the shape; changing it scales the vertices' },
  { kind: 'color', key: 'color', label: 'Tint', hint: 'Multiplies the texture color. White = no tint' },
  { kind: 'number', key: 'opacity', label: 'Opacity', min: 0.05, max: 1, step: 0.05, hint: '1 = solid color. Lower is see-through: glass, water, a ghost. See-through shapes cast no shadow.' },
  { kind: 'bool', key: 'liquid', label: 'Water (swim)', hint: 'A body of water: the player swims inside this shape. Make it not Solid. The picture flows slowly.' },
  { kind: 'bool', key: 'smooth', label: 'Smooth shading', hint: 'Shade round shapes as one smooth surface. Sharp edges (more than 60 degrees) stay sharp' },
  { kind: 'bool', key: 'doubleSided', label: 'Both sides', hint: 'Draw the faces from the front and from the back. Needed for planes such as grass; transparent texture pixels are always cut out' },
  { kind: 'bool', key: 'collide', label: 'Solid', hint: 'Solid blocks stop the player and the camera. Plain boxes are exact; ramps, rocks and rotated blocks are collided as their real surface, and the player walks up slopes below its Max slope' },
];
