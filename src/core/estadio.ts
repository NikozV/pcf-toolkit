/**
 * Lectura y edición del estadio del club que maneja el usuario (PCF6 Argentina).
 *
 * Confirmado (ver data/offsets.json → estadio):
 * - Cada club tiene un registro con 3 strings (nombre corto, nombre del estadio,
 *   nombre largo) seguido de un bloque de datos.
 * - La CAPACIDAD del estadio es un int32 LE a +12 del fin de los 3 strings.
 *   Verificado contra 5 clubes, la pantalla del estadio (20.000) y un diff
 *   natural: el usuario amplió de 20.000 (ago-1998) a 32.000 (ene-2000).
 * - El club del usuario es el último registro de club antes de la primera copia
 *   de la caja (los jugadores/datos se agrupan por club).
 */

import { readFloat64LE, readInt32LE, readUint16LE, writeInt32LE } from './buffer';
import { detectarCajaActual } from './caja';

/** Máximo prudente de capacidad. Barcelona (120.000) anda sin problemas; damos
 * un poco de margen. No es un límite del formato (int32), sino sensatez. */
export const CAPACIDAD_MAX = 150_000;
export const CAPACIDAD_MIN = 500;

export interface Estadio {
  nombreClub: string;
  nombreEstadio: string;
  capacidad: number;
  /** Offset del int32 de capacidad (para editar). */
  offsetCapacidad: number;
}

function leerStr(buf: Uint8Array, off: number): { texto: string; fin: number } | null {
  if (off + 2 > buf.length) return null;
  const largo = readUint16LE(buf, off);
  if (largo < 2 || largo > 40 || off + 2 + largo > buf.length) return null;
  let texto = '';
  for (let i = 0; i < largo; i++) {
    const c = buf[off + 2 + i]! ^ 0x61;
    if (c < 0x20 || c === 0x7f) return null;
    texto += String.fromCharCode(c);
  }
  return { texto, fin: off + 2 + largo };
}

const NOMBRE_CLUB_OK = /^[A-Za-zÀ-ÿ0-9.,'"()\- ]{2,40}$/;

/** ¿Hay un registro de club cuyo prefijo del nombre corto está en `pos`? */
function clubEn(buf: Uint8Array, pos: number): Estadio | null {
  const corto = leerStr(buf, pos);
  if (!corto || !NOMBRE_CLUB_OK.test(corto.texto)) return null;
  const estadio = leerStr(buf, corto.fin);
  if (!estadio || !NOMBRE_CLUB_OK.test(estadio.texto)) return null;
  const largo = leerStr(buf, estadio.fin);
  if (!largo || !NOMBRE_CLUB_OK.test(largo.texto)) return null;
  const offsetCapacidad = largo.fin + 12;
  const capacidad = readInt32LE(buf, offsetCapacidad);
  if (capacidad < CAPACIDAD_MIN || capacidad > 200_000) return null;
  return { nombreClub: corto.texto, nombreEstadio: estadio.texto, capacidad, offsetCapacidad };
}

/**
 * Detecta el estadio del club que maneja el usuario: el último registro de club
 * (3 strings + capacidad plausible) antes de la primera copia de la caja.
 * Devuelve null si no puede anclar.
 */
export function detectarEstadio(buf: Uint8Array): Estadio | null {
  const caja = detectarCajaActual(buf);
  if (!caja) return null;
  let primeraCaja = -1;
  for (let i = 0; i <= buf.length - 8; i++) {
    if (readFloat64LE(buf, i) === caja.pesetas) { primeraCaja = i; break; }
  }
  if (primeraCaja === -1) return null;

  let encontrado: Estadio | null = null;
  const desde = Math.max(2, primeraCaja - 30_000);
  for (let p = desde; p < primeraCaja; p++) {
    const c = clubEn(buf, p);
    if (c) encontrado = c; // nos quedamos con el ÚLTIMO antes de la caja
  }
  return encontrado;
}

/** Escribe la nueva capacidad (int32 LE), validando el rango prudente. */
export function escribirCapacidad(buf: Uint8Array, offsetCapacidad: number, nueva: number): void {
  if (!Number.isInteger(nueva) || nueva < CAPACIDAD_MIN || nueva > CAPACIDAD_MAX) {
    throw new RangeError(
      `Capacidad ${nueva} fuera del rango permitido (${CAPACIDAD_MIN.toLocaleString('es-AR')}..${CAPACIDAD_MAX.toLocaleString('es-AR')}).`,
    );
  }
  writeInt32LE(buf, offsetCapacidad, nueva);
}
