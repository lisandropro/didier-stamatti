// Una vibración corta como respuesta a un toque, como en las apps del teléfono.
// En iPhone `navigator.vibrate` no existe; en la computadora existe pero no hace
// nada (no hay motor). Nunca rompe: una vibración que falla no puede tirar abajo
// un tilde.

export const PATRON = {
  tildar: 12,
  destildar: [8, 40, 8],
  tildarSector: 24,
} as const;

type ConVibracion = { vibrate?: (patron: number | number[]) => boolean };

export function vibrar(patron: number | readonly number[], nav: ConVibracion = typeof navigator === "undefined" ? {} : navigator) {
  try {
    nav.vibrate?.(typeof patron === "number" ? patron : [...patron]);
  } catch {
    // Sin vibración no pasa nada.
  }
}
