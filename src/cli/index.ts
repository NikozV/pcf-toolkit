/**
 * CLI del PCF Toolkit.
 *
 * Fase 1: solo `pcf diff`. Los comandos `info`, `set` y `suggest` llegan
 * cuando tengamos offsets confirmados contra partidas reales.
 */

import { Command } from 'commander';
import { parse as parsearRuta, format as formatearRuta } from 'node:path';
import { diffSaves, type RangoDiff } from '../reverse-engineering/diff';
import { readInt32LE, readUint16LE, readUint32LE } from '../core/buffer';
import { escribirCaja, localizarCaja, pesosAPesetas, TECHO_PESOS } from '../core/caja';
import { SaveFile } from '../core/save-file';
import { sugerirCaja } from '../advisor/suggestions';

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

const pesos = (n: number): string => `${n.toLocaleString('es-AR')} $`;

programa
  .command('caja')
  .description('Localiza la caja del club en un save de PCF6 y permite editarla (siempre sobre una copia)')
  .argument('<archivo>', 'archivo de partida (managXXX.XXX)')
  .requiredOption('--pesos <n>', 'caja actual EXACTA como la muestra la pantalla de finanzas del juego')
  .option('--set <n>', 'nueva caja deseada, en pesos mostrados')
  .option('--salida <ruta>', 'a dónde escribir la copia editada (default: <nombre>.editada.<ext> al lado del original)')
  .option('--sobrescribir-original', 'CONFIRMACIÓN explícita para pisar el archivo de origen', false)
  .action(
    async (
      archivo: string,
      opciones: { pesos: string; set?: string; salida?: string; sobrescribirOriginal: boolean },
    ) => {
      const cajaMostrada = Number.parseInt(opciones.pesos, 10);
      if (!Number.isInteger(cajaMostrada) || cajaMostrada < 0) {
        programa.error('--pesos tiene que ser el número entero que muestra el juego (sin puntos)');
      }

      const save = await SaveFile.load(archivo);
      const caja = localizarCaja(save.data, cajaMostrada);

      console.log(`Caja localizada: ${pesos(caja.pesos)} = ${caja.pesetas.toLocaleString('es-AR')} pesetas internas`);
      console.log(
        `Copias encontradas: ${caja.offsets.length} → ${caja.offsets.map((o) => '0x' + o.toString(16).toUpperCase()).join(', ')}`,
      );
      if (caja.offsets.length !== 3) {
        console.log(`⚠ Se esperaban 3 copias y hay ${caja.offsets.length}: revisar antes de confiar en la edición.`);
      }

      if (opciones.set === undefined) {
        console.log('\nSugerencias (usá --set <pesos> para aplicar una):\n');
        for (const opcion of sugerirCaja(caja.pesos)) {
          console.log(`  ${opcion.nombre.padEnd(10)} ${pesos(opcion.pesos).padStart(14)} — ${opcion.explicacion}`);
        }
        return;
      }

      const nuevaPesos = Number.parseInt(opciones.set, 10);
      if (!Number.isInteger(nuevaPesos) || nuevaPesos <= 0) {
        programa.error('--set tiene que ser un entero positivo en pesos (sin puntos)');
      }
      if (nuevaPesos > TECHO_PESOS) {
        programa.error(
          `--set ${nuevaPesos.toLocaleString('es-AR')} supera el techo seguro de ${pesos(TECHO_PESOS)} (overflow del juego). No lo hago.`,
        );
      }

      escribirCaja(save.data, caja.offsets, pesosAPesetas(nuevaPesos));

      let destino: string;
      if (opciones.sobrescribirOriginal) {
        destino = archivo;
      } else if (opciones.salida) {
        destino = opciones.salida;
      } else {
        const partes = parsearRuta(archivo);
        destino = formatearRuta({ dir: partes.dir, name: `${partes.name}.editada`, ext: partes.ext });
      }
      await save.write(destino, { sobrescribirOriginal: opciones.sobrescribirOriginal });

      console.log(`\nListo: caja ${pesos(caja.pesos)} → ${pesos(nuevaPesos)} (${caja.offsets.length} copias actualizadas)`);
      console.log(`Escrito en: ${destino}`);
      if (!opciones.sobrescribirOriginal) {
        console.log('El original queda intacto. Para usarlo en el juego, copialo sobre el archivo original (con el juego cerrado).');
      }
    },
  );

programa.parseAsync().catch((error: unknown) => {
  const mensaje = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${mensaje}`);
  process.exitCode = 1;
});
