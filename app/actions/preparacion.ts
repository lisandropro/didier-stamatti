"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { canPreparar } from "@/lib/permissions";
import { esCategoria } from "@/lib/categories";
import { destildar, tildar, tildarSector } from "@/lib/preparacion-db";

export type PrepResult = { ok: boolean; error?: string; count?: number };

/** Tildar es escribir: lo decide el servidor, y solo sobre un evento vivo. */
async function requerirPreparar(eventId: string) {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Tenés que iniciar sesión." };
  if (!canPreparar(user.role)) return { user: null, error: "No tenés permiso para tildar la preparación." };
  if (typeof eventId !== "string" || eventId.length === 0 || eventId.length > 64) {
    return { user: null, error: "Evento inválido." };
  }
  const ev = await prisma.event.findFirst({
    where: { id: eventId, deletedAt: null, period: { deletedAt: null } },
    select: { id: true },
  });
  if (!ev) return { user: null, error: "El evento ya no está disponible." };
  return { user, error: null };
}

function claveValida(clave: unknown): clave is string {
  return typeof clave === "string" && clave.length > 0 && clave.length <= 100;
}

function revalidar(eventId: string) {
  revalidatePath("/preparar");
  revalidatePath(`/preparar/${eventId}`);
}

/** Tilda un ítem como preparado con lo que pide ahora el pedido. Si ya no va,
 *  lo da por sacado. */
export async function tildarItem(eventId: string, clave: string): Promise<PrepResult> {
  const { user, error } = await requerirPreparar(eventId);
  if (!user) return { ok: false, error: error! };
  if (!claveValida(clave)) return { ok: false, error: "Ítem inválido." };
  const r = await tildar(eventId, clave, user);
  if (r === "no-existe") return { ok: false, error: "Ese ítem ya no está en el pedido." };
  revalidar(eventId);
  return { ok: true };
}

/** Destilda un ítem: para cuando se tildó por error. */
export async function destildarItem(eventId: string, clave: string): Promise<PrepResult> {
  const { user, error } = await requerirPreparar(eventId);
  if (!user) return { ok: false, error: error! };
  if (!claveValida(clave)) return { ok: false, error: "Ítem inválido." };
  await destildar(eventId, clave);
  revalidar(eventId);
  return { ok: true };
}

/** Tilda todo lo pendiente de un sector. */
export async function tildarSectorEntero(eventId: string, category: string): Promise<PrepResult> {
  const { user, error } = await requerirPreparar(eventId);
  if (!user) return { ok: false, error: error! };
  if (!esCategoria(category)) return { ok: false, error: "Sector inválido." };
  const count = await tildarSector(eventId, category, user);
  revalidar(eventId);
  return { ok: true, count };
}
