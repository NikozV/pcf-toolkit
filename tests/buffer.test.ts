/**
 * Tests de los helpers de bytes. Todos los buffers acá son sintéticos
 * (bytes de ejemplo armados a mano), NO archivos reales de PC Fútbol.
 */

import { describe, expect, it } from 'vitest';
import {
  asciiABytes,
  findAllBytes,
  findBytes,
  readAsciiString,
  readFecha,
  readInt32LE,
  readUint16LE,
  readUint32LE,
  readUint8,
  writeFecha,
  writeInt32LE,
  writeUint16LE,
  writeUint32LE,
  writeUint8,
} from '../src/core/buffer';

describe('uint8', () => {
  it('lee y escribe', () => {
    const buf = new Uint8Array([0x00, 0xff, 0x7f]);
    expect(readUint8(buf, 0)).toBe(0);
    expect(readUint8(buf, 1)).toBe(255);
    writeUint8(buf, 0, 200);
    expect(readUint8(buf, 0)).toBe(200);
  });

  it('rechaza valores fuera de rango', () => {
    const buf = new Uint8Array(1);
    expect(() => writeUint8(buf, 0, 256)).toThrow(RangeError);
    expect(() => writeUint8(buf, 0, -1)).toThrow(RangeError);
    expect(() => writeUint8(buf, 0, 1.5)).toThrow(RangeError);
  });

  it('rechaza offsets fuera del buffer', () => {
    const buf = new Uint8Array(2);
    expect(() => readUint8(buf, 2)).toThrow(RangeError);
    expect(() => readUint8(buf, -1)).toThrow(RangeError);
  });
});

describe('uint16 LE', () => {
  it('lee en orden little-endian', () => {
    // 0x1234 en LE se guarda como [0x34, 0x12]
    const buf = new Uint8Array([0x34, 0x12]);
    expect(readUint16LE(buf, 0)).toBe(0x1234);
  });

  it('escribe en orden little-endian', () => {
    const buf = new Uint8Array(2);
    writeUint16LE(buf, 0, 0x1234);
    expect(Array.from(buf)).toEqual([0x34, 0x12]);
  });

  it('roundtrip de valores límite', () => {
    const buf = new Uint8Array(2);
    for (const valor of [0, 1, 0xff, 0x100, 0xffff]) {
      writeUint16LE(buf, 0, valor);
      expect(readUint16LE(buf, 0)).toBe(valor);
    }
  });

  it('rechaza valores fuera de rango', () => {
    const buf = new Uint8Array(2);
    expect(() => writeUint16LE(buf, 0, 0x10000)).toThrow(RangeError);
    expect(() => writeUint16LE(buf, 0, -1)).toThrow(RangeError);
  });

  it('rechaza lecturas que se pasan del final', () => {
    const buf = new Uint8Array(3);
    expect(() => readUint16LE(buf, 2)).toThrow(RangeError);
  });
});

describe('uint32 LE', () => {
  it('lee en orden little-endian', () => {
    // 0x12345678 en LE se guarda como [0x78, 0x56, 0x34, 0x12]
    const buf = new Uint8Array([0x78, 0x56, 0x34, 0x12]);
    expect(readUint32LE(buf, 0)).toBe(0x12345678);
  });

  it('lee valores con el bit alto prendido como sin signo', () => {
    const buf = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
    expect(readUint32LE(buf, 0)).toBe(0xffffffff);
  });

  it('roundtrip de valores límite', () => {
    const buf = new Uint8Array(4);
    for (const valor of [0, 1, 0x7fffffff, 0x80000000, 0xffffffff]) {
      writeUint32LE(buf, 0, valor);
      expect(readUint32LE(buf, 0)).toBe(valor);
    }
  });

  it('rechaza valores fuera de rango', () => {
    const buf = new Uint8Array(4);
    expect(() => writeUint32LE(buf, 0, 0x100000000)).toThrow(RangeError);
    expect(() => writeUint32LE(buf, 0, -1)).toThrow(RangeError);
  });
});

describe('int32 LE (con signo)', () => {
  it('lee negativos en complemento a dos', () => {
    const buf = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
    expect(readInt32LE(buf, 0)).toBe(-1);
  });

  it('roundtrip de valores límite, incluido el techo de overflow del juego', () => {
    const buf = new Uint8Array(4);
    // 2_147_483_647 es el techo conocido de los contadores de plata del juego
    // (signed long de 4 bytes): pasarlo da overflow a negativo.
    for (const valor of [-0x80000000, -1, 0, 1, 2_147_483_647]) {
      writeInt32LE(buf, 0, valor);
      expect(readInt32LE(buf, 0)).toBe(valor);
    }
  });

  it('signed y unsigned comparten representación en bytes', () => {
    const bufSigned = new Uint8Array(4);
    const bufUnsigned = new Uint8Array(4);
    writeInt32LE(bufSigned, 0, -2);
    writeUint32LE(bufUnsigned, 0, 0xfffffffe);
    expect(Array.from(bufSigned)).toEqual(Array.from(bufUnsigned));
  });

  it('rechaza valores fuera de rango', () => {
    const buf = new Uint8Array(4);
    expect(() => writeInt32LE(buf, 0, 0x80000000)).toThrow(RangeError);
    expect(() => writeInt32LE(buf, 0, -0x80000001)).toThrow(RangeError);
  });
});

describe('fecha (día 1 byte, mes 1 byte, año 2 bytes LE)', () => {
  it('lee el formato del juego', () => {
    // 23/6/1974 → día 23, mes 6, año 1974 = 0x07B6 → LE [0xB6, 0x07]
    const buf = new Uint8Array([23, 6, 0xb6, 0x07]);
    expect(readFecha(buf, 0)).toEqual({ dia: 23, mes: 6, anio: 1974 });
  });

  it('escribe y hace roundtrip', () => {
    const buf = new Uint8Array(8);
    const fecha = { dia: 1, mes: 12, anio: 1997 };
    writeFecha(buf, 2, fecha); // offset no-cero para verificar que respeta la posición
    expect(readFecha(buf, 2)).toEqual(fecha);
    expect(Array.from(buf.subarray(0, 2))).toEqual([0, 0]); // no tocó lo de antes
  });

  it('rechaza componentes fuera del rango físico', () => {
    const buf = new Uint8Array(4);
    expect(() => writeFecha(buf, 0, { dia: 256, mes: 1, anio: 1997 })).toThrow(RangeError);
    expect(() => writeFecha(buf, 0, { dia: 1, mes: -1, anio: 1997 })).toThrow(RangeError);
    expect(() => writeFecha(buf, 0, { dia: 1, mes: 1, anio: 0x10000 })).toThrow(RangeError);
  });
});

describe('readAsciiString', () => {
  // "Foo\0\0" + basura después: típico campo de texto de largo fijo
  const buf = asciiABytes('HOLA\0\0XY');

  it('corta en el primer nulo por defecto', () => {
    expect(readAsciiString(buf, 0, 8)).toBe('HOLA');
  });

  it('devuelve el largo completo con hastaNulo: false', () => {
    expect(readAsciiString(buf, 0, 8, { hastaNulo: false })).toBe('HOLA\0\0XY');
  });

  it('lee desde un offset intermedio', () => {
    expect(readAsciiString(buf, 6, 2)).toBe('XY');
  });

  it('rechaza largos que se pasan del buffer', () => {
    expect(() => readAsciiString(buf, 6, 3)).toThrow(RangeError);
  });
});

describe('findBytes / findAllBytes', () => {
  const buf = asciiABytes('..millones..millones.');

  it('encuentra la primera aparición', () => {
    expect(findBytes(buf, asciiABytes('millones'))).toBe(2);
  });

  it('respeta el parámetro desde', () => {
    expect(findBytes(buf, asciiABytes('millones'), 3)).toBe(12);
  });

  it('devuelve -1 si no está', () => {
    expect(findBytes(buf, asciiABytes('pesetas'))).toBe(-1);
  });

  it('devuelve -1 si la secuencia es más larga que el buffer', () => {
    expect(findBytes(asciiABytes('ab'), asciiABytes('abc'))).toBe(-1);
  });

  it('encuentra secuencias al principio y al final exactos', () => {
    expect(findBytes(asciiABytes('abcd'), asciiABytes('ab'))).toBe(0);
    expect(findBytes(asciiABytes('abcd'), asciiABytes('cd'))).toBe(2);
  });

  it('encuentra todas las apariciones no solapadas', () => {
    expect(findAllBytes(buf, asciiABytes('millones'))).toEqual([2, 12]);
    expect(findAllBytes(buf, asciiABytes('zzz'))).toEqual([]);
  });

  it('rechaza secuencia vacía', () => {
    expect(() => findBytes(buf, new Uint8Array(0))).toThrow(RangeError);
  });

  it('funciona con bytes no-ASCII', () => {
    const datos = new Uint8Array([0x00, 0xff, 0x78, 0x56, 0x34, 0x12, 0x00]);
    expect(findBytes(datos, new Uint8Array([0x78, 0x56, 0x34, 0x12]))).toBe(2);
  });
});

describe('asciiABytes', () => {
  it('convierte texto plano', () => {
    expect(Array.from(asciiABytes('AB'))).toEqual([0x41, 0x42]);
  });

  it('rechaza caracteres fuera de latin-1', () => {
    expect(() => asciiABytes('€')).toThrow(RangeError);
  });
});
