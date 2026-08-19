// LA regla de faltante de la app, en un solo lugar y sin dependencias.
//
// Vive aparte de `lib/shortages.ts` (que consulta la base) para que también
// pueda usarla el armador de pedidos, que corre en el navegador y no puede
// importar Prisma. Así el aviso del pedido y el panel "Ver faltantes" no pueden
// discrepar: es la misma función.

/** Una fila de faltante, con todo lo necesario para entenderlo sin abrir el
 *  pedido. `available` y `missing` se derivan; no se guardan en ningún lado. */
export type ShortageRow = {
  productId: string;
  name: string;
  unit: string;
  rubro: string | null;
  /** Lo que pide ESTE evento. */
  requested: number;
  /** Lo que piden los OTROS eventos vivos del mismo período. */
  otherRequested: number;
  /** La suma de todos los eventos del finde. */
  totalRequested: number;
  /** Lo que hay en el depósito. Acá nunca es nulo: un faltante solo existe
   *  contra una cantidad conocida. Lo no contado se informa aparte. */
  stock: number;
  /** Lo que le queda a este evento una vez servidos los otros. */
  available: number;
  /** Cuánto falta para cubrir a todos. */
  missing: number;
  /** Los otros eventos solos ya se pasan del stock: el faltante no es "culpa"
   *  de este evento y no hay que atribuírselo. */
  causedByOthers: boolean;
};

export type ShortageInput = {
  productId: string;
  name: string;
  unit: string;
  rubro: string | null;
  type: string;
  stock: number | null;
  requested: number;
  otherRequested: number;
};

/**
 * Un producto falta cuando es reutilizable y lo que pide este evento más lo que
 * piden los otros eventos del mismo período supera el stock del depósito.
 * Los consumibles no cuentan: se compran para cada evento.
 *
 * Devuelve null si no falta nada.
 */
export function computeShortage(input: ShortageInput): ShortageRow | null {
  if (input.type !== "REUTILIZABLE") return null;
  // Sin recuento no hay faltante que calcular: no se sabe cuánto hay. Decir
  // que faltan 130 almohadones cuando nadie los contó es inventar un número,
  // y un aviso que miente deja de leerse. Eso se informa aparte, con
  // `necesitaRecuento`, que pide contar en vez de pedir comprar.
  if (input.stock === null) return null;
  const totalRequested = input.requested + input.otherRequested;
  if (totalRequested <= input.stock) return null;

  return {
    productId: input.productId,
    name: input.name,
    unit: input.unit,
    rubro: input.rubro,
    requested: input.requested,
    otherRequested: input.otherRequested,
    totalRequested,
    stock: input.stock,
    // Si los otros ya se comieron todo el stock, a este evento no le queda nada,
    // pero nunca se muestra un negativo.
    available: Math.max(0, input.stock - input.otherRequested),
    missing: totalRequested - input.stock,
    causedByOthers: input.otherRequested > input.stock,
  };
}

/**
 * Un producto que este evento pide pero que nadie contó todavía.
 *
 * No es un faltante: es una tarea de depósito. La acción que pide es
 * distinta —contar, no comprar— y le toca a otra persona, así que se muestra
 * en su propio bloque y no mezclado con lo que de verdad falta.
 */
export function necesitaRecuento(input: ShortageInput): boolean {
  return input.type === "REUTILIZABLE" && input.stock === null && input.requested > 0;
}

