// Armado de la lista de un pedido para imprimir.
//
// El problema: un renglón de pedido es "nombre + cantidad", o sea que en una
// sola columna se desperdicia dos tercios del ancho de la hoja y un sector con
// muchos productos necesita varias hojas. Repartido en columnas, un pedido de
// más de cien ítems entra en una sola hoja y sigue siendo legible en el galpón.
//
// Este módulo lo usan la vista de impresión (HTML) y el PDF descargable, para
// que los dos salgan iguales.

export type PickItem = {
  id?: string;
  name: string;
  rubro?: string | null;
  unit: string | null;
  qty: number;
  note: string | null;
};

/** Un bloque es una fila de producto o un título de rubro. Se listan en el
 *  mismo flujo para poder repartirlos en columnas sin romper el orden. */
export type PickBlock =
  | { kind: "group"; label: string }
  | { kind: "row"; item: PickItem };

export const EXTRAS_LABEL = "Extras (fuera de catálogo)";

/** Alto aproximado de cada bloque, en renglones. Una nota agrega un renglón. */
export function blockUnits(b: PickBlock): number {
  return b.kind === "group" ? 1 : b.item.note ? 2 : 1;
}

/** Convierte los productos de un sector en bloques, agrupando por rubro.
 *  El rubro va como título de grupo y no repetido debajo de cada producto:
 *  ocupa un renglón por grupo en vez de uno por ítem, y de paso agrupa lo que
 *  está junto en el depósito. */
export function buildBlocks(products: PickItem[], customs: PickItem[]): PickBlock[] {
  const blocks: PickBlock[] = [];

  let rubro: string | null = null;
  for (const item of products) {
    const r = item.rubro ?? null;
    if (r !== rubro) {
      if (r) blocks.push({ kind: "group", label: r });
      rubro = r;
    }
    blocks.push({ kind: "row", item });
  }

  if (customs.length > 0) {
    blocks.push({ kind: "group", label: EXTRAS_LABEL });
    for (const item of customs) blocks.push({ kind: "row", item });
  }

  return blocks;
}

/** Cuántas columnas usar. Se decide por el alto total, no por la cantidad de
 *  ítems, porque las notas ocupan el doble.
 *
 *  Los umbrales son más bajos que la capacidad real de cada columna (ver
 *  UNITS_PER_COLUMN): la letra grande es la prioridad, así que se pasa a más
 *  columnas un poco antes de que haga falta, para no achicar el cuerpo. */
export function pickColumns(units: number): 1 | 2 | 3 {
  if (units <= 18) return 1;
  if (units <= 42) return 2;
  return 3;
}

export function totalUnits(blocks: PickBlock[]): number {
  return blocks.reduce((n, b) => n + blockUnits(b), 0);
}

/** Renglones que entran en una columna de A4 con la letra de cada densidad
 *  (ver los tamaños en `lib/pdf/OrderPdf.tsx` y el bloque `@media print` de
 *  `globals.css`, que tienen que coincidir con esto). Es conservador a
 *  propósito: preferimos que sobre un poco de blanco abajo antes que un
 *  pedido se corte en dos hojas por un renglón.
 *
 *  Se prioriza que se lea bien por sobre entrar siempre en una sola hoja: un
 *  pedido con más de ~90-100 productos en un sector puede necesitar una
 *  segunda hoja para ese sector (queda marcada "Hoja 1 de 2"). Es un caso
 *  raro — la mayoría de los pedidos reales tiene entre 20 y 80 productos por
 *  sector y entra holgado en una sola. */
const UNITS_PER_COLUMN: Record<number, number> = { 1: 24, 2: 26, 3: 30 };

/** Reparte los bloques en hojas y, dentro de cada hoja, en columnas que se
 *  llenan de arriba hacia abajo. Solo lo necesita el PDF: en HTML el corte de
 *  columna lo hace el navegador con `columns`. */
export function layoutColumns(blocks: PickBlock[], cols: number): PickBlock[][][] {
  const budget = UNITS_PER_COLUMN[cols] ?? 32;
  const pages: PickBlock[][][] = [];
  let page: PickBlock[][] = [];
  let col: PickBlock[] = [];
  let used = 0;

  const cutColumn = () => {
    page.push(col);
    col = [];
    used = 0;
    if (page.length === cols) {
      pages.push(page);
      page = [];
    }
  };

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const u = blockUnits(b);
    // Un título de rubro no queda solo al pie de una columna: para entrar tiene
    // que haber lugar también para el primer producto que va debajo.
    const needed = b.kind === "group" ? u + blockUnits(blocks[i + 1] ?? b) : u;
    if (used > 0 && used + needed > budget) cutColumn();
    col.push(b);
    used += u;
  }

  if (col.length > 0) page.push(col);
  if (page.length > 0) {
    while (page.length < cols) page.push([]);
    pages.push(page);
  }

  return pages.length > 0 ? pages : [[]];
}
