/**
 * CLI del PCF Toolkit.
 *
 * Fase 1: solo `pcf diff`. Los comandos `info`, `set` y `suggest` llegan
 * cuando tengamos offsets confirmados contra partidas reales.
 */

import { Command } from 'commander';
import { copyFile } from 'node:fs/promises';
import { diffSaves, type RangoDiff } from '../reverse-engineering/diff';
import { readInt32LE, readUint16LE, readUint32LE } from '../core/buffer';
import { detectarCajaActual, escribirCaja, localizarCaja, pesosAPesetas, TECHO_PESOS } from '../core/caja';
import {
  ATRIBUTOS,
  ATRIBUTO_MAX,
  ATRIBUTO_MIN,
  buscarJugadores,
  detectarPlantel,
  escribirAtributos,
  ETIQUETAS,
  leerAtributos,
  type Atributos,
  type NombreAtributo,
} from '../core/jugador';
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

/**
 * Guarda el save en el lugar creando antes un backup automático, o a otra ruta
 * si se pasa `salida` (en ese caso no toca el original). Devuelve la ruta del
 * backup creado, o null si escribió a otra ruta.
 */
async function guardarConBackup(save: SaveFile, archivo: string, salida?: string): Promise<string | null> {
  if (salida) {
    await save.write(salida);
    return null;
  }
  const marca = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const backup = `${archivo}.bak-${marca}`;
  await copyFile(archivo, backup);
  await save.write(archivo, { sobrescribirOriginal: true });
  return backup;
}

programa
  .command('caja')
  .description('Localiza la caja del club en un save de PCF6 y permite editarla (siempre sobre una copia)')
  .argument('<archivo>', 'archivo de partida (managXXX.XXX)')
  .option('--pesos <n>', 'caja actual EXACTA como la muestra el juego (opcional: por defecto se auto-detecta)')
  .option('--set <n>', 'nueva caja deseada, en pesos mostrados')
  .option('--salida <ruta>', 'escribir a otra ruta en vez de pisar el archivo (en ese caso no se hace backup)')
  .action(
    async (
      archivo: string,
      opciones: { pesos?: string; set?: string; salida?: string },
    ) => {
      const save = await SaveFile.load(archivo);

      // Sin --pesos: auto-detectar la caja actual por el libro de balances.
      let cajaMostrada: number;
      if (opciones.pesos === undefined) {
        const detectada = detectarCajaActual(save.data);
        if (!detectada) {
          programa.error(
            'No pude auto-detectar la caja (partida muy al principio o formato distinto). ' +
              'Pasá --pesos <valor> con la caja que muestra la pantalla de finanzas.',
          );
        }
        cajaMostrada = detectada!.pesos;
        const f = detectada!.fecha;
        console.log(`Caja auto-detectada: ${pesos(cajaMostrada)} (libro de balances, ${detectada!.semanas} semanas, última al ${f.dia}-${f.mes}-${f.anio})`);
      } else {
        cajaMostrada = Number.parseInt(opciones.pesos, 10);
        if (!Number.isInteger(cajaMostrada) || cajaMostrada < 0) {
          programa.error('--pesos tiene que ser el número entero que muestra el juego (sin puntos)');
        }
      }

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

      if (opciones.salida) {
        // Escritura a otra ruta: el original no se toca, no hace falta backup.
        await save.write(opciones.salida);
        console.log(`\nListo: caja ${pesos(caja.pesos)} → ${pesos(nuevaPesos)} (${caja.offsets.length} copias actualizadas)`);
        console.log(`Escrito en: ${opciones.salida} (el original queda intacto)`);
        return;
      }

      // Escritura en el lugar: SIEMPRE con backup automático previo del original.
      const marca = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const backup = `${archivo}.bak-${marca}`;
      await copyFile(archivo, backup);
      await save.write(archivo, { sobrescribirOriginal: true });

      console.log(`\nListo: caja ${pesos(caja.pesos)} → ${pesos(nuevaPesos)} (${caja.offsets.length} copias actualizadas)`);
      console.log(`Guardado directo en: ${archivo}`);
      console.log(`Backup del original: ${backup}`);
      console.log('Recordá: editá siempre con el juego cerrado.');
    },
  );

programa
  .command('jugador')
  .description('Muestra y edita los atributos de un jugador (busca por nombre)')
  .argument('<archivo>', 'archivo de partida (managXXX.XXX)')
  .argument('<nombre>', 'nombre corto del jugador (ej: Palermo)')
  .option('--set <cambios>', 'atributos a cambiar, ej: "velocidad=99,remate=90" (o "todo=99")')
  .option('--salida <ruta>', 'escribir a otra ruta en vez de pisar el archivo (sin backup)')
  .action(async (archivo: string, nombre: string, opciones: { set?: string; salida?: string }) => {
    const save = await SaveFile.load(archivo);
    const jugadores = buscarJugadores(save.data, nombre);

    if (jugadores.length === 0) {
      programa.error(`No encontré ningún jugador con nombre "${nombre}" (probá con el nombre corto, ej: Palermo).`);
    }
    if (jugadores.length > 1 && opciones.set) {
      console.log(`Hay ${jugadores.length} jugadores que coinciden con "${nombre}":`);
      for (const j of jugadores) console.log(`  · ${j.nombreCorto} (${j.nombreLargo})`);
      programa.error('Para editar necesito un nombre que identifique a uno solo. Afiná el nombre.');
    }

    const mostrarAtributos = (attrs: Atributos): void => {
      for (const a of ATRIBUTOS) {
        console.log(`  ${ETIQUETAS[a].padEnd(18)} ${String(attrs[a]).padStart(3)}`);
      }
    };

    if (!opciones.set) {
      for (const j of jugadores) {
        console.log(`\n${j.nombreLargo}  (nombre corto: ${j.nombreCorto})`);
        mostrarAtributos(j.atributos);
      }
      console.log('\nNota: en arqueros, el juego muestra en pantalla un "arquero" mayor al valor guardado.');
      return;
    }

    // Parsear los cambios: "todo=99" o "velocidad=99,remate=90"
    const cambios: Partial<Atributos> = {};
    for (const par of opciones.set.split(',')) {
      const [clave, valTxt] = par.split('=').map((s) => s.trim());
      const valor = Number.parseInt(valTxt ?? '', 10);
      if (!Number.isInteger(valor) || valor < ATRIBUTO_MIN || valor > ATRIBUTO_MAX) {
        programa.error(`Valor inválido en "${par}": tiene que ser un entero ${ATRIBUTO_MIN}..${ATRIBUTO_MAX}.`);
      }
      if (clave === 'todo') {
        for (const a of ATRIBUTOS) cambios[a] = valor;
      } else if ((ATRIBUTOS as readonly string[]).includes(clave ?? '')) {
        cambios[clave as NombreAtributo] = valor;
      } else {
        programa.error(`Atributo desconocido: "${clave}". Válidos: ${ATRIBUTOS.join(', ')}, o "todo".`);
      }
    }

    const j = jugadores[0]!;
    console.log(`\n${j.nombreLargo} — antes:`);
    mostrarAtributos(j.atributos);

    escribirAtributos(save.data, j.offsetAtributos, cambios);
    const despues = leerAtributos(save.data, j.offsetAtributos);

    console.log(`\n${j.nombreLargo} — después:`);
    mostrarAtributos(despues);

    const backup = await guardarConBackup(save, archivo, opciones.salida);
    if (opciones.salida) {
      console.log(`\nEscrito en: ${opciones.salida} (el original queda intacto)`);
    } else {
      console.log(`\nGuardado directo en: ${archivo}`);
      console.log(`Backup del original: ${backup}`);
    }
    console.log('Se editaron las dos temporadas (actual y próxima). Recordá: con el juego cerrado.');
  });

programa
  .command('plantel')
  .description('Lista el plantel del club que manejás (detectado automáticamente)')
  .argument('<archivo>', 'archivo de partida (managXXX.XXX)')
  .action(async (archivo: string) => {
    const save = await SaveFile.load(archivo);
    const plantel = detectarPlantel(save.data);
    if (plantel.length === 0) {
      programa.error('No pude detectar el plantel (partida muy al principio, o formato distinto).');
    }
    console.log(`Plantel detectado: ${plantel.length} jugadores\n`);
    for (const j of plantel) {
      const prom = Math.round(ATRIBUTOS.reduce((s, a) => s + j.atributos[a], 0) / ATRIBUTOS.length);
      console.log(`  ${j.nombreLargo.padEnd(34)} prom≈${prom}  (${j.nombreCorto})`);
    }
    console.log('\nPara editar uno: pcf jugador <archivo> <nombre> --set ...');
  });

programa.parseAsync().catch((error: unknown) => {
  const mensaje = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${mensaje}`);
  process.exitCode = 1;
});
