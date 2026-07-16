/**
 * SaveFile: capa de bajo nivel para cargar y guardar archivos de partida.
 *
 * No conoce nada del formato del juego (eso viene después, cuando confirmemos
 * offsets). Solo garantiza dos cosas:
 *   1. Guarda una copia intacta del buffer original para poder diffear.
 *   2. Nunca pisa el archivo de origen salvo confirmación explícita.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Normaliza una ruta para compararla con otra. En Windows el filesystem es
 * case-insensitive, así que comparamos en minúsculas. Es una comparación de
 * mejor esfuerzo (no resuelve symlinks), por eso el CLI además pide
 * confirmación antes de sobrescribir cualquier cosa.
 */
function rutaNormalizada(ruta: string): string {
  const absoluta = resolve(ruta);
  return process.platform === 'win32' ? absoluta.toLowerCase() : absoluta;
}

export class SaveFile {
  /** Ruta absoluta del archivo desde el que se cargó. */
  readonly rutaOrigen: string;

  /** Buffer editable. Las modificaciones se hacen acá. */
  readonly data: Uint8Array;

  /** Copia intacta del contenido original (privada, ver original()). */
  readonly #original: Uint8Array;

  private constructor(rutaOrigen: string, contenido: Uint8Array) {
    this.rutaOrigen = rutaOrigen;
    this.data = contenido;
    this.#original = contenido.slice();
  }

  /** Carga un archivo de partida desde disco. */
  static async load(ruta: string): Promise<SaveFile> {
    const contenido = await readFile(ruta);
    return new SaveFile(resolve(ruta), new Uint8Array(contenido));
  }

  get size(): number {
    return this.data.length;
  }

  /**
   * Devuelve una copia del contenido original (el archivo tal como se cargó).
   * Es una copia para que nadie pueda modificar la referencia interna.
   */
  original(): Uint8Array {
    return this.#original.slice();
  }

  /** Indica si el buffer editable difiere del contenido original. */
  fueModificado(): boolean {
    if (this.data.length !== this.#original.length) return true;
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] !== this.#original[i]) return true;
    }
    return false;
  }

  /**
   * Escribe el buffer editable a disco.
   *
   * Si la ruta destino es el mismo archivo de origen, tira error salvo que se
   * pase explícitamente `{ sobrescribirOriginal: true }`. Regla del proyecto:
   * nunca pisar la partida original sin confirmación.
   */
  async write(ruta: string, opciones: { sobrescribirOriginal?: boolean } = {}): Promise<void> {
    const destino = resolve(ruta);
    const esElOrigen = rutaNormalizada(destino) === rutaNormalizada(this.rutaOrigen);
    if (esElOrigen && !opciones.sobrescribirOriginal) {
      throw new Error(
        `No se sobrescribe el archivo original sin confirmación explícita: ${this.rutaOrigen}\n` +
          'Escribí a otra ruta, o pasá { sobrescribirOriginal: true } si de verdad querés sobrescribirlo.',
      );
    }
    await writeFile(destino, this.data);
  }
}
