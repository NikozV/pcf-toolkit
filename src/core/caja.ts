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

import { readFloat64LE, writeFloat64LE, readFecha, type Fecha } from './buffer';

/** Cambio interno pesetas → pesos de la edición Argentina (≈ pta/USD de 1998). */
export const PESETAS_POR_PESO = 150;

/**
 * Techo práctico de la caja, en PESOS mostrados: 999.999.999 (9 dígitos).
 *
 * Ojo: la caja se guarda como DOUBLE, así que el storage no tiene un techo
 * real acá cerca. El límite de int32 de ~2.147 millones que decían los foros
 * es de los contadores de INGRESOS por partido/semana (esos sí son int32 y
 * overflowean), NO de la caja. Evidencia (recon 2026-07-16 sobre fixture real):
 * el juego mismo tiene clubes con cajas de 4.000M / 7.000M / 10.000M de PESETAS
 * (presupuestos redondos, decenas de copias) y los más ricos llegan a ~100.000M
 * de pesetas (≈ 666M pesos mostrados). O sea, el juego maneja cajas de miles de
 * millones de pesetas sin problema.
 *
 * Elegimos 999.999.999 pesos como tope: es la misma cantidad de dígitos que ya
 * muestran los clubes ricos (la pantalla de finanzas los muestra bien), y deja
 * plata de sobra para cualquier hobby. Confirmación definitiva pendiente:
 * editar a un valor alto, cargar el juego y verificar que la pantalla lo muestra
 * bien y no se corrompe nada.
 */
export const TECHO_PESOS = 999_999_999;

/** El techo expresado en pesetas internas (double). */
export const TECHO_PESETAS = TECHO_PESOS * PESETAS_POR_PESO; // 149.999.999.850

/**
 * Zona "verde" confirmada: el juego genera de fábrica cajas redondas de hasta
 * 10.000M de pesetas (≈ 66,6M pesos). Por debajo de esto estamos pisando
 * terreno que el propio juego usa; por encima, seguimos en el mismo orden de
 * magnitud que sus clubes más ricos, pero es zona no generada de fábrica.
 */
export const ZONA_VERDE_PESOS = Math.trunc(10_000_000_000 / PESETAS_POR_PESO); // 66.666.666

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
      `${nuevaPesetas.toLocaleString('es-AR')} pta supera el tope práctico de ${TECHO_PESETAS.toLocaleString('es-AR')} pta ` +
        `(${TECHO_PESOS.toLocaleString('es-AR')} $): más que eso ya no entra prolijo en la pantalla de finanzas.`,
    );
  }
  if (offsets.length === 0) {
    throw new Error('No hay offsets para escribir: localizá la caja primero.');
  }
  for (const offset of offsets) {
    writeFloat64LE(buf, offset, nuevaPesetas);
  }
}

// ---------------------------------------------------------------------------
// Auto-detección de la caja actual (sin conocer el valor mostrado)
// ---------------------------------------------------------------------------

export interface CajaDetectada {
  pesetas: number;
  pesos: number;
  /** Cuántas semanas tiene el libro de balances detectado. */
  semanas: number;
  /** Fecha de la última entrada (la caja actual). */
  fecha: Fecha;
}

/** Días aproximados desde 1998-01-01. No necesita exactitud de calendario:
 * solo sirve para medir que dos fechas estén separadas ~1 semana. */
function diasAprox(f: Fecha): number {
  const acum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const mes = f.mes >= 1 && f.mes <= 12 ? f.mes : 1;
  return (f.anio - 1998) * 365 + acum[mes - 1]! + f.dia;
}

/**
 * Detecta la caja actual del club del usuario SIN que haga falta ingresar el
 * valor mostrado. Se apoya en el libro de balances: una tabla de entradas
 * `[fecha (4 bytes)][caja (double LE, 8 bytes)]` con fechas semanales y stride
 * de offset constante, que solo tiene el club que maneja el humano (los clubes
 * IA no llevan libro semanal). La caja actual es la entrada de fecha más
 * reciente de la cadena semanal más larga.
 *
 * Confirmado contra fixtures reales (semana 3 → 615.886 $, semana 4 → 755.149 $).
 * Devuelve null si no encuentra una cadena de al menos 2 semanas (ej. partida
 * recién empezada): en ese caso el caller cae al modo manual.
 */
export function detectarCajaActual(buf: Uint8Array): CajaDetectada | null {
  interface Par {
    off: number;
    dias: number;
    fecha: Fecha;
    pesetas: number;
  }

  // 1) Recolectar todos los pares [fecha plausible][double de caja plausible].
  const pares: Par[] = [];
  for (let off = 0; off <= buf.length - 12; off++) {
    const dia = buf[off]!;
    const mes = buf[off + 1]!;
    const anio = buf[off + 2]! | (buf[off + 3]! << 8);
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12 || anio < 1998 || anio > 2010) continue;
    const pesetas = readFloat64LE(buf, off + 4);
    if (!Number.isFinite(pesetas) || pesetas < 100_000 || pesetas > TECHO_PESETAS) continue;
    const fecha = readFecha(buf, off);
    pares.push({ off, dias: diasAprox(fecha), fecha, pesetas });
  }
  if (pares.length < 2) return null;
  pares.sort((a, b) => a.off - b.off);

  // 2) Buscar la cadena más larga: entradas con stride de offset constante y
  //    fechas separadas ~1 semana (descarta pares sueltos que son ruido).
  const cerca = (a: number, b: number) => Math.abs(a - b) <= 4;
  const esSemana = (d: number) => d >= 4 && d <= 10;
  let mejor: Par[] = [];
  for (let i = 0; i < pares.length; i++) {
    for (let j = i + 1; j < pares.length; j++) {
      const stride = pares[j]!.off - pares[i]!.off;
      if (stride > 4096) break;
      if (!esSemana(pares[j]!.dias - pares[i]!.dias)) continue;
      const cadena = [pares[i]!, pares[j]!];
      // Extender la cadena avanzando de a un stride, con fecha semanal.
      for (;;) {
        const ult = cadena[cadena.length - 1]!;
        const sig = pares.find((p) => cerca(p.off, ult.off + stride) && esSemana(p.dias - ult.dias));
        if (!sig) break;
        cadena.push(sig);
      }
      if (cadena.length > mejor.length) mejor = cadena;
    }
  }
  if (mejor.length < 2) return null;

  // 3) La caja actual es la entrada de fecha más reciente de la cadena.
  const ultima = mejor.reduce((a, b) => (b.dias > a.dias ? b : a));
  return {
    pesetas: ultima.pesetas,
    pesos: pesetasAPesos(ultima.pesetas),
    semanas: mejor.length,
    fecha: ultima.fecha,
  };
}
