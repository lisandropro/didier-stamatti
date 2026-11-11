"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { canEditStock } from "@/lib/permissions";
import { saveStock, type StockInput } from "@/lib/stock";
import { esId } from "@/lib/entrada";

export type UpdateStockResult = { ok: boolean; error?: string; newStock?: number };
export async function updateStock(input: StockInput): Promise<UpdateStockResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (!canEditStock(user.role)) return { ok: false, error: "Solo el administrador puede editar el stock." };
  // Lo que llega es un objeto con el id de un producto: `saveStock` comprueba
  // las cantidades, el motivo y la nota, pero no esto, y `null` o un id que no
  // es texto terminaban en una excepción cruda.
  if (typeof input !== "object" || input === null || !esId(input.productId)) {
    return { ok: false, error: "Producto no encontrado." };
  }
  const result = await saveStock(input, user.id);
  // El stock se ve en Inventario, en el historial y en los faltantes de cada
  // período: todo el árbol. También cuando no se guardó: si fue porque el stock
  // cambió mientras se editaba, la pantalla tiene que mostrar el valor de ahora.
  revalidatePath("/", "layout");
  return result;
}
