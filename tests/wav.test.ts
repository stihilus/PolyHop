import { describe, expect, it } from 'vitest';
import { encodeWav } from '../src/core/wav';

describe('encodeWav', () => {
  it('writes a 16-bit mono PCM file with the right header', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 22050);
    expect(wav.length).toBe(44 + 8);
    const text = (a: number, b: number) => String.fromCharCode(...wav.subarray(a, b));
    expect([text(0, 4), text(8, 12), text(12, 16), text(36, 40)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    const view = new DataView(wav.buffer);
    expect(view.getUint32(4, true)).toBe(36 + 8);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(22050);
    expect(view.getUint32(28, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
  });

  it('scales samples to the 16-bit range and clips what is out of it', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5, 2, -3]), 8000);
    const view = new DataView(wav.buffer);
    const at = (i: number) => view.getInt16(44 + i * 2, true);
    expect([at(0), at(1), at(2)]).toEqual([0, 32767, -32768]);
    expect(at(3)).toBe(16384);
    expect([at(4), at(5)]).toEqual([32767, -32768]);
  });

  it('is a valid empty file for no samples', () => {
    expect(encodeWav(new Float32Array(0), 44100).length).toBe(44);
  });
});
