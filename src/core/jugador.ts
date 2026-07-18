/**
 * Lectura y edición de atributos de jugadores (PCF6 edición Argentina).
 *
 * Formato confirmado contra dos fichas reales (Serghei DINOV, arquero;
 * Martín PALERMO, delantero) — ver data/offsets.json → atributos_jugador.
 *
 * Estructura del registro (en la base de datos de jugadores):
 *   [len u16 LE][nombre corto (XOR 0x61)]
 *   [len u16 LE][nombre largo  (XOR 0x61)]
 *   ... 151 bytes de otros datos ...
 *   [bloque de 10 atributos, 1 byte c/u]  ← temporada actual
 *   [3 bytes] [bloque de 10 atributos]     ← próxima temporada (a +13)
 *   ... altura, peso ...
 *
 * Los atributos son bytes CRUDOS (sin XOR), en rango 1..99.
 */

import { readFloat64LE, readUint16LE, readUint8, writeUint8 } from './buffer';
import { detectarCajaActual } from './caja';

/** Orden interno de los 10 atributos principales (confirmado, ver offsets.json). */
export const ATRIBUTOS = [
  'velocidad',
  'resistencia',
  'agresividad',
  'calidad',
  'regate',
  'remate',
  'pase',
  'tiro',
  'entradas',
  'arquero',
] as const;

export type NombreAtributo = (typeof ATRIBUTOS)[number];
export type Atributos = Record<NombreAtributo, number>;

/** Etiquetas lindas para mostrar (coinciden con la pantalla del juego). */
export const ETIQUETAS: Record<NombreAtributo, string> = {
  velocidad: 'Velocidad',
  resistencia: 'Resistencia',
  agresividad: 'Agresividad',
  calidad: 'Calidad',
  regate: 'Regate/Dribbling',
  remate: 'Remate',
  pase: 'Pase',
  tiro: 'Tiro',
  entradas: 'Entradas/Robos',
  arquero: 'Arquero',
};

/** Bytes entre el fin del nombre largo y el bloque de atributos. */
const GAP_A_ATRIBUTOS = 151;
/** Separación entre el bloque de temporada actual y el de próxima temporada. */
const OFFSET_PROXIMA_TEMPORADA = 13;

export const ATRIBUTO_MIN = 1;
export const ATRIBUTO_MAX = 99;

export interface Jugador {
  /** Offset del texto del nombre corto. */
  offsetNombre: number;
  nombreCorto: string;
  nombreLargo: string;
  /** Offset del bloque de atributos de la temporada actual. */
  offsetAtributos: number;
  atributos: Atributos;
}

/** Decodifica un string `[len u16 LE][chars XOR 0x61]` desde el offset del prefijo. */
function leerStringLargo(buf: Uint8Array, offPrefijo: number): { texto: string; fin: number } | null {
  if (offPrefijo < 0 || offPrefijo + 2 > buf.length) return null;
  const largo = readUint16LE(buf, offPrefijo);
  if (largo < 1 || largo > 48 || offPrefijo + 2 + largo > buf.length) return null;
  let texto = '';
  for (let i = 0; i < largo; i++) {
    const c = buf[offPrefijo + 2 + i]! ^ 0x61;
    // Permitir ASCII imprimible y Latin-1 alto (acentos: í, ñ, é, …); rechazar
    // solo controles, que indicarían que esto no es un string real.
    if (c < 0x20 || c === 0x7f) return null;
    texto += String.fromCharCode(c);
  }
  return { texto, fin: offPrefijo + 2 + largo };
}

function bloqueValido(buf: Uint8Array, off: number): boolean {
  if (off + 10 > buf.length) return false;
  for (let i = 0; i < 10; i++) {
    const v = buf[off + i]!;
    if (v < ATRIBUTO_MIN || v > ATRIBUTO_MAX) return false;
  }
  return true;
}

export function leerAtributos(buf: Uint8Array, offsetAtributos: number): Atributos {
  const out = {} as Atributos;
  ATRIBUTOS.forEach((nombre, i) => {
    out[nombre] = readUint8(buf, offsetAtributos + i);
  });
  return out;
}

/**
 * Busca jugadores por nombre corto (case-insensitive). Devuelve solo los que
 * tienen un bloque de atributos válido (10 bytes en rango 1..99), que es el
 * registro real del jugador en la base de datos.
 */
export function buscarJugadores(buf: Uint8Array, nombre: string): Jugador[] {
  const objetivo = nombre.trim().toLowerCase();
  const L = objetivo.length;
  if (L === 0) throw new Error('El nombre a buscar no puede estar vacío.');

  const jugadores: Jugador[] = [];
  for (let i = 2; i <= buf.length - L; i++) {
    // El nombre corto tiene un prefijo de largo u16 LE igual a su longitud.
    if (readUint16LE(buf, i - 2) !== L) continue;
    let texto = '';
    let imprimible = true;
    for (let k = 0; k < L; k++) {
      const c = buf[i + k]! ^ 0x61;
      if (c < 0x20 || c === 0x7f) { imprimible = false; break; }
      texto += String.fromCharCode(c);
    }
    if (!imprimible || texto.toLowerCase() !== objetivo) continue;

    // Parsear el nombre largo, que sigue inmediatamente al corto.
    const largo = leerStringLargo(buf, i + L);
    if (!largo) continue;

    const offsetAtributos = largo.fin + GAP_A_ATRIBUTOS;
    if (!bloqueValido(buf, offsetAtributos)) continue;

    jugadores.push({
      offsetNombre: i,
      nombreCorto: texto,
      nombreLargo: largo.texto,
      offsetAtributos,
      atributos: leerAtributos(buf, offsetAtributos),
    });
  }
  return jugadores;
}

/**
 * Escribe atributos sobre el buffer, en AMBOS bloques (temporada actual y
 * próxima), para que el cambio no se revierta al empezar la próxima temporada.
 * `valores` puede traer solo algunos atributos; los demás quedan como están.
 */
export function escribirAtributos(
  buf: Uint8Array,
  offsetAtributos: number,
  valores: Partial<Atributos>,
): void {
  for (const [nombre, valor] of Object.entries(valores) as [NombreAtributo, number][]) {
    const idx = ATRIBUTOS.indexOf(nombre);
    if (idx === -1) throw new Error(`Atributo desconocido: ${nombre}`);
    if (!Number.isInteger(valor) || valor < ATRIBUTO_MIN || valor > ATRIBUTO_MAX) {
      throw new RangeError(`${nombre}=${valor} fuera de rango (${ATRIBUTO_MIN}..${ATRIBUTO_MAX}).`);
    }
    writeUint8(buf, offsetAtributos + idx, valor);
    writeUint8(buf, offsetAtributos + OFFSET_PROXIMA_TEMPORADA + idx, valor);
  }
}

// ---------------------------------------------------------------------------
// Detección del plantel del club del usuario
// ---------------------------------------------------------------------------

/** Nombre corto plausible (letras/acentos/espacios/puntos), no basura binaria. */
const NOMBRE_CORTO_OK = /^[A-Za-zÀ-ÿ.\- ]{2,24}$/;

/**
 * Intenta leer un registro de jugador cuyo prefijo de largo del nombre corto
 * está en `posPrefijo`. Devuelve el jugador o null si no es un registro válido.
 */
function parsearRegistroEn(buf: Uint8Array, posPrefijo: number): Jugador | null {
  const corto = leerStringLargo(buf, posPrefijo);
  if (!corto || !NOMBRE_CORTO_OK.test(corto.texto)) return null;
  const largo = leerStringLargo(buf, corto.fin);
  if (!largo) return null;
  const offsetAtributos = largo.fin + GAP_A_ATRIBUTOS;
  if (!bloqueValido(buf, offsetAtributos)) return null;
  return {
    offsetNombre: posPrefijo + 2,
    nombreCorto: corto.texto,
    nombreLargo: largo.texto,
    offsetAtributos,
    atributos: leerAtributos(buf, offsetAtributos),
  };
}

/**
 * Detecta el plantel del club que maneja el usuario.
 *
 * El juego agrupa a los jugadores por club en bloques contiguos de registros;
 * el bloque del club del usuario está anclado justo después de la última copia
 * de la caja (ver data/offsets.json → plantel_usuario). Se recorren registros
 * contiguos hasta que se corta el bloque.
 *
 * Devuelve [] si no puede anclar (no detecta caja) o no encuentra el bloque.
 * Nota: puede no incluir jugadores transfer-listados ni juveniles (quedan en
 * otras secciones del archivo).
 *
 * `cajaPesetas` permite pasar el valor exacto de la caja (obtenido con
 * localizarCaja) cuando la auto-detección falla — ej. partida recién creada
 * sin libro de balances todavía.
 */
export function detectarPlantel(buf: Uint8Array, cajaPesetas?: number): Jugador[] {
  const pesetas = cajaPesetas ?? detectarCajaActual(buf)?.pesetas;
  if (pesetas === undefined) return [];

  // Ubicar la última copia (mayor offset) del valor de caja.
  let ultimaCaja = -1;
  for (let i = 0; i <= buf.length - 8; i++) {
    if (readFloat64LE(buf, i) === pesetas) ultimaCaja = i;
  }
  if (ultimaCaja === -1) return [];

  // Primer registro de jugador después de la caja (ventana de 512 bytes).
  let inicio = -1;
  for (let p = ultimaCaja; p < ultimaCaja + 512 && p < buf.length; p++) {
    if (parsearRegistroEn(buf, p)) { inicio = p; break; }
  }
  if (inicio === -1) return [];

  // Recorrer registros contiguos: el próximo prefijo aparece dentro de una
  // ventana tras el bloque de atributos del actual.
  const plantel: Jugador[] = [];
  let pos = inicio;
  const vistos = new Set<number>();
  while (pos > 0 && !vistos.has(pos) && plantel.length < 80) {
    vistos.add(pos);
    const j = parsearRegistroEn(buf, pos);
    if (!j) break;
    plantel.push(j);
    let sig = -1;
    for (let p = j.offsetAtributos + 10; p < j.offsetAtributos + 700 && p < buf.length; p++) {
      if (parsearRegistroEn(buf, p)) { sig = p; break; }
    }
    if (sig === -1) break;
    pos = sig;
  }
  return plantel;
}
