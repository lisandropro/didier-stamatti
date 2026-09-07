"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { canEditStock } from "@/lib/permissions";
import { saveStock, type StockInput } from "@/lib/stock";

export type UpdateStockResult = { ok: boolean; error?: string; newStock?: number };
export async function updateStock(input: StockInput): Promise<UpdateStockResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (!canEditStock(user.role)) return { ok: false, error: "Solo el administrador puede editar el stock." };
  const result = await saveStock(input, user.id);
  revalidatePath("/", "layout");
  return result;
}
