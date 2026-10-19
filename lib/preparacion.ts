// La preparación de un pedido en el depósito, calculada. Sin base de datos.
//
// El depósito tilda en el teléfono lo que junta. Lo tildado guarda la cantidad
// y la nota que tenía el pedido EN ESE MOMENTO. Comparar eso con el pedido de
// ahora dice qué cambió después de preparar y qué hay que hacer físicamente.
// Nada de esto se guarda: se calcula cada vez, como los faltantes, para que no
// pueda quedar desactualizado.

import { recortar } from "@/lib/aviso-texto";

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
      return i.note ? `${i.itemName}: nota "${recortar(i.note, 40)}"` : `${i.itemName}: sin nota`;
    default:
      return i.itemName;
  }
}

/** Por sector: lo preparado y al día, sobre todo lo que hay que mover (lo que
 *  pide el pedido más lo que hay que sacar). */
export function avancePorSector(items: ItemPreparacion[]): Map<string, { listos: number; total: number }> {
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
