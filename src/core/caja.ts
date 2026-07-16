/**
 * Localización y edición de la caja del club (PCF6 edición Argentina).
 *
 * Formato confirmado contra saves reales (ver data/offsets.json → plata_club):
 * - La plata se guarda como double IEEE 754 LE, en PESETAS (motor español).
 * - El juego muestra pesos: $ = pesetas / 150, truncando.
 * - La caja actual vive en 3 copias bit a bit idénticas, y sus offsets NO son
 *   estables entre saves (el archivo crece semana a semana), así que se
 *   localiza escaneando por valor, no por offset fijo.
 */

import { readFloat64LE, writeFloat64LE } from './buffer';

/** Cambio interno pesetas → pesos de la edición Argentina (≈ pta/USD de 1998). */
export const PESETAS_POR_PESO = 150;

/**
 * Techo seguro en pesetas: máximo de int32 con signo. El storage es double,
 * pero la lógica del juego castea a entero de 32 bits (overflow reportado por
 * la comunidad pasando ~2.147 millones de pta).
 */
export const TECHO_PESETAS = 2_147_483_647;

/** El techo expresado en pesos mostrados por el juego. */
export const TECHO_PESOS = Math.trunc(TECHO_PESETAS / PESETAS_POR_PESO); // 14.316.557

export function pesetasAPesos(pesetas: number): number {
  return Math.trunc(pesetas / PESETAS_POR_PESO);
}

export function pesosAPesetas(pesos: number): number {
  return pesos * PESETAS_POR_PESO;
}

export interface CajaLocalizada {
  /** Offsets de todas las copias de la caja (normalmente 3). */
  offsets: number[];
  /** Valor interno exacto en pesetas. */
  pesetas: number;
  /** Valor como lo muestra el juego (pesetas/150 truncado). */
  pesos: number;
}

/**
 * Localiza las copias de la caja en el buffer a partir del valor en pesos
 * que muestra el juego (truncado). Busca doubles LE cuyo valor caiga en
 * [pesos*150, (pesos+1)*150) y agrupa por patrón de bits: las copias reales
 * son bit a bit idénticas.
 *
 * Tira error si no encuentra nada o si hay ambigüedad (dos valores distintos
 * en la misma ventana — ej. el presupuesto de otro club que justo cae ahí).
 */
export function localizarCaja(buf: Uint8Array, pesosMostrados: number): CajaLocalizada {
  if (!Number.isInteger(pesosMostrados) || pesosMostrados < 0) {
    throw new RangeError(`La caja mostrada tiene que ser un entero ≥ 0 (recibido: ${pesosMostrados})`);
  }
  const min = pesosMostrados * PESETAS_POR_PESO;
  const max = (pesosMostrados + 1) * PESETAS_POR_PESO;

  // Agrupar hits por patrón de bits exacto (clave: los 8 bytes en hex)
  const grupos = new Map<string, { offsets: number[]; valor: number }>();
  for (let offset = 0; offset <= buf.length - 8; offset++) {
    const valor = readFloat64LE(buf, offset);
    if (valor >= min && valor < max) {
      let clave = '';
      for (let j = 0; j < 8; j++) clave += buf[offset + j]!.toString(16).padStart(2, '0');
      const grupo = grupos.get(clave);
      if (grupo) grupo.offsets.push(offset);
      else grupos.set(clave, { offsets: [offset], valor });
    }
  }

  if (grupos.size === 0) {
    throw new Error(
      `No encontré ningún double compatible con una caja de ${pesosMostrados.toLocaleString('es-AR')} $. ` +
        'Verificá que el número sea exactamente el que muestra la pantalla de finanzas.',
    );
  }

  let candidatos = [...grupos.values()];
  if (candidatos.length > 1) {
    // Con varios patrones distintos, la caja real es la que tiene copias (≥2)
    const conCopias = candidatos.filter((g) => g.offsets.length >= 2);
    if (conCopias.length !== 1) {
      const detalle = candidatos
        .map((g) => `${g.valor.toLocaleString('es-AR')} pta × ${g.offsets.length}`)
        .join(' | ');
      throw new Error(
        `Ambiguo: hay ${candidatos.length} valores distintos compatibles con esa caja (${detalle}). ` +
          'Probablemente otro club tenga un presupuesto en la misma ventana. Jugá una semana más y volvé a intentar.',
      );
    }
    candidatos = conCopias;
  }

  const ganador = candidatos[0]!;
  return {
    offsets: ganador.offsets,
    pesetas: ganador.valor,
    pesos: pesetasAPesos(ganador.valor),
  };
}

/**
 * Escribe la nueva caja (en pesetas) sobre todas las copias localizadas.
 * No toca el disco: modifica el buffer que recibe.
 */
export function escribirCaja(buf: Uint8Array, offsets: number[], nuevaPesetas: number): void {
  if (!Number.isFinite(nuevaPesetas) || nuevaPesetas <= 0) {
    throw new RangeError(`La nueva caja tiene que ser un número positivo (recibido: ${nuevaPesetas})`);
  }
  if (nuevaPesetas > TECHO_PESETAS) {
    throw new RangeError(
      `${nuevaPesetas.toLocaleString('es-AR')} pta supera el techo seguro de ${TECHO_PESETAS.toLocaleString('es-AR')} pta ` +
        `(${TECHO_PESOS.toLocaleString('es-AR')} $): riesgo de overflow del contador del juego.`,
    );
  }
  if (offsets.length === 0) {
    throw new Error('No hay offsets para escribir: localizá la caja primero.');
  }
  for (const offset of offsets) {
    writeFloat64LE(buf, offset, nuevaPesetas);
  }
}
