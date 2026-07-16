/**
 * Tests de los helpers de double LE agregados para la caja de PCF6.
 * Buffers sintéticos, no archivos reales.
 */

import { describe, expect, it } from 'vitest';
import { readFloat64LE, writeFloat64LE } from '../src/core/buffer';

describe('float64 LE', () => {
  it('roundtrip exacto de valores reales del formato', () => {
    const buf = new Uint8Array(16);
    for (const valor of [0, 1.5, 92_382_902.44766913, 2_147_483_647, -1e10]) {
      writeFloat64LE(buf, 4, valor); // offset no alineado a 8: debe funcionar igual
      expect(readFloat64LE(buf, 4)).toBe(valor);
    }
  });

  it('lee en orden little-endian (bytes verificados a mano)', () => {
    // 1.0 como double LE = 00 00 00 00 00 00 F0 3F
    const buf = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f]);
    expect(readFloat64LE(buf, 0)).toBe(1);
  });

  it('funciona sobre un subarray con byteOffset distinto de cero', () => {
    const base = new Uint8Array(32);
    const vista = base.subarray(8);
    writeFloat64LE(vista, 0, 123.456);
    expect(readFloat64LE(vista, 0)).toBe(123.456);
    expect(readFloat64LE(base, 8)).toBe(123.456);
  });

  it('rechaza offsets fuera de rango y valores no finitos', () => {
    const buf = new Uint8Array(8);
    expect(() => readFloat64LE(buf, 1)).toThrow(RangeError);
    expect(() => writeFloat64LE(buf, 0, Number.NaN)).toThrow(RangeError);
    expect(() => writeFloat64LE(buf, 0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
