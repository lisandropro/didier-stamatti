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
  /** Lo que piden los OTROS eventos vivos del mismo fin de semana. */
  otherRequested: number;
  /** La suma de todos los eventos del finde. */
  totalRequested: number;
  /** Lo que hay en el depósito. */
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
  stock: number;
  requested: number;
  otherRequested: number;
};

/**
 * Un producto falta cuando es reutilizable y lo que pide este evento más lo que
 * piden los otros eventos del mismo fin de semana supera el stock del depósito.
 * Los consumibles no cuentan: se compran para cada evento.
 *
 * Devuelve null si no falta nada.
 */
export function computeShortage(input: ShortageInput): ShortageRow | null {
  if (input.type !== "REUTILIZABLE") return null;
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
