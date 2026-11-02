// La decisión del gesto "tirar hacia abajo para actualizar", sin DOM, para
// poder probarla. El componente solo mide el dedo y dibuja.

/** Cuánto tiene que bajar el indicador (no el dedo) para que soltar actualice. */
export const UMBRAL = 70;
/** Hasta dónde baja el indicador aunque el dedo siga. */
export const MAXIMO = 96;

/** Dónde existe: las listas que se miran para ver si llegó algo. El editor del
 *  pedido no: ahí hay cantidades sin guardar y la pantalla no se recarga. */
export function pantallaConTiron(pathname: string): boolean {
  return pathname === "/" || pathname === "/preparar" || pathname.startsWith("/preparar/") || pathname === "/notificaciones";
}

/** dy y dx: cuánto se movió el dedo desde que tocó, hacia abajo y de costado.
 *  El indicador baja a la mitad (se siente "pesado", como en las apps). */
export function estadoDelTiron(dy: number, dx: number): { visible: boolean; y: number; listo: boolean } {
  if (dy <= 10 || Math.abs(dx) >= dy) return { visible: false, y: 0, listo: false };
  const y = Math.min(dy / 2, MAXIMO);
  return { visible: true, y, listo: y >= UMBRAL };
}
