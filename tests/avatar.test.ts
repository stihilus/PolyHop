import { describe, expect, it } from 'vitest';
import { IDLE_MOTION, chooseAnimation } from '../src/runtime/avatar';

const player = { walkSpeed: 4, runSpeed: 7, crouchSpeed: 2 };
const motion = (over: Partial<typeof IDLE_MOTION>) => ({ ...IDLE_MOTION, ...over });

describe('chooseAnimation', () => {
  it('idles when standing still', () => {
    expect(chooseAnimation(IDLE_MOTION, player).clip).toBe('idle');
    expect(chooseAnimation(motion({ speed: 0.1 }), player).clip).toBe('idle');
  });

  it('walks, then runs above the middle of the two speeds', () => {
    expect(chooseAnimation(motion({ speed: 4 }), player).clip).toBe('walk');
    expect(chooseAnimation(motion({ speed: 5.4 }), player).clip).toBe('walk');
    expect(chooseAnimation(motion({ speed: 5.6 }), player).clip).toBe('run');
    expect(chooseAnimation(motion({ speed: 7 }), player).clip).toBe('run');
  });

  it('plays the stride faster when the player is faster, within limits', () => {
    expect(chooseAnimation(motion({ speed: 2 }), player).rate).toBeCloseTo(0.5);
    expect(chooseAnimation(motion({ speed: 4 }), player).rate).toBeCloseTo(1);
    expect(chooseAnimation(motion({ speed: 20 }), player).rate).toBeLessThanOrEqual(1.6);
    expect(chooseAnimation(motion({ speed: 0.3 }), { ...player, walkSpeed: 100 }).rate).toBeGreaterThanOrEqual(0.5);
  });

  it('jumps while rising and falls otherwise', () => {
    expect(chooseAnimation(motion({ grounded: false, vy: 5 }), player).clip).toBe('jump');
    expect(chooseAnimation(motion({ grounded: false, vy: -3 }), player).clip).toBe('fall');
    // in the air beats everything else, even a fast run
    expect(chooseAnimation(motion({ grounded: false, speed: 7, vy: 0 }), player).clip).toBe('fall');
  });

  it('crouches, and crouch-walks when moving', () => {
    expect(chooseAnimation(motion({ crouching: true }), player).clip).toBe('crouch');
    expect(chooseAnimation(motion({ crouching: true, speed: 2 }), player).clip).toBe('crouch_walk');
    expect(chooseAnimation(motion({ crouching: true, speed: 2 }), player).rate).toBeCloseTo(1);
  });
});
