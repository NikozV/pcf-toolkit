/**
 * Advisor: sugerencias de valores seguros para la caja.
 *
 * La filosofía del proyecto: no "poné cualquier número", sino 2-3 variantes
 * con trade-offs explicados, respetando el techo de overflow conocido.
 */

import { pesosAPesetas, ZONA_VERDE_PESOS } from '../core/caja';

export interface OpcionCaja {
  nombre: string;
  /** Valor que va a mostrar el juego, en pesos. */
  pesos: number;
  /** Valor interno a escribir, en pesetas. */
  pesetas: number;
  explicacion: string;
}

/** Redondea hacia abajo a un múltiplo "lindo" de 50.000 $. */
function redondear(pesos: number): number {
  return Math.floor(pesos / 50_000) * 50_000;
}

/**
 * Dado el estado actual de la caja (en pesos mostrados), devuelve tres
 * variantes con trade-offs. Van desde "no romper la divisional" hasta
 * "como el club más rico del juego".
 */
export function sugerirCaja(cajaActualPesos: number): OpcionCaja[] {
  const discreta = Math.min(Math.max(redondear(cajaActualPesos * 5), 1_000_000), 5_000_000);
  const holgada = 50_000_000; // fichar a cualquiera y ampliar el estadio, sin ser absurdo
  const fortuna = ZONA_VERDE_PESOS; // 66,6M: el máximo que el juego genera de fábrica (redondo)

  const opciones: OpcionCaja[] = [
    {
      nombre: 'discreta',
      pesos: discreta,
      pesetas: pesosAPesetas(discreta),
      explicacion:
        'Como una buena venta de jugador. No rompe la escala de la divisional: los rivales siguen siendo competitivos y el desafío deportivo se mantiene.',
    },
    {
      nombre: 'holgada',
      pesos: holgada,
      pesetas: pesosAPesetas(holgada),
      explicacion:
        'Plata para fichar a cualquiera y ampliar el estadio durante temporadas. Muy por encima de lo que necesita un club de la B, pero nada raro para el juego.',
    },
    {
      nombre: 'fortuna',
      pesos: fortuna,
      pesetas: pesosAPesetas(fortuna),
      explicacion: `Al nivel del club más rico que el juego genera de fábrica (${fortuna.toLocaleString('es-AR')} $ ≈ 10.000M de pesetas). Terreno probado: hay clubes IA con esta plata funcionando sin problemas.`,
    },
  ];
  return opciones;
}
