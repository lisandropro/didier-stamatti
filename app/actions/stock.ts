"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";

export type UpdateStockResult = { ok: boolean; error?: string; newStock?: number };

/**
 * Ajusta el stock total de un producto reutilizable y registra el movimiento
 * (rotura / pérdida / compra / ajuste). Acepta el total resultante ya calculado.
 */
export async function updateStock(input: {
  productId: string;
  newStock: number;
  reason: string; // ROTURA | PERDIDA | COMPRA | AJUSTE
  note?: string;
}): Promise<UpdateStockResult> {
  // Verificación de acceso: solo el administrador edita el stock.
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (user.role !== "ADMIN") {
    return { ok: false, error: "Solo el administrador puede editar el stock." };
  }

  const product = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!product) return { ok: false, error: "Producto no encontrado" };
  if (product.type !== "REUTILIZABLE") {
    return { ok: false, error: "Los consumibles no llevan control de stock" };
  }

  const newStock = Math.max(0, Math.round(input.newStock));
  const delta = newStock - product.stock;
  const reason = ["ROTURA", "PERDIDA", "COMPRA", "AJUSTE"].includes(input.reason)
    ? input.reason
    : "AJUSTE";

  await prisma.$transaction([
    prisma.product.update({ where: { id: product.id }, data: { stock: newStock } }),
    prisma.stockMovement.create({
      data: {
        productId: product.id,
        delta,
        reason,
        note: input.note?.trim() || null,
      },
    }),
  ]);

  revalidatePath("/inventario");
  return { ok: true, newStock };
}
