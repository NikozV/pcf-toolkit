/**
 * Advisor: sugerencias de valores seguros para la caja.
 *
 * La filosofía del proyecto: no "poné cualquier número", sino 2-3 variantes
 * con trade-offs explicados, respetando el techo de overflow conocido.
 */

import { pesosAPesetas, TECHO_PESOS } from '../core/caja';

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
 * variantes con trade-offs, todas por debajo del techo de overflow.
 */
export function sugerirCaja(cajaActualPesos: number): OpcionCaja[] {
  const discreta = Math.min(Math.max(redondear(cajaActualPesos * 5), 1_000_000), 2_000_000);
  const holgada = 7_000_000;
  const limite = redondear(TECHO_PESOS * 0.95); // 5% de colchón ante ingresos semanales

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
        'Plata de sobra para fichar y ampliar el estadio durante temporadas, con la mitad del techo libre para acumular ingresos sin riesgo.',
    },
    {
      nombre: 'al límite',
      pesos: limite,
      pesetas: pesosAPesetas(limite),
      explicacion: `Máximo prudente: 95% del techo de overflow (${TECHO_PESOS.toLocaleString('es-AR')} $). El 5% restante es colchón para ingresos semanales; no acumular mucho más.`,
    },
  ];
  return opciones;
}
