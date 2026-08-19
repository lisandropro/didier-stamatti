// Qué sectores entran en un pedido, y en cuál de sus formas.
//
// El pedido de un evento se puede despachar entero o sector por sector: a quien
// prepara la bebida no le sirven las hojas de mobiliario, y mandárselas hace que
// tenga que buscar la suya entre papeles que no le tocan.
//
// Vive aparte de la ruta del PDF y de la pantalla porque las dos necesitan
// exactamente la misma respuesta. Si cada una la calculara por su cuenta, el
// botón podría ofrecer un sector que el archivo después trae vacío.

import { CATEGORIES, CATEGORY_LABEL } from "@/lib/categories";

export type LineaDePedido = {
  categoria: string;
  esDeCatalogo: boolean;
};

export type SectorConPedido = {
  key: string;
  label: string;
  /** Cuántas líneas lleva. Es lo que se muestra al lado del botón: sirve para
   *  saber de un vistazo si vale la pena mandarlo. */
  lineas: number;
};

/**
 * Los sectores que tienen algo pedido, en el orden en que salen de la
 * impresora. Un sector vacío no se ofrece: mandar una hoja sin renglones es
 * peor que no mandar nada, porque quien la recibe cree que no falta cargar.
 */
export function sectoresConPedido(lineas: LineaDePedido[]): SectorConPedido[] {
  const cuenta = new Map<string, number>();
  for (const l of lineas) cuenta.set(l.categoria, (cuenta.get(l.categoria) ?? 0) + 1);

  return CATEGORIES.filter((c) => (cuenta.get(c) ?? 0) > 0).map((c) => ({
    key: c,
    label: CATEGORY_LABEL[c],
    lineas: cuenta.get(c)!,
  }));
}

/**
 * ¿Se puede pedir el pedido de este sector por separado?
 *
 * Se responde con los datos, no con la lista de categorías: un sector válido
 * pero sin nada pedido tampoco se puede despachar. La ruta del PDF la usa para
 * negarse antes de armar un archivo vacío.
 */
export function sePuedeDespachar(lineas: LineaDePedido[], sector: string): boolean {
  return sectoresConPedido(lineas).some((s) => s.key === sector);
}

/** El nombre del archivo, sin la extensión. El sector va adelante del lugar
 *  para que en el celular, donde el nombre se corta, igual se lea de qué es. */
export function nombreDeArchivo(lugar: string, dateLabel: string, sector?: string | null): string {
  const partes = ["Pedido"];
  if (sector) partes.push(CATEGORY_LABEL[sector] ?? sector);
  partes.push(lugar, dateLabel);
  return partes
    .join(" - ")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
