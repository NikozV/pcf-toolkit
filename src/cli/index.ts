/**
 * CLI del PCF Toolkit.
 *
 * Fase 1: solo `pcf diff`. Los comandos `info`, `set` y `suggest` llegan
 * cuando tengamos offsets confirmados contra partidas reales.
 */

import { Command } from 'commander';
import { diffSaves, type RangoDiff } from '../reverse-engineering/diff';
import { readInt32LE, readUint16LE, readUint32LE } from '../core/buffer';

const programa = new Command();

programa
  .name('pcf')
  .description('Toolkit para leer y editar partidas guardadas de PC Fútbol 5.0 / 6.0')
  .version('0.1.0');

function hex(bytes: Uint8Array, maxBytes: number): string {
  const mostrados = bytes.subarray(0, maxBytes);
  let texto = Array.from(mostrados, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  if (bytes.length > maxBytes) texto += ` … (+${bytes.length - maxBytes} bytes)`;
  if (bytes.length === 0) texto = '(sin bytes: el archivo termina antes)';
  return texto;
}

/**
 * Para rangos chicos (1, 2 o 4 bytes) muestra también el valor numérico LE:
 * es lo que más sirve para reconocer cantidades (plata, espectadores, etc.).
 */
function interpretacionNumerica(rango: RangoDiff): string | null {
  const { bytesA, bytesB, longitud } = rango;
  if (bytesA.length !== longitud || bytesB.length !== longitud) return null;
  if (longitud === 1) {
    return `uint8: ${bytesA[0]} → ${bytesB[0]}`;
  }
  if (longitud === 2) {
    return `uint16 LE: ${readUint16LE(bytesA, 0)} → ${readUint16LE(bytesB, 0)}`;
  }
  if (longitud === 4) {
    const uA = readUint32LE(bytesA, 0);
    const uB = readUint32LE(bytesB, 0);
    const sA = readInt32LE(bytesA, 0);
    const sB = readInt32LE(bytesB, 0);
    let texto = `uint32 LE: ${uA} → ${uB}`;
    // Si la lectura con signo difiere de la sin signo, mostrar ambas.
    if (sA !== uA || sB !== uB) texto += ` | int32 LE: ${sA} → ${sB}`;
    return texto;
  }
  return null;
}

programa
  .command('diff')
  .description('Compara dos archivos de partida byte a byte y lista los offsets que difieren')
  .argument('<antes>', 'archivo guardado ANTES de la operación en el juego')
  .argument('<despues>', 'archivo guardado DESPUÉS de la operación')
  .option('--max-bytes <n>', 'máximo de bytes a mostrar por rango', '16')
  .action(async (antes: string, despues: string, opciones: { maxBytes: string }) => {
    const maxBytes = Number.parseInt(opciones.maxBytes, 10);
    if (!Number.isInteger(maxBytes) || maxBytes < 1) {
      programa.error('--max-bytes tiene que ser un entero positivo');
    }

    const resultado = await diffSaves(antes, despues);

    console.log(`Antes:   ${antes} (${resultado.tamanoA} bytes)`);
    console.log(`Después: ${despues} (${resultado.tamanoB} bytes)`);
    if (resultado.tamanoA !== resultado.tamanoB) {
      console.log(
        '⚠ Los archivos tienen distinto tamaño: los offsets posteriores a una inserción/borrado pueden estar corridos.',
      );
    }
    console.log('');

    if (resultado.rangos.length === 0) {
      console.log('Los archivos son idénticos.');
      return;
    }

    console.log(
      `${resultado.rangos.length} rango(s) con diferencias, ${resultado.totalBytesDistintos} byte(s) en total:\n`,
    );

    for (const rango of resultado.rangos) {
      const offsetHex = '0x' + rango.inicio.toString(16).toUpperCase().padStart(6, '0');
      console.log(`— Offset ${offsetHex} (${rango.inicio}), ${rango.longitud} byte(s)`);
      console.log(`    antes:   ${hex(rango.bytesA, maxBytes)}`);
      console.log(`    después: ${hex(rango.bytesB, maxBytes)}`);
      const interpretacion = interpretacionNumerica(rango);
      if (interpretacion) console.log(`    valor:   ${interpretacion}`);
      console.log('');
    }
  });

programa.parseAsync().catch((error: unknown) => {
  const mensaje = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${mensaje}`);
  process.exitCode = 1;
});
