// Lo que llega de afuera, comprobado en un solo lugar y sin dependencias.
//
// Una server action es un endpoint público: los tipos de TypeScript describen lo
// que manda la pantalla, no lo que puede mandar cualquiera con una sesión. Cada
// acción comprueba en runtime lo que recibe, y lo hace con estas funciones para
// que la regla (qué es un id, cuánto puede medir un texto) sea una sola.

/** Largo máximo de un id. Los de la base son cuid (25 caracteres); el margen es
 *  para las claves de ítem (`custom:<id>`) y los uuid. */
export const MAX_ID = 64;

/** ¿Es un id? Un texto de 1 a 64 caracteres. No comprueba que exista: eso lo
 *  contesta la base. Sirve para que un objeto, un número o un texto de un mega
 *  no lleguen a la consulta. */
export function esId(valor: unknown): valor is string {
  return typeof valor === "string" && valor.length > 0 && valor.length <= MAX_ID;
}

/** Los topes de los textos que escribe una persona. Uno por dato, acá, para que
 *  la acción que crea y la que edita no puedan discrepar. */
export const TOPES = {
  /** Nombre de un período. */
  label: 60,
  /** Lugar (nombre) de un evento. El mismo que ya exigía `planEventEdit`. */
  lugar: 80,
  responsable: 60,
  /** Nombre de un producto o de un ítem suelto. */
  nombre: 120,
  descripcion: 300,
  rubro: 60,
  unidad: 30,
  /** Nota de un renglón o de un movimiento de stock. */
  nota: 1000,
  /** Invitados de un evento: un tope de cordura, no una regla del negocio. */
  invitados: 100_000,
} as const;

/** Recorta y normaliza un texto de una línea. Devuelve null si no es texto o
 *  quedó vacío. Los espacios repetidos (y los saltos de línea) pasan a uno solo. */
export function limpiar(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  if (!s) return null;
  return s.slice(0, max);
}

/** Igual, pero conserva los saltos de línea: una descripción larga los usa. */
export function limpiarTexto(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}

/**
 * Un texto opcional de una línea que NO se recorta en silencio: si se pasa del
 * tope, se rechaza. `limpiar` recorta porque en una sugerencia perder la cola
 * de un título no cambia nada; en el nombre de un producto o el lugar de un
 * evento, guardar algo distinto de lo que se escribió sí.
 *
 * - `{ ok: true, valor: null }`: no vino nada (undefined, null o vacío).
 * - `{ ok: false }`: no es texto, o es más largo que `max`.
 */
export function textoOpcional(v: unknown, max: number): { ok: true; valor: string | null } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, valor: null };
  if (typeof v !== "string") return { ok: false };
  const s = v.trim().replace(/\s+/g, " ");
  if (s.length > max) return { ok: false };
  return { ok: true, valor: s || null };
}

/** Como `textoOpcional`, pero conserva los saltos de línea (notas). */
export function notaOpcional(v: unknown, max: number): { ok: true; valor: string | null } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, valor: null };
  if (typeof v !== "string") return { ok: false };
  const s = v.trim();
  if (s.length > max) return { ok: false };
  return { ok: true, valor: s || null };
}
