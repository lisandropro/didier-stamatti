"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { enviarPrueba } from "@/lib/push";

/** Marca como leídos todos los avisos del usuario actual. */
export async function markAllRead(): Promise<{ ok: boolean }> {
  const user = await getSessionUser();
  if (!user) return { ok: false };
  await prisma.notification.updateMany({
    where: { recipientId: user.id, read: false },
    data: { read: true },
  });
  revalidatePath("/notificaciones");
  return { ok: true };
}

/** "Probar en este teléfono": manda un push solo a este dispositivo, que tiene
 *  que estar anotado a nombre de quien lo pide. */
export async function probarEsteDispositivo(endpoint: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > 2048) {
    return { ok: false, error: "No se reconoce este teléfono." };
  }
  return enviarPrueba(user.id, endpoint);
}
