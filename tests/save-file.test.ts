/**
 * Tests de SaveFile. Los archivos usados acá son SINTÉTICOS: buffers chicos
 * de bytes de ejemplo escritos a un directorio temporal. NO son archivos
 * reales de PC Fútbol — solo prueban la mecánica de carga/escritura.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SaveFile } from '../src/core/save-file';

// Bytes de ejemplo, sin ningún significado del juego.
const CONTENIDO_SINTETICO = new Uint8Array([0x50, 0x43, 0x46, 0x00, 0x01, 0x02, 0x03, 0xff]);

let dirTemporal: string;
let rutaPartida: string;

beforeEach(async () => {
  dirTemporal = await mkdtemp(join(tmpdir(), 'pcf-test-'));
  rutaPartida = join(dirTemporal, 'MANAG000.SYNTH');
  await writeFile(rutaPartida, CONTENIDO_SINTETICO);
});

afterEach(async () => {
  await rm(dirTemporal, { recursive: true, force: true });
});

describe('SaveFile.load', () => {
  it('carga el contenido del archivo', async () => {
    const save = await SaveFile.load(rutaPartida);
    expect(save.size).toBe(CONTENIDO_SINTETICO.length);
    expect(Array.from(save.data)).toEqual(Array.from(CONTENIDO_SINTETICO));
  });

  it('falla con un mensaje claro si el archivo no existe', async () => {
    await expect(SaveFile.load(join(dirTemporal, 'no-existe.XXX'))).rejects.toThrow();
  });
});

describe('copia original y detección de cambios', () => {
  it('conserva el original intacto aunque se modifique data', async () => {
    const save = await SaveFile.load(rutaPartida);
    save.data[0] = 0xaa;
    expect(save.original()[0]).toBe(0x50);
    expect(save.fueModificado()).toBe(true);
  });

  it('fueModificado es false recién cargado', async () => {
    const save = await SaveFile.load(rutaPartida);
    expect(save.fueModificado()).toBe(false);
  });

  it('original() devuelve una copia: modificarla no afecta nada', async () => {
    const save = await SaveFile.load(rutaPartida);
    const copia = save.original();
    copia[0] = 0xee;
    expect(save.original()[0]).toBe(0x50);
    expect(save.data[0]).toBe(0x50);
  });
});

describe('SaveFile.write', () => {
  it('escribe a una ruta distinta sin problema', async () => {
    const save = await SaveFile.load(rutaPartida);
    save.data[0] = 0xaa;
    const rutaCopia = join(dirTemporal, 'copia.SYNTH');
    await save.write(rutaCopia);

    const escrito = new Uint8Array(await readFile(rutaCopia));
    expect(escrito[0]).toBe(0xaa);
    // El original en disco sigue intacto.
    const original = new Uint8Array(await readFile(rutaPartida));
    expect(original[0]).toBe(0x50);
  });

  it('se niega a pisar el archivo de origen sin confirmación', async () => {
    const save = await SaveFile.load(rutaPartida);
    await expect(save.write(rutaPartida)).rejects.toThrow(/sin confirmación/);
  });

  it('detecta el mismo archivo aunque cambie el casing de la ruta (Windows)', async () => {
    if (process.platform !== 'win32') return; // solo aplica a filesystems case-insensitive
    const save = await SaveFile.load(rutaPartida);
    await expect(save.write(rutaPartida.toUpperCase())).rejects.toThrow(/sin confirmación/);
  });

  it('pisa el origen solo con sobrescribirOriginal: true', async () => {
    const save = await SaveFile.load(rutaPartida);
    save.data[0] = 0xbb;
    await save.write(rutaPartida, { sobrescribirOriginal: true });
    const escrito = new Uint8Array(await readFile(rutaPartida));
    expect(escrito[0]).toBe(0xbb);
  });
});
