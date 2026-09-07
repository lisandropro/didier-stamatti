import type { Esquina } from "./escaneo";

// El seguimiento del papel mientras la cámara está apuntando.
//
// La detección cruda sirve para una foto quieta y **no** para video: cada
// lectura difiere unos píxeles de la anterior, así que un marco dibujado
// directamente sobre lo detectado tiembla. Y cuando la mano se mueve o pasa una
// sombra, una lectura falla y el marco desaparece y vuelve — el parpadeo se lee
// como "no lo está encontrando" aunque lo esté encontrando el 90% del tiempo.
//
// Este módulo convierte una serie de lecturas en algo mirable. Es lógica pura y
// se prueba sin cámara: alimentarlo con una secuencia y comprobar qué muestra.

export type Cuadro = [Esquina, Esquina, Esquina, Esquina];

/**
 * Cuántas lecturas seguidas hacen falta para MOSTRAR el marco.
 *
 * Con una sola, un reflejo o un cuadro borroso dibujan un marco en cualquier
 * lado por un instante. Con dos ya hace falta que dos cuadros consecutivos
 * coincidan, que es mucho menos probable por azar.
 */
const ACIERTOS_PARA_APARECER = 2;

/**
 * Cuántas fallas seguidas hacen falta para OCULTARLO.
 *
 * Más alto que el umbral de aparición, y a propósito: perder el papel por dos
 * cuadros mientras se mueve la mano es lo normal, y esconder el marco cada vez
 * lo haría titilar. A ~10 lecturas por segundo, seis fallas son medio segundo
 * sin encontrarlo — ahí sí conviene decir que no está.
 */
const FALLAS_PARA_DESAPARECER = 6;

/**
 * Cuánto se mueve el marco hacia cada lectura nueva, de 0 a 1.
 *
 * Con 1 el marco copia la lectura y tiembla. Con valores muy bajos queda
 * elástico y se atrasa respecto del papel. 0,35 sigue el movimiento de la mano
 * sin vibrar.
 */
const SUAVIZADO = 0.35;

/**
 * Cuándo se considera que la lectura nueva es de OTRO papel y no un temblor del
 * mismo.
 *
 * Si el salto es grande —se apuntó a otra hoja— suavizar haría que el marco
 * viaje despacio por la pantalla, cruzando lugares donde no hay nada. Ahí
 * conviene saltar de una.
 */
const SALTO_GRANDE = 0.25; // fracción del lado más largo del cuadro

/**
 * Convierte lecturas sueltas en un marco estable.
 *
 * Se le pasa lo que detectó cada cuadro —o `null` si no encontró nada— y
 * devuelve qué dibujar, o `null` para no dibujar nada.
 */
export class SeguidorDePapel {
  private mostrado: Cuadro | null = null;
  private aciertos = 0;
  private fallas = 0;

  observar(lectura: Cuadro | null): Cuadro | null {
    if (!lectura) {
      this.aciertos = 0;
      this.fallas++;
      if (this.fallas >= FALLAS_PARA_DESAPARECER) this.mostrado = null;
      return this.mostrado;
    }

    this.fallas = 0;
    this.aciertos++;
    if (this.aciertos < ACIERTOS_PARA_APARECER && !this.mostrado) return null;

    this.mostrado = this.mostrado ? acercar(this.mostrado, lectura) : lectura;
    return this.mostrado;
  }

  /** Lo que se está dibujando ahora, sin alimentar una lectura nueva. */
  get actual(): Cuadro | null {
    return this.mostrado;
  }

  /** Para volver a empezar: al reabrir la cámara o después de disparar. */
  reiniciar(): void {
    this.mostrado = null;
    this.aciertos = 0;
    this.fallas = 0;
  }
}

/** Mueve `desde` un paso hacia `hasta`, o salta si el cambio es grande. */
function acercar(desde: Cuadro, hasta: Cuadro): Cuadro {
  const escala = ladoMayor(hasta);
  const saltó = desde.some((p, i) => Math.hypot(p.x - hasta[i].x, p.y - hasta[i].y) > escala * SALTO_GRANDE);
  if (saltó) return hasta;

  return desde.map((p, i) => ({
    x: p.x + (hasta[i].x - p.x) * SUAVIZADO,
    y: p.y + (hasta[i].y - p.y) * SUAVIZADO,
  })) as Cuadro;
}

function ladoMayor(c: Cuadro): number {
  let mayor = 1;
  for (let i = 0; i < 4; i++) {
    const a = c[i];
    const b = c[(i + 1) % 4];
    mayor = Math.max(mayor, Math.hypot(a.x - b.x, a.y - b.y));
  }
  return mayor;
}

/**
 * Si el papel ocupa suficiente cuadro como para que valga la pena disparar.
 *
 * Sirve para decirle a la persona "acercate": una foto donde el comprobante
 * ocupa un cuarto de la pantalla se ve bien en el visor y después no se lee el
 * CAE. El umbral es bajo a propósito — es una sugerencia, no un impedimento.
 */
export function ocupaPoco(c: Cuadro, ancho: number, alto: number): boolean {
  const area = Math.abs(
    (c[0].x * c[1].y - c[1].x * c[0].y) +
      (c[1].x * c[2].y - c[2].x * c[1].y) +
      (c[2].x * c[3].y - c[3].x * c[2].y) +
      (c[3].x * c[0].y - c[0].x * c[3].y),
  ) / 2;
  return area < ancho * alto * 0.35;
}
