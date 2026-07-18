/**
 * Tests del editor de estadio. Unitarios con buffer sintético + integración
 * contra los fixtures reales (se saltean si no están).
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readInt32LE } from '../src/core/buffer';
import { CAPACIDAD_MAX, escribirCapacidad } from '../src/core/estadio';

describe('escribirCapacidad', () => {
  it('escribe la capacidad como int32 LE', () => {
    const buf = new Uint8Array(8);
    escribirCapacidad(buf, 2, 45000);
    expect(readInt32LE(buf, 2)).toBe(45000);
  });

  it('rechaza valores fuera del rango prudente', () => {
    const buf = new Uint8Array(8);
    expect(() => escribirCapacidad(buf, 0, 0)).toThrow(RangeError);
    expect(() => escribirCapacidad(buf, 0, CAPACIDAD_MAX + 1)).toThrow(RangeError);
    expect(() => escribirCapacidad(buf, 0, 100)).toThrow(RangeError); // < mínimo
  });
});

// ---------------------------------------------------------------------------
// Integración contra fixtures reales
// ---------------------------------------------------------------------------

const F_1998 = 'fixtures/manag003-semana4.000';
const F_2000 = 'fixtures/manag003-ene2000.000';

describe.skipIf(!existsSync(F_1998))('integración: estadio (ago 1998, capacidad 20.000)', () => {
  it('detecta San Martín con capacidad 20.000', async () => {
    const { detectarEstadio } = await import('../src/core/estadio');
    const buf = new Uint8Array(await readFile(F_1998));
    const e = detectarEstadio(buf)!;
    expect(e.nombreClub).toContain('San Mart');
    expect(e.capacidad).toBe(20000);
  });
});

describe.skipIf(!existsSync(F_2000))('integración: estadio (ene 2000, capacidad 32.000)', () => {
  it('detecta San Martín con capacidad 32.000 y permite editarla', async () => {
    const { detectarEstadio } = await import('../src/core/estadio');
    const buf = new Uint8Array(await readFile(F_2000));
    const e = detectarEstadio(buf)!;
    expect(e.nombreClub).toContain('San Mart');
    expect(e.capacidad).toBe(32000);
    // Editar en memoria y releer
    escribirCapacidad(buf, e.offsetCapacidad, 80000);
    const e2 = detectarEstadio(buf)!;
    expect(e2.capacidad).toBe(80000);
  });
});
