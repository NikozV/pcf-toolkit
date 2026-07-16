/**
 * Helpers de lectura/escritura de bytes sobre un Uint8Array.
 *
 * Todos los enteros multi-byte son little-endian (LE), que es lo que usa
 * PC Fútbol (juego de DOS/Win9x, x86).
 */

/** Fecha tal como la guarda el juego: día (1 byte), mes (1 byte), año (2 bytes LE). */
export interface Fecha {
  dia: number;
  mes: number;
  anio: number;
}

/** Cantidad de bytes que ocupa una fecha en el archivo. */
export const TAMANO_FECHA = 4;

function verificarRango(buf: Uint8Array, offset: number, largo: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset + largo > buf.length) {
    throw new RangeError(
      `Acceso fuera de rango: offset ${offset}, largo ${largo}, tamaño del buffer ${buf.length}`,
    );
  }
}

function verificarValor(valor: number, min: number, max: number, tipo: string): void {
  if (!Number.isInteger(valor) || valor < min || valor > max) {
    throw new RangeError(`Valor ${valor} inválido para ${tipo} (rango permitido: ${min}..${max})`);
  }
}

// ---------------------------------------------------------------------------
// Enteros
// ---------------------------------------------------------------------------

export function readUint8(buf: Uint8Array, offset: number): number {
  verificarRango(buf, offset, 1);
  return buf[offset]!;
}

export function writeUint8(buf: Uint8Array, offset: number, valor: number): void {
  verificarRango(buf, offset, 1);
  verificarValor(valor, 0, 0xff, 'uint8');
  buf[offset] = valor;
}

export function readUint16LE(buf: Uint8Array, offset: number): number {
  verificarRango(buf, offset, 2);
  return buf[offset]! | (buf[offset + 1]! << 8);
}

export function writeUint16LE(buf: Uint8Array, offset: number, valor: number): void {
  verificarRango(buf, offset, 2);
  verificarValor(valor, 0, 0xffff, 'uint16');
  buf[offset] = valor & 0xff;
  buf[offset + 1] = (valor >>> 8) & 0xff;
}

export function readUint32LE(buf: Uint8Array, offset: number): number {
  verificarRango(buf, offset, 4);
  // El >>> 0 fuerza la interpretación sin signo (JS opera en int32 con signo).
  return (
    (buf[offset]! | (buf[offset + 1]! << 8) | (buf[offset + 2]! << 16) | (buf[offset + 3]! << 24)) >>>
    0
  );
}

export function writeUint32LE(buf: Uint8Array, offset: number, valor: number): void {
  verificarRango(buf, offset, 4);
  verificarValor(valor, 0, 0xffffffff, 'uint32');
  buf[offset] = valor & 0xff;
  buf[offset + 1] = (valor >>> 8) & 0xff;
  buf[offset + 2] = (valor >>> 16) & 0xff;
  buf[offset + 3] = (valor >>> 24) & 0xff;
}

/**
 * Entero de 4 bytes LE con signo (complemento a dos). Es el tipo que usan
 * los campos del estadio (espectadores) según lo relevado en los foros.
 */
export function readInt32LE(buf: Uint8Array, offset: number): number {
  verificarRango(buf, offset, 4);
  // Sin >>> 0: el | deja el resultado como int32 con signo, que es lo que queremos.
  return buf[offset]! | (buf[offset + 1]! << 8) | (buf[offset + 2]! << 16) | (buf[offset + 3]! << 24);
}

export function writeInt32LE(buf: Uint8Array, offset: number, valor: number): void {
  verificarRango(buf, offset, 4);
  verificarValor(valor, -0x80000000, 0x7fffffff, 'int32');
  // Los mismos bytes que el caso sin signo: el complemento a dos lo resuelve la máscara.
  buf[offset] = valor & 0xff;
  buf[offset + 1] = (valor >>> 8) & 0xff;
  buf[offset + 2] = (valor >>> 16) & 0xff;
  buf[offset + 3] = (valor >>> 24) & 0xff;
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

/** Lee una fecha en el formato del juego: día (1 byte), mes (1 byte), año (2 bytes LE). */
export function readFecha(buf: Uint8Array, offset: number): Fecha {
  return {
    dia: readUint8(buf, offset),
    mes: readUint8(buf, offset + 1),
    anio: readUint16LE(buf, offset + 2),
  };
}

export function writeFecha(buf: Uint8Array, offset: number, fecha: Fecha): void {
  verificarRango(buf, offset, TAMANO_FECHA);
  // Validación laxa a propósito: no sabemos si el juego usa valores fuera de
  // calendario como sentinelas (ej. 0/0/0), así que solo acotamos al rango físico.
  verificarValor(fecha.dia, 0, 0xff, 'día de fecha');
  verificarValor(fecha.mes, 0, 0xff, 'mes de fecha');
  verificarValor(fecha.anio, 0, 0xffff, 'año de fecha');
  writeUint8(buf, offset, fecha.dia);
  writeUint8(buf, offset + 1, fecha.mes);
  writeUint16LE(buf, offset + 2, fecha.anio);
}

// ---------------------------------------------------------------------------
// Strings ASCII
// ---------------------------------------------------------------------------

/**
 * Lee un string ASCII de largo fijo.
 *
 * Por defecto corta en el primer byte nulo (los campos de texto de largo fijo
 * suelen venir rellenos con 0x00). Con `hastaNulo: false` devuelve los
 * `largo` caracteres crudos.
 */
export function readAsciiString(
  buf: Uint8Array,
  offset: number,
  largo: number,
  opciones: { hastaNulo?: boolean } = {},
): string {
  verificarRango(buf, offset, largo);
  const { hastaNulo = true } = opciones;
  let fin = offset + largo;
  if (hastaNulo) {
    const nulo = buf.subarray(offset, offset + largo).indexOf(0);
    if (nulo !== -1) fin = offset + nulo;
  }
  let resultado = '';
  for (let i = offset; i < fin; i++) {
    resultado += String.fromCharCode(buf[i]!);
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// Búsqueda de secuencias
// ---------------------------------------------------------------------------

/**
 * Busca la primera aparición de `secuencia` dentro de `buf` a partir de `desde`.
 * Devuelve el offset donde empieza, o -1 si no está.
 */
export function findBytes(buf: Uint8Array, secuencia: Uint8Array, desde = 0): number {
  if (secuencia.length === 0) {
    throw new RangeError('La secuencia a buscar no puede estar vacía');
  }
  if (desde < 0) desde = 0;
  const limite = buf.length - secuencia.length;
  const primero = secuencia[0]!;
  for (let i = desde; i <= limite; i++) {
    if (buf[i] !== primero) continue;
    let coincide = true;
    for (let j = 1; j < secuencia.length; j++) {
      if (buf[i + j] !== secuencia[j]) {
        coincide = false;
        break;
      }
    }
    if (coincide) return i;
  }
  return -1;
}

/** Busca todas las apariciones (no solapadas) de `secuencia` dentro de `buf`. */
export function findAllBytes(buf: Uint8Array, secuencia: Uint8Array): number[] {
  const resultados: number[] = [];
  let desde = 0;
  while (true) {
    const idx = findBytes(buf, secuencia, desde);
    if (idx === -1) break;
    resultados.push(idx);
    desde = idx + secuencia.length;
  }
  return resultados;
}

/** Convierte un string ASCII a bytes, útil para buscar texto plano en la partida. */
export function asciiABytes(texto: string): Uint8Array {
  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i++) {
    const codigo = texto.charCodeAt(i);
    if (codigo > 0xff) {
      throw new RangeError(`El carácter "${texto[i]}" (posición ${i}) no es ASCII/latin-1`);
    }
    bytes[i] = codigo;
  }
  return bytes;
}
