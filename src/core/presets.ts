// Ready-made pieces of game logic: what a coin, a key, an apple, a door, a checkpoint, a hazard, a goal and an exit do.
// A preset is only rules (and the variables they need); the object is made by the editor.

import type { Rule, Variable } from './logic';
import { SOUND_IDS } from './sounds';

export type PresetKind = 'coin' | 'key' | 'apple' | 'door' | 'checkpoint' | 'hazard' | 'goal' | 'exit' | 'platform' | 'sign' | 'enemy' | 'npc' | 'water';

export const PRESETS: { kind: PresetKind; label: string; hint: string }[] = [
  { kind: 'coin', label: 'Coin', hint: 'Touch it to get +1 coin' },
  { kind: 'key', label: 'Key', hint: 'Touch it to get a key' },
  { kind: 'apple', label: 'Apple', hint: 'Touch it to heal one heart' },
  { kind: 'door', label: 'Door', hint: 'Solid until the player touches it with a key' },
  { kind: 'checkpoint', label: 'Checkpoint', hint: 'Touch it to respawn here after a fall or a hit' },
  { kind: 'hazard', label: 'Hazard', hint: 'Touch it to lose a heart and go back to the checkpoint' },
  { kind: 'goal', label: 'Goal', hint: 'Touch it to win: the game stops with a “You win” screen' },
  { kind: 'exit', label: 'Exit', hint: 'Touch it to go on to the next level' },
  { kind: 'platform', label: 'Moving platform', hint: 'Slides back and forth; the player rides on it' },
  { kind: 'sign', label: 'Sign', hint: 'Say something when the player presses Interact next to it' },
  { kind: 'enemy', label: 'Slime', hint: 'Chases the player and hurts them; jump on it to get rid of it' },
  { kind: 'npc', label: 'Villager', hint: 'Talks when the player presses Interact next to it' },
  { kind: 'water', label: 'Water', hint: 'A pool: the player swims in it (jump swims up, crouch dives)' },
];

export const MAX_HEALTH = 3;

type VariableSpec = Omit<Variable, 'id'>;

const COINS: VariableSpec = { name: 'coins', initial: 0, min: 0, max: null, hud: true, icon: '🪙', label: 'Coins' };
const KEYS: VariableSpec = { name: 'keys', initial: 0, min: 0, max: null, hud: true, icon: '🔑', label: 'Keys' };
const HEALTH: VariableSpec = { name: 'health', initial: MAX_HEALTH, min: 0, max: MAX_HEALTH, hud: true, icon: '❤', label: 'Health' };

/** The variables a preset's rules use. */
export function presetVariables(kind: PresetKind): VariableSpec[] {
  switch (kind) {
    case 'coin':
      return [COINS];
    case 'key':
    case 'door':
      return [KEYS];
    case 'apple':
    case 'hazard':
    case 'enemy':
      return [HEALTH];
    case 'goal':
      return [COINS];
    case 'checkpoint':
    case 'exit':
    case 'platform':
    case 'sign':
    case 'npc':
    case 'water':
      return [];
  }
}

export function presetRules(kind: PresetKind, idGen: () => string): Rule[] {
  const rule = (r: Omit<Rule, 'id'>): Rule => ({ id: idGen(), ...r });
  switch (kind) {
    case 'coin':
      return [rule({ event: 'touch', conditions: [], actions: [{ type: 'add', variable: 'coins', value: 1 }, { type: 'sound', sound: SOUND_IDS.coin }, { type: 'destroy' }] })];
    case 'key':
      return [
        rule({
          event: 'touch',
          conditions: [],
          actions: [{ type: 'add', variable: 'keys', value: 1 }, { type: 'sound', sound: SOUND_IDS.key }, { type: 'message', text: 'You found a key!', seconds: 2 }, { type: 'destroy' }],
        }),
      ];
    case 'apple':
      return [
        rule({
          event: 'touch',
          conditions: [{ variable: 'health', op: '<', value: MAX_HEALTH }],
          actions: [{ type: 'add', variable: 'health', value: 1 }, { type: 'sound', sound: SOUND_IDS.powerup }, { type: 'destroy' }],
        }),
      ];
    case 'door':
      // rules run in order and see each other's changes, so the "locked" rule goes first: once the
      // door has used the key, the key-less rule can no longer fire
      return [
        rule({
          event: 'touch',
          conditions: [{ variable: 'keys', op: '<', value: 1 }],
          actions: [{ type: 'message', text: 'It is locked. Find a key.', seconds: 2 }],
        }),
        rule({
          event: 'touch',
          conditions: [{ variable: 'keys', op: '>=', value: 1 }],
          actions: [{ type: 'add', variable: 'keys', value: -1 }, { type: 'sound', sound: SOUND_IDS.door }, { type: 'message', text: 'The door opens', seconds: 2 }, { type: 'move', target: '', offset: [0, 3, 0], seconds: 1 }],
        }),
      ];
    case 'checkpoint':
      return [rule({ event: 'touch', conditions: [], actions: [{ type: 'checkpoint' }, { type: 'sound', sound: SOUND_IDS.checkpoint }, { type: 'message', text: 'Checkpoint!', seconds: 1.5 }] })];
    case 'goal':
      return [
        rule({
          event: 'touch',
          conditions: [],
          actions: [{ type: 'sound', sound: SOUND_IDS.powerup }, { type: 'end', title: 'You win!', text: 'Coins: {coins}' }],
        }),
      ];
    case 'exit':
      return [rule({ event: 'touch', conditions: [], actions: [{ type: 'sound', sound: SOUND_IDS.checkpoint }, { type: 'level', level: '' }] })];
    case 'enemy':
      return [
        rule({ event: 'start', conditions: [], actions: [{ type: 'chase', target: '', speed: 2.4, range: 11 }] }),
        // landing on top of it: it is gone and the player bounces
        rule({
          event: 'stomp',
          conditions: [],
          actions: [{ type: 'sound', sound: SOUND_IDS.jump2 }, { type: 'bounce', strength: 10 }, { type: 'destroy' }],
        }),
        rule({
          event: 'touch',
          conditions: [],
          actions: [{ type: 'hurt', amount: 1, variable: 'health', knockback: 7 }, { type: 'sound', sound: SOUND_IDS.hit }],
        }),
        rule({
          event: 'when',
          conditions: [{ variable: 'health', op: '<=', value: 0 }],
          actions: [{ type: 'message', text: 'Game over. Starting again.', seconds: 2.5 }, { type: 'restart' }],
        }),
      ];
    case 'npc':
      return [
        rule({
          event: 'interact',
          conditions: [],
          actions: [
            {
              type: 'dialogue',
              speaker: 'Villager',
              lines: ['Hello, traveler!', 'Collect the coins, find the key and reach the trophy on top.'],
            },
          ],
        }),
      ];
    case 'water':
      return []; // it works by being a body of water, no rules needed
    case 'sign':
      return [rule({ event: 'interact', conditions: [], actions: [{ type: 'message', text: 'Hello! Change this text in Behavior.', seconds: 4 }] })];
    case 'platform':
      return [rule({ event: 'start', conditions: [], actions: [{ type: 'patrol', target: '', offset: [4, 0, 0], seconds: 3 }] })];
    case 'hazard':
      return [
        rule({
          event: 'touch',
          conditions: [],
          actions: [{ type: 'add', variable: 'health', value: -1 }, { type: 'sound', sound: SOUND_IDS.hit }, { type: 'message', text: 'Ouch!', seconds: 1.2 }, { type: 'respawn' }],
        }),
        rule({
          event: 'touch',
          conditions: [{ variable: 'health', op: '<=', value: 0 }],
          actions: [{ type: 'message', text: 'Game over. Starting again.', seconds: 2.5 }, { type: 'restart' }],
        }),
      ];
  }
}

/** Ids of the built-in sounds the rules of a preset play. */
export function presetSounds(kind: PresetKind): string[] {
  switch (kind) {
    case 'coin':
      return [SOUND_IDS.coin];
    case 'key':
      return [SOUND_IDS.key];
    case 'apple':
      return [SOUND_IDS.powerup];
    case 'door':
      return [SOUND_IDS.door];
    case 'checkpoint':
      return [SOUND_IDS.checkpoint];
    case 'hazard':
      return [SOUND_IDS.hit];
    case 'goal':
      return [SOUND_IDS.powerup];
    case 'exit':
      return [SOUND_IDS.checkpoint];
    case 'enemy':
      return [SOUND_IDS.jump2, SOUND_IDS.hit];
    case 'npc':
      return [SOUND_IDS.talk];
    case 'platform':
    case 'sign':
    case 'water':
      return [];
  }
}

/** Variables from `needed` that the list does not have yet, as new entries. */
export function missingVariables(existing: { name: string }[], needed: VariableSpec[], idGen: () => string): Variable[] {
  return needed.filter((n) => !existing.some((e) => e.name === n.name)).map((n) => ({ ...n, id: idGen() }));
}
