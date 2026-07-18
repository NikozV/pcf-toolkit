/**
 * Tests de lectura/edición de atributos de jugadores.
 *
 * Los unitarios usan un buffer SINTÉTICO que imita la estructura del registro
 * (nombre corto + largo con prefijo de largo + gap + bloques de atributos).
 * Al final, integración contra los fixtures reales (se saltean si no están),
 * con los valores confirmados de Dinov y Palermo.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { writeUint16LE, writeUint8 } from '../src/core/buffer';
import {
  ATRIBUTOS,
  buscarJugadores,
  detectarPlantel,
  escribirAtributos,
  leerAtributos,
} from '../src/core/jugador';

const GAP = 151;

/** Arma un buffer sintético con un jugador: nombre corto, largo y 2 bloques. */
function bufferConJugador(corto: string, largo: string, attrs: number[], en = 200): Uint8Array {
  const buf = new Uint8Array(4096);
  let off = en;
  // [len][corto]
  writeUint16LE(buf, off, corto.length); off += 2;
  for (const ch of corto) { buf[off++] = ch.charCodeAt(0) ^ 0x61; }
  // [len][largo]
  writeUint16LE(buf, off, largo.length); off += 2;
  for (const ch of largo) { buf[off++] = ch.charCodeAt(0) ^ 0x61; }
  // gap + bloque actual + 3 bytes + bloque próxima
  const attrOff = off + GAP;
  for (let i = 0; i < 10; i++) writeUint8(buf, attrOff + i, attrs[i]!);
  for (let i = 0; i < 10; i++) writeUint8(buf, attrOff + 13 + i, attrs[i]!);
  return buf;
}

const ATTRS_DEMO = [86, 85, 86, 85, 90, 90, 67, 87, 62, 17]; // estilo Palermo

describe('buscarJugadores (buffer sintético)', () => {
  it('encuentra el jugador y lee sus 10 atributos en orden', () => {
    const buf = bufferConJugador('Palermo', 'Martín PALERMO', ATTRS_DEMO);
    const encontrados = buscarJugadores(buf, 'Palermo');
    expect(encontrados).toHaveLength(1);
    const j = encontrados[0]!;
    expect(j.nombreCorto).toBe('Palermo');
    expect(j.nombreLargo).toBe('Martín PALERMO');
    expect(j.atributos.velocidad).toBe(86);
    expect(j.atributos.tiro).toBe(87);
    expect(j.atributos.arquero).toBe(17);
    expect(ATRIBUTOS.map((a) => j.atributos[a])).toEqual(ATTRS_DEMO);
  });

  it('es case-insensitive', () => {
    const buf = bufferConJugador('Palermo', 'Martín PALERMO', ATTRS_DEMO);
    expect(buscarJugadores(buf, 'palermo')).toHaveLength(1);
    expect(buscarJugadores(buf, 'PALERMO')).toHaveLength(1);
  });

  it('no confunde con un texto que no tiene bloque de atributos válido', () => {
    // Nombre suelto con prefijo de largo pero sin bloque válido después (ceros)
    const buf = new Uint8Array(1024);
    writeUint16LE(buf, 100, 7);
    for (let i = 0; i < 7; i++) buf[102 + i] = 'Palermo'.charCodeAt(i) ^ 0x61;
    // el gap cae en zona de ceros → bloque inválido (0 < 1)
    expect(buscarJugadores(buf, 'Palermo')).toHaveLength(0);
  });

  it('rechaza nombre vacío', () => {
    expect(() => buscarJugadores(new Uint8Array(10), '')).toThrow();
  });
});

describe('escribirAtributos', () => {
  it('cambia atributos en AMBAS temporadas', () => {
    const buf = bufferConJugador('Palermo', 'Martín PALERMO', ATTRS_DEMO);
    const j = buscarJugadores(buf, 'Palermo')[0]!;
    escribirAtributos(buf, j.offsetAtributos, { velocidad: 99, arquero: 50 });
    // temporada actual
    const actual = leerAtributos(buf, j.offsetAtributos);
    expect(actual.velocidad).toBe(99);
    expect(actual.arquero).toBe(50);
    expect(actual.remate).toBe(90); // sin tocar
    // próxima temporada (a +13)
    const proxima = leerAtributos(buf, j.offsetAtributos + 13);
    expect(proxima.velocidad).toBe(99);
    expect(proxima.arquero).toBe(50);
  });

  it('rechaza valores fuera de 1..99', () => {
    const buf = bufferConJugador('Palermo', 'Martín PALERMO', ATTRS_DEMO);
    const j = buscarJugadores(buf, 'Palermo')[0]!;
    expect(() => escribirAtributos(buf, j.offsetAtributos, { velocidad: 100 })).toThrow(RangeError);
    expect(() => escribirAtributos(buf, j.offsetAtributos, { velocidad: 0 })).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Integración contra fixtures reales
// ---------------------------------------------------------------------------

const FIXTURE = 'fixtures/manag003-semana4.000';

describe.skipIf(!existsSync(FIXTURE))('integración: fichas reales', () => {
  it('lee los atributos de Dinov (arquero) confirmados contra pantalla', async () => {
    const buf = new Uint8Array(await readFile(FIXTURE));
    const j = buscarJugadores(buf, 'Dinov');
    expect(j).toHaveLength(1);
    const a = j[0]!.atributos;
    expect(a.velocidad).toBe(51);
    expect(a.resistencia).toBe(61);
    expect(a.calidad).toBe(66);
    expect(a.pase).toBe(71);
    expect(a.entradas).toBe(70);
  });

  it('lee los atributos de Palermo (delantero) confirmados contra pantalla', async () => {
    const buf = new Uint8Array(await readFile(FIXTURE));
    const j = buscarJugadores(buf, 'Palermo');
    expect(j).toHaveLength(1);
    const a = j[0]!.atributos;
    expect(a.velocidad).toBe(86);
    expect(a.regate).toBe(90);
    expect(a.remate).toBe(90);
    expect(a.arquero).toBe(17); // delantero: valor guardado == mostrado
  });
});

// El plantel se detecta sobre el save de ene-2000 (cuando ya está poblado).
const FIXTURE_PLANTEL = 'fixtures/manag003-ene2000.000';

describe.skipIf(!existsSync(FIXTURE_PLANTEL))('integración: detección del plantel', () => {
  it('detecta el plantel de San Martín y contiene a los jugadores conocidos', async () => {
    const buf = new Uint8Array(await readFile(FIXTURE_PLANTEL));
    const plantel = detectarPlantel(buf);
    // ~25 jugadores en el bloque contiguo del club del usuario
    expect(plantel.length).toBeGreaterThanOrEqual(15);
    expect(plantel.length).toBeLessThanOrEqual(45);
    const nombres = plantel.map((j) => j.nombreCorto.toLowerCase());
    for (const esperado of ['palermo', 'dinov', 'scaloni', 'irigoytía', 'griffin']) {
      expect(nombres).toContain(esperado);
    }
    // Cada jugador trae sus 10 atributos en rango
    for (const j of plantel) {
      for (const a of ATRIBUTOS) {
        expect(j.atributos[a]).toBeGreaterThanOrEqual(1);
        expect(j.atributos[a]).toBeLessThanOrEqual(99);
      }
    }
  });
});
