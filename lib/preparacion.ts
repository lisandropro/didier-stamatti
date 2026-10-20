// La preparación de un pedido en el depósito, calculada. Sin base de datos.
//
// El depósito tilda en el teléfono lo que junta. Lo tildado guarda la cantidad
// y la nota que se VEÍAN en la pantalla al tildar (ver `Visto`). Comparar eso
// con el pedido de ahora dice qué cambió después de preparar y qué hay que
// hacer físicamente.
// Nada de esto se guarda: se calcula cada vez, como los faltantes, para que no
// pueda quedar desactualizado.

import { recortar } from "@/lib/aviso-texto";
import { nombreDeCategoria, ordenDeCategoria } from "@/lib/categories";
import { validQuantity } from "@/lib/quantity";

export type EstadoItem = "PENDIENTE" | "PREPARADO" | "CAMBIO" | "NOTA" | "SACAR";

const ESTADOS: ReadonlySet<unknown> = new Set<EstadoItem>(["PENDIENTE", "PREPARADO", "CAMBIO", "NOTA", "SACAR"]);

/** ¿Es uno de los cinco estados? Lo que llega de la pantalla no se cree a ciegas. */
export function esEstado(x: unknown): x is EstadoItem {
  return ESTADOS.has(x);
}

/**
 * Lo que mostraba la fila cuando la tocaron: el estado, la cantidad y la nota
 * del pedido tal como se dibujaron.
 *
 * Tildar guarda ESTO y no lo que dice el pedido al llegar el toque. Entre que
 * se dibuja la pantalla y el toque puede pasar un minuto: si alguien cambió el
 * pedido en el medio, copiar el pedido de ahora dejaba preparado un número que
 * nadie vio, y el cambio desaparecía sin aviso. Guardando lo visto, el cambio
 * queda a la vista en "Cambios para aplicar".
 */
export type Visto = { estado: EstadoItem; qty: number; note: string | null };

/** Una fila pendiente de un sector tal como se veía al tocar "Tildar todo". */
export type VistoDeSector = { clave: string; qty: number; note: string | null };

// Lo visto llega del teléfono y se guarda tal cual, así que se comprueba como
// cualquier dato de afuera antes de escribirlo.

/** Una clave de ítem (ver `claveDeLinea`), con un tope de largo. */
export function esClave(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= 100;
}

/** La nota, con el mismo tope que tiene en el pedido. */
function esNota(x: unknown): x is string | null {
  return x === null || (typeof x === "string" && x.length <= 1000);
}

export function esVisto(x: unknown): x is Visto {
  if (typeof x !== "object" || x === null) return false;
  const v = x as Record<string, unknown>;
  return esEstado(v.estado) && validQuantity(v.qty) && esNota(v.note);
}

/** Lo visto de un sector entero. El tope es por si acaso: ningún sector de un
 *  pedido real llega a tanto. */
export function sonVistosDeSector(x: unknown): x is VistoDeSector[] {
  return (
    Array.isArray(x) &&
    x.length <= 500 &&
    x.every((fila: unknown) => {
      if (typeof fila !== "object" || fila === null) return false;
      const v = fila as Record<string, unknown>;
      return esClave(v.clave) && validQuantity(v.qty) && esNota(v.note);
    })
  );
}

/** Un renglón del pedido tal como está ahora. */
export type LineaPedido = {
  clave: string;
  itemName: string;
  unit: string;
  category: string;
  qty: number;
  note: string | null;
};

/** Lo que el depósito tildó: el renglón con la cantidad y la nota que se vieron al tildar. */
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

/** Dos notas son la misma si dicen lo mismo: nula, vacía y de puros espacios
 *  son "sin nota", y los espacios de los bordes no cuentan. */
export const mismaNota = (a: string | null, b: string | null) => (a ?? "").trim() === (b ?? "").trim();

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

/** Lo que el depósito tiene pendiente en un evento, como un texto comparable:
 *  qué ítems quedaron para rehacer, en qué estado y con qué cantidad y nota.
 *  Restaurar una versión compara la firma de antes y la de después para avisar
 *  solo si cambió algo.
 *
 *  Un suelto se identifica por nombre, sector y unidad, no por su clave:
 *  restaurar recrea los renglones y `reasignarSueltos` le cambia la clave
 *  aunque sea el mismo ítem. Comparado por clave, parecería un cambio que no hubo. */
export function firmaDePendientes(items: ItemPreparacion[]): string {
  return cambiosParaAplicar(items)
    .map((i) => {
      const quien = i.clave.startsWith("custom:") ? `suelto:${i.itemName}:${i.category}:${i.unit}` : i.clave;
      return `${quien}:${i.estado}:${i.qty}:${i.note ?? ""}`;
    })
    .sort()
    .join("|");
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

/**
 * Destildar es para deshacer un error de quien tilda, y solo vale sobre lo que
 * se vio: el ítem tiene que seguir PREPARADO con la cantidad y la nota que
 * mostraba la fila. Si no, el ✓ de la pantalla es viejo y debajo hay algo
 * nuevo ("Sumá 14"): destildar lo borraría sin que nadie lo lea.
 */
export function sePuedeDestildar(item: ItemPreparacion | undefined, visto: Visto): boolean {
  return visto.estado === "PREPARADO" && preparadoAsi(item, visto.qty, visto.note);
}

/** ¿Está preparado, y con esta cantidad y esta nota? */
function preparadoAsi(item: ItemPreparacion | undefined, qty: number, note: string | null): boolean {
  return item?.estado === "PREPARADO" && item.tildado !== null && item.tildado.qty === qty && mismaNota(item.tildado.note, note);
}

/**
 * "Tildar todo el sector" toma solo lo pendiente, y de eso solo lo que se vio
 * y sigue igual. Lo que cambió o hay que sacar implica mover algo físico y se
 * confirma de a uno; lo que entró al pedido después de dibujar la pantalla
 * nadie lo vio, así que no viene en `vistos` y queda pendiente.
 *
 * `salteados` son los vistos que no se tildan porque cambiaron (otra cantidad,
 * otra nota, otro estado, o ya no están): la pantalla avisa que hay que
 * revisarlos. Lo que otro teléfono ya tildó tal cual se veía no se cuenta ahí:
 * quedó como se quería y no hay nada que revisar.
 */
export function paraTildarSector(
  items: ItemPreparacion[],
  category: string,
  vistos: VistoDeSector[],
): { claves: string[]; salteados: number } {
  const porClave = new Map(items.map((i) => [i.clave, i]));
  const vistas = new Set<string>();
  const claves: string[] = [];
  let salteados = 0;
  for (const v of vistos) {
    if (vistas.has(v.clave)) continue;
    vistas.add(v.clave);
    const i = porClave.get(v.clave);
    const delSector = i !== undefined && i.category === category;
    if (delSector && i.estado === "PENDIENTE" && i.qty === v.qty && mismaNota(i.note, v.note)) {
      claves.push(v.clave);
    } else if (delSector && preparadoAsi(i, v.qty, v.note)) {
      // Ya tildado, y como se veía: nada que hacer ni que avisar.
    } else {
      salteados++;
    }
  }
  return { claves, salteados };
}
