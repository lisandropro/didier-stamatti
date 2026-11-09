import { prisma } from "./db";
import { validQuantity } from "./quantity";

export type StockInput = { productId: string; newStock: number; expectedStock: number | null; reason: string; note?: string };
export type StockResult = { ok: boolean; error?: string; newStock?: number };

/** `prisma` o el cliente de una transacción: lo que hace falta para mover el stock. */
type DbStock = Pick<typeof prisma, "product" | "stockMovement">;

/** No pisa un recuento hecho después de abrir el formulario. */
export async function saveStock(input: StockInput, userId: string): Promise<StockResult> {
  if (!validQuantity(input.newStock) || (input.expectedStock !== null && !validQuantity(input.expectedStock))) {
    return { ok: false, error: "Ingresá una cantidad entera válida." };
  }
  if (!["ROTURA", "PERDIDA", "COMPRA", "AJUSTE"].includes(input.reason)) return { ok: false, error: "Elegí un motivo válido." };
  if (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 1000)) return { ok: false, error: "La nota puede tener hasta 1000 caracteres." };
  return prisma.$transaction((tx) => moverStock(tx, input, userId));
}

/**
 * El cambio de stock en sí, dentro de una transacción ya abierta: escribe
 * `Product.stock` solo si sigue en `expectedStock`, y deja el movimiento con la
 * diferencia. Es el único camino que escribe el stock: el ajuste de Inventario
 * (`saveStock`) y la baja de lo que no volvió de un evento
 * (`descontarFaltante` en lib/levante-db.ts) pasan por acá, así el historial
 * cuadra siempre con el número.
 *
 * No valida la entrada: eso lo hace quien la arma.
 */
export async function moverStock(tx: DbStock, input: StockInput, userId: string): Promise<StockResult> {
  const product = await tx.product.findUnique({ where: { id: input.productId } });
  if (!product) return { ok: false, error: "Producto no encontrado." };
  if (product.type !== "REUTILIZABLE") return { ok: false, error: "Los consumibles no llevan control de stock." };
  const conflict = { ok: false, error: "El stock cambió mientras editabas. Cerrá este formulario y volvé a abrirlo con el valor actualizado." };
  if (product.stock !== input.expectedStock) return conflict;
  if (product.stock === input.newStock) return { ok: true, newStock: input.newStock };
  const changed = await tx.product.updateMany({ where: { id: product.id, stock: input.expectedStock, type: "REUTILIZABLE" }, data: { stock: input.newStock } });
  if (changed.count !== 1) return conflict;
  await tx.stockMovement.create({ data: {
    productId: product.id, delta: input.newStock - (product.stock ?? 0), reason: input.reason,
    note: input.note?.trim() || null, userId,
  } });
  return { ok: true, newStock: input.newStock };
}
