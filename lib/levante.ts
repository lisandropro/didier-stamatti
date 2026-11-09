// El levante de un evento, calculado. Sin base de datos.
//
// Después de cada evento hay que juntar en el salón todo lo que se llevó y
// subirlo al camión. La lista es lo que fue al evento y tiene que volver: los
// renglones del pedido de productos reutilizables y los ítems sueltos. Los
// consumibles no vuelven y no aparecen.
//
// Lo marcado (volvió todo, o faltan N) se guarda por ítem en `Levante`. El
// estado de cada ítem se calcula comparando eso con el pedido de ahora, como en
// la preparación (lib/preparacion.ts): así no puede quedar desactualizado.

import { esClave } from "@/lib/preparacion";
import { MAX_CUERPO, recortar } from "@/lib/aviso-texto";
import { nombreDeCategoria, ordenDeCategoria } from "@/lib/categories";
import { partesDe } from "@/lib/dates";
import { validQuantity } from "@/lib/quantity";

export type EstadoLevante = "PENDIENTE" | "VOLVIO" | "FALTA";

/** Los dos motivos con que se da de baja lo que no volvió. Son los mismos
 *  `reason` de `StockMovement`: el historial del producto los muestra igual. */
export type MotivoBaja = "ROTURA" | "PERDIDA";

export function esMotivoBaja(x: unknown): x is MotivoBaja {
  return x === "ROTURA" || x === "PERDIDA";
}

/** "Rotura", "Pérdida". Un motivo desconocido (un dato viejo) se muestra tal cual. */
export function etiquetaDeMotivo(motivo: string): string {
  return motivo === "ROTURA" ? "Rotura" : motivo === "PERDIDA" ? "Pérdida" : motivo;
}

/** Hasta cuántos días para atrás sigue un evento en "Para levantar" si nadie
 *  termina su levante. Pasado eso ya no es una ayuda memoria: es historia. */
export const DIAS_PARA_LEVANTAR = 7;

/** ¿Este renglón del pedido tiene que volver del evento? Lo que se mandó (más
 *  de cero) de un producto reutilizable, o un ítem suelto: un suelto no dice si
 *  se consume, y es preferible que alguien lo tache a que se quede en el salón. */
export function vuelveDelEvento(l: { productId: string | null; productType: string | null; qty: number }): boolean {
  if (l.qty <= 0) return false;
  return l.productId === null || l.productType === "REUTILIZABLE";
}

/** El producto de una clave de ítem (ver `claveDeLinea`), o null si es un suelto. */
export function productoDeClave(clave: string): string | null {
  return clave.startsWith("custom:") ? null : clave;
}

/** Un renglón del pedido que vuelve, tal como está ahora. */
export type LineaLevante = {
  clave: string;
  itemName: string;
  unit: string;
  category: string;
  qty: number;
  note: string | null;
};

export type Descuento = { motivo: string; porName: string; at: Date };

/** Lo marcado de un ítem: lo que se mandó al marcar y cuántos no volvieron. */
export type Marca = {
  clave: string;
  itemName: string;
  unit: string;
  category: string;
  qty: number;
  faltan: number;
  porName: string;
  at: Date;
  descontado: Descuento | null;
};

export type ItemLevante = LineaLevante & {
  estado: EstadoLevante;
  /** Cuántos no volvieron. 0 si volvió todo o si todavía no se revisó. */
  faltan: number;
  marca: { porName: string; at: Date } | null;
  descontado: Descuento | null;
};

/**
 * El estado de cada ítem: lo que vuelve según el pedido, con lo marcado.
 *
 * Una marca vale si se hizo sobre la misma cantidad que pide el pedido ahora.
 * Si el pedido cambió después de marcar, el "faltan 2 de 40" ya no dice nada
 * sobre los 50 que figuran ahora: el ítem vuelve a quedar sin revisar.
 *
 * Lo descontado del stock es la excepción: ya movió el stock y no se deshace,
 * así que se muestra siempre como se marcó, aunque el renglón haya cambiado o
 * ya no esté. Una marca sin descontar de un ítem que ya no está en el pedido no
 * se muestra: la lista es lo que fue al evento.
 */
export function itemsDeLevante(lineas: LineaLevante[], marcas: Marca[]): ItemLevante[] {
  const porClave = new Map(marcas.map((m) => [m.clave, m]));
  const enPedido = new Set<string>();
  const items: ItemLevante[] = [];
  const deMarca = (m: Marca, note: string | null): ItemLevante => ({
    clave: m.clave,
    itemName: m.itemName,
    unit: m.unit,
    category: m.category,
    qty: m.qty,
    note,
    estado: m.faltan > 0 ? "FALTA" : "VOLVIO",
    faltan: m.faltan,
    marca: { porName: m.porName, at: m.at },
    descontado: m.descontado,
  });

  for (const l of lineas) {
    enPedido.add(l.clave);
    const m = porClave.get(l.clave);
    if (m && (m.descontado || m.qty === l.qty)) items.push(deMarca(m, l.note));
    else items.push({ ...l, estado: "PENDIENTE", faltan: 0, marca: null, descontado: null });
  }
  for (const m of marcas) {
    if (!enPedido.has(m.clave) && m.descontado) items.push(deMarca(m, null));
  }
  return items;
}

/** Por sector y, dentro del sector, por nombre. Es el orden en que llegan a la
 *  pantalla; `seccionesDeLevante` después sube lo pendiente. Devuelve una copia:
 *  ordenar en el lugar reacomodaría el arreglo de quien la llama sin avisar. */
export function ordenarLevante<T extends { category: string; itemName: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => ordenDeCategoria(a.category) - ordenDeCategoria(b.category) || a.itemName.localeCompare(b.itemName, "es"),
  );
}

/** Un sector tal como lo dibuja la pantalla del levante. */
export type SectorDeLevante<T> = {
  category: string;
  label: string;
  total: number;
  /** Lo revisado: volvió todo o faltan. */
  marcados: number;
  pendientes: number;
  /** Lo pendiente arriba y lo revisado abajo, cada parte en el orden en que llegó. */
  filas: T[];
};

/**
 * Cómo se reparten los ítems en la pantalla: un bloque por sector, con lo
 * pendiente arriba. Lo que se marca baja al final de su sector y lo que falta
 * revisar queda a mano, sin scrollear por encima de lo ya hecho.
 *
 * Los sectores salen de los ítems (como en Preparar): una categoría vieja o
 * desconocida se ve y se marca igual, al final y en orden alfabético.
 */
export function seccionesDeLevante<T extends { category: string; estado: EstadoLevante }>(items: T[]): SectorDeLevante<T>[] {
  const porSector = new Map<string, T[]>();
  for (const i of items) {
    const del = porSector.get(i.category);
    if (del) del.push(i);
    else porSector.set(i.category, [i]);
  }
  return [...porSector.entries()]
    // Comparación de texto simple, no `localeCompare`: el orden tiene que salir
    // igual en el servidor y en el navegador.
    .sort(([a], [b]) => ordenDeCategoria(a) - ordenDeCategoria(b) || (a < b ? -1 : a > b ? 1 : 0))
    .map(([category, del]) => {
      const pendientes = del.filter((i) => i.estado === "PENDIENTE");
      return {
        category,
        label: nombreDeCategoria(category),
        total: del.length,
        marcados: del.length - pendientes.length,
        pendientes: pendientes.length,
        filas: [...pendientes, ...del.filter((i) => i.estado !== "PENDIENTE")],
      };
    });
}

export type ResumenDeLevante = {
  total: number;
  marcados: number;
  sinRevisar: number;
  /** Lo que no volvió, en el orden de la lista. */
  faltantes: { itemName: string; faltan: number }[];
};

/** Las cuentas del levante: la tarjeta ("Levante · N de M"), la confirmación
 *  de terminar ("Quedan N sin revisar") y el aviso salen de acá. */
export function resumenDeLevante(items: { itemName: string; estado: EstadoLevante; faltan: number }[]): ResumenDeLevante {
  const sinRevisar = items.filter((i) => i.estado === "PENDIENTE").length;
  return {
    total: items.length,
    marcados: items.length - sinRevisar,
    sinRevisar,
    faltantes: items.filter((i) => i.estado === "FALTA").map((i) => ({ itemName: i.itemName, faltan: i.faltan })),
  };
}

/** Una fila pendiente de un sector tal como se veía al tocar "Tachar todo". */
export type VistoDeLevante = { clave: string; qty: number };

/** Lo visto de un sector entero, comprobado como cualquier dato de afuera. El
 *  tope es por si acaso: ningún sector de un pedido real llega a tanto. */
export function sonVistosDeLevante(x: unknown): x is VistoDeLevante[] {
  return (
    Array.isArray(x) &&
    x.length <= 500 &&
    x.every((fila: unknown) => {
      if (typeof fila !== "object" || fila === null) return false;
      const v = fila as Record<string, unknown>;
      return esClave(v.clave) && validQuantity(v.qty);
    })
  );
}

/** "¿Cuántos faltan?": al menos 1 (cero es "volvió todo", que es otro toque) y
 *  como mucho lo que se mandó. */
export function esFaltaValida(faltan: unknown, mandado: unknown): boolean {
  return validQuantity(mandado, 1) && validQuantity(faltan, 1) && (faltan as number) <= (mandado as number);
}

/**
 * "Tachar todo el sector" toma solo lo pendiente del sector que se vio y sigue
 * igual. Lo que entró al pedido después de dibujar la pantalla nadie lo vio,
 * así que no viene en `vistos` y queda pendiente.
 *
 * `salteados` son los vistos que no se marcan porque cambiaron (otra cantidad,
 * ya no están, otro teléfono les marcó un faltante): la pantalla avisa que hay
 * que revisarlos. Lo que otro teléfono ya marcó como "volvió todo" quedó como
 * se quería y no se cuenta.
 */
export function paraMarcarSector(
  items: ItemLevante[],
  category: string,
  vistos: VistoDeLevante[],
): { claves: string[]; salteados: number } {
  const porClave = new Map(items.map((i) => [i.clave, i]));
  const vistas = new Set<string>();
  const claves: string[] = [];
  let salteados = 0;
  for (const v of vistos) {
    if (vistas.has(v.clave)) continue;
    vistas.add(v.clave);
    const i = porClave.get(v.clave);
    const igual = i !== undefined && i.category === category && i.qty === v.qty;
    if (igual && i.estado === "PENDIENTE") claves.push(v.clave);
    else if (igual && i.estado === "VOLVIO") {
      // Ya marcado como se quería: nada que hacer ni que avisar.
    } else salteados++;
  }
  return { claves, salteados };
}

// ---------------------------------------------------------------------------
// El aviso de fin de levante
// ---------------------------------------------------------------------------

/** A dónde lleva el aviso al tocarlo, y la tarjeta de "Para levantar". */
export function linkDelLevante(eventId: string): string {
  return `/preparar/${eventId}/levante`;
}

/** Cuántos faltantes se nombran en el aviso; el resto se cuenta ("y 2 más"). */
const MAX_EN_EL_AVISO = 3;
// El lugar y el nombre de quien terminó los escribe una persona y no tienen
// tope: acotados, no se comen el detalle.
const MAX_LUGAR = 60;
const MAX_QUIEN = 60;

/** "a", "a y b", "a, b y c". */
function enLista(partes: string[]): string {
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

/**
 * El aviso que le llega a quien toca el stock al terminar un levante.
 *
 * - `mensaje`, para la lista de Avisos: "Levante de MUSEO: faltaron 5 Copa vino
 *   y 2 Mantel redondo".
 * - `title` y `body`, para el push: "Levante de MUSEO" / "Faltaron 5 Copa vino
 *   y 2 Mantel redondo", firmado con quien lo terminó.
 *
 * No promete nada que no se marcó: "volvió todo" solo si se revisó todo. Si
 * quedó algo sin revisar, lo revisado que volvió es "volvió todo lo revisado"
 * y se dice cuánto quedó sin revisar.
 */
export function textoDelLevante(
  lugar: string,
  items: { itemName: string; estado: EstadoLevante; faltan: number }[],
  porName: string,
): { title: string; body: string; mensaje: string } {
  const { faltantes, sinRevisar, marcados } = resumenDeLevante(items);
  const partes: string[] = [];
  if (faltantes.length > 0) {
    const nombrados = faltantes.slice(0, MAX_EN_EL_AVISO).map((f) => `${f.faltan} ${f.itemName}`);
    const resto = faltantes.length - nombrados.length;
    const lista = resto > 0 ? `${nombrados.join(", ")} y ${resto} más` : enLista(nombrados);
    const verbo = faltantes.length === 1 && faltantes[0].faltan === 1 ? "faltó" : "faltaron";
    partes.push(`${verbo} ${lista}`);
  } else if (sinRevisar === 0) {
    partes.push("volvió todo");
  } else if (marcados > 0) {
    partes.push("volvió todo lo revisado");
  }
  if (sinRevisar > 0) partes.push(`${sinRevisar} sin revisar`);
  const detalle = partes.join(" · ");
  const titulo = `Levante de ${recortar(lugar, MAX_LUGAR)}`;
  const pie = `\n— ${recortar(porName, MAX_QUIEN)}`;
  return {
    title: titulo,
    body: recortar(detalle.charAt(0).toUpperCase() + detalle.slice(1), MAX_CUERPO - pie.length) + pie,
    mensaje: recortar(`${titulo}: ${detalle}`, MAX_CUERPO),
  };
}

// ---------------------------------------------------------------------------
// Dar de baja lo que no volvió
// ---------------------------------------------------------------------------

/** Si un faltante se puede descontar del stock y, si no, por qué. */
export type Baja = "DESCONTABLE" | "SUELTO" | "NO_LLEVA_STOCK" | "SIN_CONTAR" | "SIN_STOCK";

/**
 * Lo decide el producto como está ahora:
 * - un ítem suelto no tiene producto ni stock: queda anotado y nada más;
 * - un consumible no lleva stock (pudo pasar a consumible después del evento);
 * - un producto que nunca se contó no tiene de dónde descontar: "hay cero" y
 *   "nunca se contó" son cosas distintas (ver `Product.stock`), e inventar un
 *   número sería peor que no descontar;
 * - con el stock ya en 0 no hay nada que bajar.
 */
export function bajaDe(clave: string, producto: { type: string; stock: number | null } | null): Baja {
  if (productoDeClave(clave) === null) return "SUELTO";
  if (!producto || producto.type !== "REUTILIZABLE") return "NO_LLEVA_STOCK";
  if (producto.stock === null) return "SIN_CONTAR";
  if (producto.stock === 0) return "SIN_STOCK";
  return "DESCONTABLE";
}

/** Por qué un faltante no se puede descontar, como lo lee la administradora. */
export const TEXTO_DE_BAJA: Record<Exclude<Baja, "DESCONTABLE">, string> = {
  SUELTO: "Ítem suelto: no lleva stock, queda anotado.",
  NO_LLEVA_STOCK: "No lleva control de stock: queda anotado.",
  SIN_CONTAR: "Nunca se contó en el inventario: contalo antes de descontar.",
  SIN_STOCK: "El stock ya está en 0: no hay nada que descontar.",
};

/** Lo que queda al dar de baja lo que no volvió. Nunca menos de 0: si el evento
 *  llevó más de lo que hay en el depósito (se completó con algo alquilado o
 *  prestado), el stock no puede quedar negativo. */
export function stockDespuesDeBaja(stock: number, faltan: number): number {
  return Math.max(0, stock - faltan);
}

/** La nota del movimiento de stock: "Levante de MUSEO 8/11", con el día del
 *  evento en Argentina. Es lo que se lee en el historial del producto. */
export function notaDeBaja(lugar: string, fecha: Date): string {
  const p = partesDe(fecha);
  return `Levante de ${recortar(lugar, MAX_LUGAR)} ${p.day}/${p.month}`;
}
