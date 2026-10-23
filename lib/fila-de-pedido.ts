// Lo que dice cada fila del armador de pedidos sobre su stock.
//
// Vive aparte del componente para poder probarlo. La fila ancha lo muestra
// como chip y barra; la compacta del celular, como una segunda línea que
// aparece solo cuando hay algo que decir.

export type NivelDeStock = "neutral" | "crit" | "warn" | "ok";
export type EstadoDeStock = { cls: NivelDeStock; txt: string };
export type AvisoDeFila = { cls: "crit" | "warn" | "neutral" | "nota"; txt: string };

type FilaDeStock = { type: string; stock: number | null; qty: number; reserved: number };

/** El estado de stock de una fila. null = nada que mostrar: es un consumible,
 *  o es reutilizable, este pedido no lo usa y alcanza. */
export function estadoDeStock(p: FilaDeStock): EstadoDeStock | null {
  if (p.type !== "REUTILIZABLE") return null;
  // Sin recuento no se puede decir si alcanza: no se sabe cuánto hay. Se avisa
  // que falta contarlo, que es lo único cierto.
  if (p.stock === null) return { cls: "neutral", txt: "Sin contar" };
  const total = p.qty + p.reserved;
  if (total > p.stock) return { cls: "crit", txt: `Faltan ${total - p.stock}` };
  if (total === p.stock && total > 0) return { cls: "warn", txt: "Al límite" };
  if (p.qty > 0) return { cls: "ok", txt: "Alcanza" };
  return null;
}

/** La segunda línea de la fila compacta del celular. Vacía = la fila ocupa una
 *  sola línea. "Alcanza" no se dice: es lo normal, y decirlo en cada fila
 *  duplicaría su alto sin informar nada. */
export function avisosDeFila(p: FilaDeStock & { note: string; deBaja?: boolean }): AvisoDeFila[] {
  const avisos: AvisoDeFila[] = [];
  // El chip "Dado de baja" ya está junto al nombre: acá va qué hacer.
  if (p.deBaja) avisos.push({ cls: "crit", txt: "Ya no está en el catálogo: poné 0" });
  const st = estadoDeStock(p);
  const cls = st?.cls;
  if (st && (cls === "crit" || cls === "warn")) avisos.push({ cls, txt: st.txt });
  // Sin contar importa solo si este pedido lo usa.
  if (st && cls === "neutral" && p.qty > 0) avisos.push({ cls, txt: st.txt });
  if (p.note) avisos.push({ cls: "nota", txt: `✎ ${p.note}` });
  return avisos;
}
