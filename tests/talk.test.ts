import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Action, DEFAULT_TEXT_SPEED, normalizeRules, runActions, VariableStore } from '../src/core/logic';
import { boxMesh } from '../src/core/mesh';
import { pruneForExport } from '../src/core/exportProject';
import { SOUND_IDS, TALK_VOICES, builtInSound } from '../src/core/sounds';
import { renderSfx, SFX_SAMPLE_RATE } from '../src/core/sfx';
import {
  type LevelBlock,
  type Project,
  createBlock,
  createDefaultProject,
  createLevelData,
  ensurePresetAssets,
  newId,
  normalizeProject,
} from '../src/core/types';
import { AudioEngine } from '../src/runtime/audio';
import { Game } from '../src/runtime/game';
import { TextureLibrary } from '../src/runtime/textures';
import { Typewriter, VoiceBlips, isVoiced } from '../src/runtime/typewriter';

describe('typewriter', () => {
  it('shows the letters at the speed given', () => {
    const t = new Typewriter('Hello', 10);
    expect(t.visible).toBe('');
    expect(t.update(0.05)).toBe('');
    expect(t.update(0.06)).toBe('H');
    expect(t.update(0.2)).toBe('el');
    expect(t.visible).toBe('Hel');
    t.update(1);
    expect(t.done).toBe(true);
    expect(t.visible).toBe('Hello');
    expect(t.update(1)).toBe('');
  });

  it('speed 0 is a line shown at once', () => {
    const t = new Typewriter('Quick!', 0);
    expect(t.done).toBe(true);
    expect(t.visible).toBe('Quick!');
  });

  it('waits a little at the end of a sentence', () => {
    const slow = new Typewriter('A. B', 100);
    // 'A' and '.' appear fast, then the full stop makes the text wait before ' B'
    expect(slow.update(0.03)).toBe('A.');
    expect(slow.update(0.1)).toBe('');
    expect(slow.update(0.4)).toBe(' B');
    const plain = new Typewriter('A  B', 100);
    expect(plain.update(0.05)).toBe('A  B');
  });

  it('finish shows everything', () => {
    const t = new Typewriter('Something long to read', 5);
    t.update(0.5);
    t.finish();
    expect(t.done).toBe(true);
    expect(t.visible).toBe('Something long to read');
  });

  it('a big step in time still gives every letter once', () => {
    const t = new Typewriter('One two three', 30);
    const got = t.update(0.4) + t.update(0.4) + t.update(5);
    expect(got).toBe('One two three');
  });
});

describe('voice blips', () => {
  it('only letters and digits make a sound', () => {
    expect(isVoiced('a')).toBe(true);
    expect(isVoiced('7')).toBe(true);
    expect(isVoiced('č')).toBe(true);
    expect(isVoiced(' ')).toBe(false);
    expect(isVoiced('.')).toBe(false);
  });

  it('every other letter at the usual speed, and the pitch moves around the voice pitch', () => {
    const b = new VoiceBlips(DEFAULT_TEXT_SPEED, 1.5, () => 0.5);
    const rates = b.rates('Hello, you');
    // 8 letters -> a sound for every 2nd one
    expect(rates).toHaveLength(4);
    for (const r of rates) expect(r).toBeCloseTo(1.5, 6);
    const wild = new VoiceBlips(DEFAULT_TEXT_SPEED, 1, () => 1);
    for (const r of wild.rates('aaaa')) expect(r).toBeCloseTo(1.14, 6);
    const low = new VoiceBlips(DEFAULT_TEXT_SPEED, 1, () => 0);
    for (const r of low.rates('aaaa')) expect(r).toBeCloseTo(0.86, 6);
  });

  it('faster text sounds on fewer letters, slow text on every letter', () => {
    expect(new VoiceBlips(12, 1, () => 0.5).rates('abcdef')).toHaveLength(6);
    expect(new VoiceBlips(60, 1, () => 0.5).rates('abcdefgh')).toHaveLength(2);
  });

  it('keeps counting across the pieces of a line', () => {
    const b = new VoiceBlips(30, 1, () => 0.5);
    const n = b.rates('a').length + b.rates('b').length + b.rates('c').length + b.rates('d').length;
    expect(n).toBe(2);
  });
});

describe('the voices as sounds', () => {
  it('are built in, short, and not silent', () => {
    expect(TALK_VOICES).toContain(SOUND_IDS.talk);
    for (const id of TALK_VOICES) {
      const s = builtInSound(id)!;
      expect(s.kind).toBe('sfx');
      const samples = renderSfx(s.sfx!, SFX_SAMPLE_RATE, s.seed);
      const seconds = samples.length / SFX_SAMPLE_RATE;
      expect(seconds).toBeGreaterThan(0.03);
      expect(seconds).toBeLessThan(0.25);
      expect(Math.max(...samples.map(Math.abs))).toBeGreaterThan(0.05);
    }
  });

  it('are in a new project and the audio engine has them even when a project lacks them', () => {
    const ids = createDefaultProject().sounds.map((s) => s.id);
    for (const id of TALK_VOICES) expect(ids).toContain(id);
    const engine = new AudioEngine();
    engine.setSounds([], 0.8);
    // no sounds in the project: playing a voice must not throw (there is no audio device in a test)
    expect(() => engine.play(SOUND_IDS.talk, 1.1)).not.toThrow();
  });

  it('the villager preset brings its voice', () => {
    const p = normalizeProject({ version: 9, models: [], variables: [], sounds: [] });
    ensurePresetAssets(p, 'npc');
    expect(p.sounds.map((s) => s.id)).toContain(SOUND_IDS.talk);
  });
});

describe('dialogue data', () => {
  it('keeps a voice, a pitch and a speed, and leaves the defaults out', () => {
    const [r] = normalizeRules(
      [
        {
          event: 'interact',
          actions: [
            { type: 'dialogue', speaker: 'A', lines: ['x'], voice: SOUND_IDS.talkDeep, pitch: 9, speed: 50 },
            { type: 'dialogue', speaker: 'B', lines: ['x'], voice: '', pitch: 1, speed: DEFAULT_TEXT_SPEED },
            { type: 'dialogue', speaker: 'C', lines: ['x'], voice: 'none', speed: -4, pitch: 0.1 },
          ],
        },
      ],
      newId,
    );
    const [a, b, c] = r!.actions as Extract<Action, { type: 'dialogue' }>[];
    expect(a).toMatchObject({ voice: SOUND_IDS.talkDeep, pitch: 2, speed: 50 });
    expect('voice' in b! || 'pitch' in b! || 'speed' in b!).toBe(false);
    expect(c).toMatchObject({ voice: 'none', pitch: 0.5, speed: 0 });
  });

  it('runActions hands them to the game', () => {
    const effects = runActions([{ type: 'dialogue', speaker: 'Ana', lines: ['Hi'], voice: SOUND_IDS.talkSoft, pitch: 1.2, speed: 20 }], new VariableStore([]));
    expect(effects[0]).toMatchObject({ type: 'dialogue', voice: SOUND_IDS.talkSoft, pitch: 1.2, speed: 20 });
  });

  it('an export keeps the voices a game uses', () => {
    const p = createDefaultProject();
    const b = createBlock('Npc', [0, 0, 0], boxMesh([1, 1, 1]), null);
    b.rules = [
      {
        id: 'r1',
        event: 'interact',
        conditions: [],
        actions: [
          { type: 'dialogue', speaker: 'A', lines: ['x'] },
          { type: 'dialogue', speaker: 'B', lines: ['y'], voice: SOUND_IDS.talkDeep },
          { type: 'dialogue', speaker: 'C', lines: ['z'], voice: 'none' },
        ],
      },
    ];
    p.levels[0]!.objects = [b];
    const ids = new Set(pruneForExport(p).sounds.map((s) => s.id));
    expect(ids.has(SOUND_IDS.talk)).toBe(true);
    expect(ids.has(SOUND_IDS.talkDeep)).toBe(true);
    expect(ids.has(SOUND_IDS.talkSoft)).toBe(false);
    expect(ids.has(SOUND_IDS.talkChirp)).toBe(false);
  });
});

// ---- in the game

beforeAll(() => {
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('document', { pointerLockElement: null, exitPointerLock() {} });
  vi.stubGlobal('navigator', { getGamepads: () => [] });
});
afterAll(() => vi.unstubAllGlobals());

const rule = (actions: Action[]) => ({ id: newId(), event: 'start' as const, conditions: [], actions });

function game(actions: Action[]): Game {
  const npc: LevelBlock = createBlock('Npc', [0, 0.9, 3], boxMesh([0.6, 1.8, 0.6]), null);
  npc.collide = false;
  npc.rules = [rule(actions)];
  const floor = createBlock('Ground', [0, -0.5, 0], boxMesh([100, 1, 100]), null);
  const p: Project = createDefaultProject();
  p.player.modelId = null;
  p.player.cameraMode = 'free';
  p.settings.music = null;
  p.player.soundJump = p.player.soundDoubleJump = p.player.soundLand = null;
  p.levels = [createLevelData('A', [floor, npc], [0, 0.05, 0], 0)];
  const canvas = { parentElement: null, addEventListener() {}, removeEventListener() {} } as unknown as HTMLElement;
  const g = new Game(new THREE.Scene(), new THREE.PerspectiveCamera(), canvas, new TextureLibrary(), p);
  g.startPlay(0);
  return g;
}
const run = (g: Game, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) g.update(1 / 60);
};

describe('a conversation in the game', () => {
  it('types the line, with a sound for some of the letters', () => {
    const g = game([{ type: 'dialogue', speaker: 'Ana', lines: ['Hello there, friend'] }]);
    const play = vi.spyOn(g.audio, 'play');
    expect(g.isTalking).toBe(true);
    expect(g.isTyping).toBe(true);
    run(g, 0.2);
    expect(play).toHaveBeenCalled();
    for (const [id, rate] of play.mock.calls) {
      expect(id).toBe(SOUND_IDS.talk);
      expect(rate!).toBeGreaterThan(0.8);
      expect(rate!).toBeLessThan(1.2);
    }
    run(g, 2);
    expect(g.isTyping).toBe(false);
    // 15 letters, every second one
    expect(play.mock.calls.length).toBe(8);
  });

  it('a press shows the whole line without the sounds', () => {
    const g = game([{ type: 'dialogue', speaker: 'Ana', lines: ['A long line that would take a while to appear'] }]);
    const play = vi.spyOn(g.audio, 'play');
    run(g, 0.1);
    const before = play.mock.calls.length;
    g.advanceTalk();
    expect(g.isTyping).toBe(false);
    run(g, 1);
    expect(play.mock.calls.length).toBe(before);
    expect(g.isTalking).toBe(true);
  });

  it('uses the voice, pitch and speed of the character, and can be silent', () => {
    const deep = game([{ type: 'dialogue', speaker: 'Old', lines: ['aaaaaaaa'], voice: SOUND_IDS.talkDeep, pitch: 0.6, speed: 15 }]);
    const playDeep = vi.spyOn(deep.audio, 'play');
    run(deep, 1);
    expect(playDeep.mock.calls.length).toBe(8); // slow text: a sound for every letter
    for (const [id, rate] of playDeep.mock.calls) {
      expect(id).toBe(SOUND_IDS.talkDeep);
      expect(rate!).toBeLessThan(0.75);
    }
    const mute = game([{ type: 'dialogue', speaker: 'Statue', lines: ['aaaaaaaa'], voice: 'none' }]);
    const playMute = vi.spyOn(mute.audio, 'play');
    run(mute, 1);
    expect(playMute).not.toHaveBeenCalled();
    expect(mute.isTyping).toBe(false);
  });

  it('speed 0 shows the line at once', () => {
    const g = game([{ type: 'dialogue', speaker: 'Ana', lines: ['Right away'], speed: 0 }]);
    expect(g.isTyping).toBe(false);
  });

  it('a question has a speaker and a voice too, and the first key press shows it', () => {
    const q = game([
      { type: 'choice', speaker: 'Ana', question: 'Do you like the sound of it?', options: [{ label: 'Yes', actions: [] }], voice: SOUND_IDS.talkChirp },
    ]);
    const playQ = vi.spyOn(q.audio, 'play');
    expect(q.isTalking).toBe(true);
    expect(q.isTyping).toBe(true);
    run(q, 0.3);
    expect(playQ.mock.calls.length).toBeGreaterThan(0);
    for (const [id] of playQ.mock.calls) expect(id).toBe(SOUND_IDS.talkChirp);
    // pressing an answer key first shows the whole question; it still waits for an answer
    q.advanceTalk();
    expect(q.isTyping).toBe(false);
    expect(q.isTalking).toBe(true);
    q.chooseAnswer(0);
    expect(q.isTalking).toBe(false);
  });
});
