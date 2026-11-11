// Qué hacer con un renglón del pedido cuando llega un guardado. Sin base.
//
// El armador guarda la fila entera: cantidad y nota. Con dos teléfonos sobre el
// mismo pedido eso pisaba datos: A subía Copa de agua de 100 a 150; B, que
// tenía el pedido abierto desde antes y seguía viendo 100, le agregaba una
// nota; el guardado de B mandaba `{ qty: 100, note }` y la cantidad volvía a
// 100, con un cambio "150 → 100" a nombre de B que B nunca hizo.
//
// El arreglo es el mismo criterio que ya usan el stock, la preparación y el
// levante: el teléfono manda además lo que VEÍA (`visto`). Un campo que llega
// igual a como se veía no se tocó, y lo que no se tocó no se escribe. Solo se
// guarda lo que la persona cambió de verdad.

import type { OrderChangeInput } from "@/lib/notify";

export type LineaGuardada = { qty: number; note: string | null };

/** Lo que mostraba la fila antes de este cambio. Sin esto (una pestaña vieja,
 *  de antes de este arreglo) se guarda la fila entera, como siempre. */
export type VistoDeLinea = { qty: number; note: string | null };

export type Resolucion =
  /** No hay nada que escribir. */
  | { accion: "nada"; cambios: [] }
  | { accion: "crear"; qty: number; note: string | null; cambios: OrderChangeInput[] }
  | { accion: "actualizar"; qty: number; note: string | null; cambios: OrderChangeInput[] }
  | { accion: "borrar"; cambios: OrderChangeInput[] }
  /** Se quiso cambiar solo la nota de un renglón que otro teléfono ya sacó. */
  | { accion: "ya-no-esta"; cambios: [] };

const limpia = (nota: string | null | undefined): string | null => nota?.trim() || null;

/**
 * Decide qué escribir.
 *
 * - `existente`: el renglón como está en la base ahora (null = no está).
 * - `pedido`: lo que mandó el teléfono (la fila entera).
 * - `visto`: lo que esa fila mostraba antes del cambio, o null si no vino.
 *
 * `qty` 0 quiere decir "no va": si la cantidad se tocó, el renglón se borra.
 *
 * Los `cambios` se arman contra lo que había en la base, no contra lo que veía
 * el teléfono: el aviso y el historial dicen lo que pasó de verdad.
 */
export function resolverLinea(
  nombre: string,
  existente: LineaGuardada | null,
  pedido: LineaGuardada,
  visto: VistoDeLinea | null,
  tardio = false,
): Resolucion {
  const nota = limpia(pedido.note);
  const tocoCantidad = visto === null || visto.qty !== pedido.qty;
  const tocoNota = visto === null || limpia(visto.note) !== nota;

  if (!existente) {
    // "No va" de algo que ya no está: quedó como se quería.
    if (pedido.qty === 0) return { accion: "nada", cambios: [] };
    if (!tocoCantidad) {
      // El teléfono veía el renglón y no le cambió la cantidad, pero el renglón
      // ya no está: otro teléfono lo sacó. Crearlo de nuevo sería deshacer eso
      // con un número que esta persona no eligió.
      return tocoNota ? { accion: "ya-no-esta", cambios: [] } : { accion: "nada", cambios: [] };
    }
    return {
      accion: "crear",
      qty: pedido.qty,
      note: nota,
      cambios: [{ itemName: nombre, kind: "AGREGADO", before: null, after: String(pedido.qty), tardio }],
    };
  }

  if (tocoCantidad && pedido.qty === 0) {
    return { accion: "borrar", cambios: [{ itemName: nombre, kind: "QUITADO", before: String(existente.qty), after: null, tardio }] };
  }

  const qty = tocoCantidad ? pedido.qty : existente.qty;
  const note = tocoNota ? nota : limpia(existente.note);
  const cambios: OrderChangeInput[] = [];
  if (existente.qty !== qty) {
    cambios.push({ itemName: nombre, kind: "CANTIDAD", before: String(existente.qty), after: String(qty), tardio });
  }
  if (limpia(existente.note) !== note) {
    cambios.push({ itemName: nombre, kind: "NOTA", before: existente.note, after: note, tardio });
  }
  // Si no cambió ni la cantidad ni la nota no se escribe ni se avisa: abrir un
  // pedido y volver a guardarlo no es una modificación.
  if (cambios.length === 0) return { accion: "nada", cambios: [] };
  return { accion: "actualizar", qty, note, cambios };
}

/** Lo visto llega del teléfono: se comprueba como cualquier dato de afuera.
 *  `undefined` y `null` valen (no vino); cualquier otra cosa tiene que ser una
 *  cantidad entera y una nota de texto o nula. */
export function esVistoDeLinea(x: unknown, esCantidad: (v: unknown) => boolean, maxNota: number): x is VistoDeLinea {
  if (typeof x !== "object" || x === null) return false;
  const v = x as Record<string, unknown>;
  return esCantidad(v.qty) && (v.note === null || (typeof v.note === "string" && v.note.length <= maxNota));
}
