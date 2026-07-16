/**
 * Tests de localización/edición de caja.
 *
 * Los tests unitarios usan buffers SINTÉTICOS (bytes de ejemplo, no partidas
 * reales). Al final hay tests de integración contra los fixtures reales de
 * PCF6, que se saltean automáticamente si los fixtures no están (no se
 * versionan porque son archivos del usuario).
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { writeFloat64LE, readFloat64LE } from '../src/core/buffer';
import {
  escribirCaja,
  localizarCaja,
  PESETAS_POR_PESO,
  pesosAPesetas,
  TECHO_PESETAS,
  TECHO_PESOS,
} from '../src/core/caja';
import { sugerirCaja } from '../src/advisor/suggestions';

// Valor real observado en el fixture de semana 3 (615.886 $ mostrados)
const CAJA_REAL = 92_382_902.44766913;

/** Buffer sintético con la caja plantada en 3 copias, como en un save real. */
function bufferSintetico(): Uint8Array {
  const buf = new Uint8Array(2048); // ceros: doubles = 0, fuera de toda ventana
  writeFloat64LE(buf, 100, CAJA_REAL);
  writeFloat64LE(buf, 900, CAJA_REAL);
  writeFloat64LE(buf, 1700, CAJA_REAL);
  return buf;
}

describe('localizarCaja (buffers sintéticos)', () => {
  it('encuentra las 3 copias a partir del valor mostrado truncado', () => {
    const caja = localizarCaja(bufferSintetico(), 615_886);
    expect(caja.offsets).toEqual([100, 900, 1700]);
    expect(caja.pesetas).toBeCloseTo(CAJA_REAL, 5);
    expect(caja.pesos).toBe(615_886);
  });

  it('tira error claro si el valor no está', () => {
    expect(() => localizarCaja(bufferSintetico(), 123_456)).toThrow(/No encontré/);
  });

  it('ignora un valor en OTRA ventana de pesos', () => {
    const buf = bufferSintetico();
    writeFloat64LE(buf, 500, (615_887 + 0.5) * PESETAS_POR_PESO); // un peso más arriba
    const caja = localizarCaja(buf, 615_886);
    expect(caja.offsets).toEqual([100, 900, 1700]);
  });

  it('con un colisionador en la misma ventana, gana el patrón con copias', () => {
    const buf = bufferSintetico();
    // Otro valor distinto que cae en la misma ventana de 150 pta, una sola vez
    writeFloat64LE(buf, 500, CAJA_REAL + 3);
    const caja = localizarCaja(buf, 615_886);
    expect(caja.offsets).toEqual([100, 900, 1700]);
  });

  it('tira error si hay DOS patrones con copias en la misma ventana', () => {
    const buf = bufferSintetico();
    writeFloat64LE(buf, 400, CAJA_REAL + 3);
    writeFloat64LE(buf, 500, CAJA_REAL + 3);
    expect(() => localizarCaja(buf, 615_886)).toThrow(/Ambiguo/);
  });

  it('acepta un único hit si no hay ambigüedad', () => {
    const buf = new Uint8Array(64);
    writeFloat64LE(buf, 8, CAJA_REAL);
    const caja = localizarCaja(buf, 615_886);
    expect(caja.offsets).toEqual([8]);
  });

  it('rechaza pesos no enteros o negativos', () => {
    expect(() => localizarCaja(bufferSintetico(), -1)).toThrow(RangeError);
    expect(() => localizarCaja(bufferSintetico(), 1.5)).toThrow(RangeError);
  });
});

describe('escribirCaja', () => {
  it('actualiza todas las copias', () => {
    const buf = bufferSintetico();
    const nueva = pesosAPesetas(7_000_000);
    escribirCaja(buf, [100, 900, 1700], nueva);
    for (const offset of [100, 900, 1700]) {
      expect(readFloat64LE(buf, offset)).toBe(nueva);
    }
    // Y se puede volver a localizar con el valor nuevo
    expect(localizarCaja(buf, 7_000_000).offsets).toEqual([100, 900, 1700]);
  });

  it('rechaza valores sobre el techo de overflow', () => {
    const buf = bufferSintetico();
    expect(() => escribirCaja(buf, [100], TECHO_PESETAS + 1)).toThrow(/techo/);
  });

  it('rechaza valores no positivos y lista de offsets vacía', () => {
    const buf = bufferSintetico();
    expect(() => escribirCaja(buf, [100], 0)).toThrow(RangeError);
    expect(() => escribirCaja(buf, [100], -5)).toThrow(RangeError);
    expect(() => escribirCaja(buf, [], 1000)).toThrow(/offsets/);
  });
});

describe('sugerirCaja (advisor)', () => {
  it('devuelve 3 opciones crecientes, todas bajo el techo', () => {
    const opciones = sugerirCaja(615_886);
    expect(opciones).toHaveLength(3);
    for (const opcion of opciones) {
      expect(opcion.pesos).toBeLessThanOrEqual(TECHO_PESOS);
      expect(opcion.pesetas).toBe(opcion.pesos * PESETAS_POR_PESO);
      expect(opcion.explicacion.length).toBeGreaterThan(10);
    }
    expect(opciones[0]!.pesos).toBeLessThan(opciones[1]!.pesos);
    expect(opciones[1]!.pesos).toBeLessThan(opciones[2]!.pesos);
  });

  it('la opción discreta escala con la caja actual pero tiene piso y techo', () => {
    expect(sugerirCaja(10_000)[0]!.pesos).toBe(1_000_000); // piso
    expect(sugerirCaja(10_000_000)[0]!.pesos).toBe(2_000_000); // techo de la discreta
  });
});

// ---------------------------------------------------------------------------
// Integración contra fixtures REALES (se saltean si no están)
// ---------------------------------------------------------------------------

const FIXTURE_SEMANA3 = 'fixtures/manag003-inicial.000';
const FIXTURE_SEMANA4 = 'fixtures/manag003-semana4.000';

describe.skipIf(!existsSync(FIXTURE_SEMANA3))('integración: fixture real semana 3', () => {
  it('localiza la caja confirmada (615.886 $ en 3 copias)', async () => {
    const buf = new Uint8Array(await readFile(FIXTURE_SEMANA3));
    const caja = localizarCaja(buf, 615_886);
    expect(caja.offsets).toHaveLength(3);
    expect(caja.pesetas).toBeCloseTo(92_382_902.4477, 3);
  });
});

describe.skipIf(!existsSync(FIXTURE_SEMANA4))('integración: fixture real semana 4', () => {
  it('localiza la caja confirmada (755.149 $ en 3 copias)', async () => {
    const buf = new Uint8Array(await readFile(FIXTURE_SEMANA4));
    const caja = localizarCaja(buf, 755_149);
    expect(caja.offsets).toHaveLength(3);
    expect(caja.pesetas).toBeCloseTo(113_272_386.211, 2);
  });
});
