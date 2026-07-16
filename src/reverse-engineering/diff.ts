/**
 * Comparación byte a byte entre dos archivos de partida.
 *
 * Es LA herramienta de ingeniería inversa del proyecto: guardar la partida,
 * hacer una operación conocida en el juego (ej. vender un jugador por X),
 * guardar de nuevo, y diffear los dos archivos para ver qué offsets cambiaron.
 */

import { readFile } from 'node:fs/promises';

/** Un rango contiguo de bytes que difieren entre los dos buffers. */
export interface RangoDiff {
  /** Offset del primer byte distinto. */
  inicio: number;
  /** Cantidad de bytes contiguos que difieren. */
  longitud: number;
  /** Los bytes de A en ese rango (vacío si A es más corto que el rango). */
  bytesA: Uint8Array;
  /** Los bytes de B en ese rango (vacío si B es más corto que el rango). */
  bytesB: Uint8Array;
}

export interface ResultadoDiff {
  rangos: RangoDiff[];
  tamanoA: number;
  tamanoB: number;
  /** Total de bytes distintos (suma de longitudes de todos los rangos). */
  totalBytesDistintos: number;
}

/**
 * Compara dos buffers byte a byte y devuelve los rangos donde difieren,
 * agrupando offsets consecutivos en un solo rango.
 *
 * Si los tamaños difieren, la cola sobrante del archivo más largo se reporta
 * como un rango más (con el lado corto vacío).
 */
export function diffBuffers(a: Uint8Array, b: Uint8Array): ResultadoDiff {
  const rangos: RangoDiff[] = [];
  const minimo = Math.min(a.length, b.length);
  const maximo = Math.max(a.length, b.length);

  let inicioRango = -1; // -1 = no hay rango abierto

  const cerrarRango = (finExclusivo: number): void => {
    if (inicioRango === -1) return;
    rangos.push({
      inicio: inicioRango,
      longitud: finExclusivo - inicioRango,
      bytesA: a.slice(inicioRango, Math.min(finExclusivo, a.length)),
      bytesB: b.slice(inicioRango, Math.min(finExclusivo, b.length)),
    });
    inicioRango = -1;
  };

  for (let i = 0; i < minimo; i++) {
    if (a[i] !== b[i]) {
      if (inicioRango === -1) inicioRango = i;
    } else {
      cerrarRango(i);
    }
  }

  if (minimo < maximo) {
    // La cola sobrante difiere por definición: se fusiona con el rango
    // abierto si lo hay, o abre uno nuevo.
    if (inicioRango === -1) inicioRango = minimo;
    cerrarRango(maximo);
  } else {
    cerrarRango(minimo);
  }

  return {
    rangos,
    tamanoA: a.length,
    tamanoB: b.length,
    totalBytesDistintos: rangos.reduce((suma, r) => suma + r.longitud, 0),
  };
}

/** Carga dos archivos desde disco y los compara. */
export async function diffSaves(rutaA: string, rutaB: string): Promise<ResultadoDiff> {
  const [contenidoA, contenidoB] = await Promise.all([readFile(rutaA), readFile(rutaB)]);
  return diffBuffers(new Uint8Array(contenidoA), new Uint8Array(contenidoB));
}
