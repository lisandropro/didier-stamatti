// La preparación de un pedido en el depósito, calculada. Sin base de datos.
//
// El depósito tilda en el teléfono lo que junta. Lo tildado guarda la cantidad
// y la nota que tenía el pedido EN ESE MOMENTO. Comparar eso con el pedido de
// ahora dice qué cambió después de preparar y qué hay que hacer físicamente.
// Nada de esto se guarda: se calcula cada vez, como los faltantes, para que no
// pueda quedar desactualizado.

import { recortar } from "@/lib/aviso-texto";
import { nombreDeCategoria, ordenDeCategoria } from "@/lib/categories";

export type EstadoItem = "PENDIENTE" | "PREPARADO" | "CAMBIO" | "NOTA" | "SACAR";

/** Un renglón del pedido tal como está ahora. */
export type LineaPedido = {
  clave: string;
  itemName: string;
  unit: string;
  category: string;
  qty: number;
  note: string | null;
};

/** Lo que el depósito tildó: copia del renglón en el momento de tildar. */
export type Tildado = LineaPedido & { porName: string; at: Date };

export type ItemPreparacion = {
  clave: string;
  itemName: string;
  unit: string;
  category: string;
  /** Lo que pide el pedido ahora. 0 si ya no va. */
  qty: number;
  note: string | null;
  tildado: { qty: number; note: string | null; porName: string; at: Date } | null;
  estado: EstadoItem;
  /** Qué hay que hacer físicamente, si hay algo: "Sumá 14", "Sacá 6". */
  accion: string | null;
};

/** El ítem, no el renglón: si el renglón se borra, lo tildado sigue diciendo
 *  "sacá esto". Los sueltos no tienen producto: su renglón es el ítem. */
export function claveDeLinea(linea: { id: string; productId: string | null }): string {
  return linea.productId ?? `custom:${linea.id}`;
}

const mismaNota = (a: string | null, b: string | null) => (a ?? "").trim() === (b ?? "").trim();

/**
 * El estado de cada ítem: lo que pide el pedido, más lo tildado que ya no está.
 *
 * Si cambiaron la cantidad Y la nota, manda la cantidad: es lo que obliga a
 * mover cosas. La nota nueva se ve igual en la fila.
 */
export function estadoDeItems(lineas: LineaPedido[], tildados: Tildado[]): ItemPreparacion[] {
  const porClave = new Map(tildados.map((t) => [t.clave, t]));
  const enPedido = new Set<string>();
  const items: ItemPreparacion[] = [];

  for (const l of lineas) {
    if (l.qty <= 0) continue;
    enPedido.add(l.clave);
    const t = porClave.get(l.clave);
    const tildado = t ? { qty: t.qty, note: t.note, porName: t.porName, at: t.at } : null;
    let estado: EstadoItem = "PENDIENTE";
    let accion: string | null = null;
    if (t && t.qty !== l.qty) {
      estado = "CAMBIO";
      const dif = l.qty - t.qty;
      accion = dif > 0 ? `Sumá ${dif}` : `Sacá ${-dif}`;
    } else if (t && !mismaNota(t.note, l.note)) {
      estado = "NOTA";
      accion = "Cambió la nota";
    } else if (t) {
      estado = "PREPARADO";
    }
    items.push({ ...l, tildado, estado, accion });
  }

  // Lo tildado que ya no está en el pedido hay que sacarlo de lo preparado.
  for (const t of tildados) {
    if (enPedido.has(t.clave)) continue;
    items.push({
      clave: t.clave,
      itemName: t.itemName,
      unit: t.unit,
      category: t.category,
      qty: 0,
      note: null,
      tildado: { qty: t.qty, note: t.note, porName: t.porName, at: t.at },
      estado: "SACAR",
      accion: `Sacá ${t.qty} · ya no va`,
    });
  }
  return items;
}

const PARA_APLICAR: ReadonlySet<EstadoItem> = new Set(["CAMBIO", "NOTA", "SACAR"]);

/** Lo que cambió después de preparar y todavía nadie aplicó en lo físico. */
export function cambiosParaAplicar(items: ItemPreparacion[]): ItemPreparacion[] {
  return items.filter((i) => PARA_APLICAR.has(i.estado));
}

/** Un ítem en este estado no se resuelve de un toque: darlo por hecho sin
 *  querer borraría la instrucción ("sumá 14"). Lo decide el estado, no el lugar
 *  de la pantalla donde se dibuja la fila. */
export function pideConfirmacion(estado: EstadoItem): boolean {
  return PARA_APLICAR.has(estado);
}

/** Un sector tal como lo dibuja la pantalla de preparar. */
export type SectorDePantalla<T> = {
  category: string;
  label: string;
  /** Todo lo del sector, esté donde esté en la pantalla. */
  total: number;
  listos: number;
  pendientes: number;
  /** Las filas que se dibujan en el sector: sin lo que ya está arriba, en "Cambios para aplicar". */
  filas: T[];
};

/**
 * Cómo se reparten los ítems en la pantalla de preparar: arriba lo que hay que
 * aplicar, después un bloque por sector.
 *
 * El avance de cada sector cuenta todo (preparados sobre todo lo que hay que
 * mover), pero lo que ya está arriba no se repite en `filas`: dos filas del
 * mismo ítem hacen dudar de si se tildó dos veces.
 *
 * Los sectores salen de los propios ítems, no de la lista de categorías: un
 * ítem con una categoría vieja o desconocida tiene que verse y poder tildarse,
 * no desaparecer de la pantalla del depósito. Esos van al final
 * (`ordenDeCategoria`), en orden alfabético para que siempre salgan igual.
 *
 * Es genérica porque la pantalla trabaja con la versión serializada del ítem
 * (sin fechas), que no es un `ItemPreparacion` pero tiene lo que acá se mira.
 */
export function seccionesDePantalla<T extends { category: string; estado: EstadoItem }>(
  items: T[],
): { paraAplicar: T[]; sectores: SectorDePantalla<T>[] } {
  const porSector = new Map<string, T[]>();
  for (const i of items) {
    const del = porSector.get(i.category);
    if (del) del.push(i);
    else porSector.set(i.category, [i]);
  }
  // El avance sale de la misma cuenta que usa la lista de eventos: un número
  // que se calcula no se calcula dos veces de dos maneras.
  const avance = avancePorSector(items);
  const sectores = [...porSector.entries()]
    // Comparación de texto simple, no `localeCompare`: el orden tiene que salir
    // igual en el servidor y en el navegador.
    .sort(([a], [b]) => ordenDeCategoria(a) - ordenDeCategoria(b) || (a < b ? -1 : a > b ? 1 : 0))
    .map(([category, delSector]) => ({
      category,
      label: nombreDeCategoria(category),
      total: avance.get(category)?.total ?? 0,
      listos: avance.get(category)?.listos ?? 0,
      pendientes: delSector.filter((i) => i.estado === "PENDIENTE").length,
      filas: delSector.filter((i) => !PARA_APLICAR.has(i.estado)),
    }));
  return { paraAplicar: items.filter((i) => PARA_APLICAR.has(i.estado)), sectores };
}

/** Una acción como la lee el que prepara en el push: "Sumá 14 Copas de agua",
 *  "Sacá 3 Braseros". Sacar parte de un ítem o el ítem entero es la misma
 *  acción física; la pantalla dice además "ya no va". */
export function textoDeAccion(i: ItemPreparacion): string {
  switch (i.estado) {
    case "CAMBIO":
      return `${i.accion} ${i.itemName}`;
    case "SACAR":
      return `Sacá ${i.tildado?.qty ?? 0} ${i.itemName}`;
    case "NOTA":
      // Una nota de puros espacios es una nota borrada (ver mismaNota).
      return i.note?.trim() ? `${i.itemName}: nota "${recortar(i.note.trim(), 40)}"` : `${i.itemName}: sin nota`;
    default:
      return i.itemName;
  }
}

/** Por sector: lo preparado y al día, sobre todo lo que hay que mover (lo que
 *  pide el pedido más lo que hay que sacar). */
export function avancePorSector(items: { category: string; estado: EstadoItem }[]): Map<string, { listos: number; total: number }> {
  const out = new Map<string, { listos: number; total: number }>();
  for (const i of items) {
    const a = out.get(i.category) ?? { listos: 0, total: 0 };
    a.total++;
    if (i.estado === "PREPARADO") a.listos++;
    out.set(i.category, a);
  }
  return out;
}

/** "Tildar todo el sector" toma solo lo pendiente. Lo que cambió o hay que
 *  sacar implica mover algo físico y se confirma de a uno. */
export function clavesParaTildarSector(items: ItemPreparacion[], category: string): string[] {
  return items.filter((i) => i.category === category && i.estado === "PENDIENTE").map((i) => i.clave);
}
