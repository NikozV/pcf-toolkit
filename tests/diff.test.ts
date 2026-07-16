/**
 * Tests del diff byte a byte. Todos los buffers y archivos usados acá son
 * SINTÉTICOS (bytes de ejemplo), NO partidas reales de PC Fútbol. Cuando
 * tengamos fixtures reales (par antes/después de una operación en el juego),
 * se agregan tests de integración aparte en fixtures/.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diffBuffers, diffSaves } from '../src/reverse-engineering/diff';

describe('diffBuffers', () => {
  it('buffers idénticos: sin rangos', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const resultado = diffBuffers(a, a.slice());
    expect(resultado.rangos).toEqual([]);
    expect(resultado.totalBytesDistintos).toBe(0);
  });

  it('un solo byte distinto: un rango de longitud 1', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 9, 4]);
    const { rangos } = diffBuffers(a, b);
    expect(rangos).toHaveLength(1);
    expect(rangos[0]).toMatchObject({ inicio: 2, longitud: 1 });
    expect(Array.from(rangos[0]!.bytesA)).toEqual([3]);
    expect(Array.from(rangos[0]!.bytesB)).toEqual([9]);
  });

  it('bytes consecutivos distintos se agrupan en un solo rango', () => {
    // Simula el caso típico: un uint32 LE que cambió entero (4 bytes seguidos).
    const a = new Uint8Array([0, 0x78, 0x56, 0x34, 0x12, 0]);
    const b = new Uint8Array([0, 0xff, 0xff, 0xff, 0x7f, 0]);
    const { rangos } = diffBuffers(a, b);
    expect(rangos).toHaveLength(1);
    expect(rangos[0]).toMatchObject({ inicio: 1, longitud: 4 });
  });

  it('rangos separados por bytes iguales se reportan por separado', () => {
    const a = new Uint8Array([1, 1, 1, 1, 1, 1, 1]);
    const b = new Uint8Array([9, 9, 1, 1, 9, 1, 9]);
    const { rangos, totalBytesDistintos } = diffBuffers(a, b);
    expect(rangos.map((r) => [r.inicio, r.longitud])).toEqual([
      [0, 2],
      [4, 1],
      [6, 1],
    ]);
    expect(totalBytesDistintos).toBe(4);
  });

  it('un rango que termina en el último byte se cierra bien', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 9]);
    const { rangos } = diffBuffers(a, b);
    expect(rangos.map((r) => [r.inicio, r.longitud])).toEqual([[2, 1]]);
  });

  it('tamaños distintos: la cola sobrante se reporta como rango', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3, 7, 8]);
    const { rangos, tamanoA, tamanoB } = diffBuffers(a, b);
    expect(tamanoA).toBe(3);
    expect(tamanoB).toBe(5);
    expect(rangos).toHaveLength(1);
    expect(rangos[0]).toMatchObject({ inicio: 3, longitud: 2 });
    expect(Array.from(rangos[0]!.bytesA)).toEqual([]); // A no tiene esos bytes
    expect(Array.from(rangos[0]!.bytesB)).toEqual([7, 8]);
  });

  it('tamaños distintos con diferencia pegada al final: se fusiona con la cola', () => {
    const a = new Uint8Array([1, 2, 9]);
    const b = new Uint8Array([1, 2, 3, 7]);
    const { rangos } = diffBuffers(a, b);
    expect(rangos).toHaveLength(1);
    expect(rangos[0]).toMatchObject({ inicio: 2, longitud: 2 });
    expect(Array.from(rangos[0]!.bytesA)).toEqual([9]);
    expect(Array.from(rangos[0]!.bytesB)).toEqual([3, 7]);
  });

  it('todos los bytes distintos: un único rango que cubre todo', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5, 6]);
    const { rangos } = diffBuffers(a, b);
    expect(rangos.map((r) => [r.inicio, r.longitud])).toEqual([[0, 3]]);
  });
});

describe('diffSaves (contra archivos en disco)', () => {
  let dirTemporal: string;

  beforeAll(async () => {
    dirTemporal = await mkdtemp(join(tmpdir(), 'pcf-diff-test-'));
  });

  afterAll(async () => {
    await rm(dirTemporal, { recursive: true, force: true });
  });

  it('compara dos archivos sintéticos', async () => {
    // Simula "antes/después de una operación": cambia un uint32 en el offset 4.
    const antes = new Uint8Array([0, 1, 2, 3, 0x00, 0xca, 0x9a, 0x3b, 9]); // 1_000_000_000 LE
    const despues = new Uint8Array([0, 1, 2, 3, 0x00, 0x28, 0x6b, 0x6e, 9]); // 1_852_516_352 LE
    const rutaAntes = join(dirTemporal, 'antes.SYNTH');
    const rutaDespues = join(dirTemporal, 'despues.SYNTH');
    await writeFile(rutaAntes, antes);
    await writeFile(rutaDespues, despues);

    const resultado = await diffSaves(rutaAntes, rutaDespues);
    expect(resultado.rangos.map((r) => [r.inicio, r.longitud])).toEqual([[5, 3]]);
    expect(resultado.tamanoA).toBe(9);
    expect(resultado.tamanoB).toBe(9);
  });

  it('falla con error legible si un archivo no existe', async () => {
    await expect(diffSaves(join(dirTemporal, 'nada.XXX'), join(dirTemporal, 'nada2.XXX'))).rejects.toThrow();
  });
});
