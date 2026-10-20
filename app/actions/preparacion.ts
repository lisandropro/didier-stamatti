"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { canPreparar } from "@/lib/permissions";
import { esCategoria } from "@/lib/categories";
import { esClave, esVisto, sonVistosDeSector, type Visto, type VistoDeSector } from "@/lib/preparacion";
import { destildar, tildar, tildarSector } from "@/lib/preparacion-db";

/** `aviso`: salió bien, pero hay algo que mirar (no es un error, no bloquea). */
export type PrepResult = { ok: boolean; error?: string; count?: number; aviso?: string };

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

function revalidar(eventId: string) {
  revalidatePath("/preparar");
  revalidatePath(`/preparar/${eventId}`);
}

/** Tilda un ítem como preparado con lo que se vio en la fila. Si se vio para
 *  sacar, lo da por sacado. */
export async function tildarItem(eventId: string, clave: string, visto: Visto): Promise<PrepResult> {
  const { user, error } = await requerirPreparar(eventId);
  if (!user) return { ok: false, error: error! };
  // Lo visto se guarda tal cual: se comprueba como cualquier dato de afuera.
  if (!esClave(clave) || !esVisto(visto)) return { ok: false, error: "Ítem inválido." };
  const r = await tildar(eventId, clave, user, visto);
  if (r === "no-existe") return { ok: false, error: "Ese ítem ya no está en el pedido." };
  revalidar(eventId);
  return { ok: true };
}

/** Destilda un ítem: para cuando se tildó por error. Solo si sigue como se vio. */
export async function destildarItem(eventId: string, clave: string, visto: Visto): Promise<PrepResult> {
  const { user, error } = await requerirPreparar(eventId);
  if (!user) return { ok: false, error: error! };
  if (!esClave(clave) || !esVisto(visto)) return { ok: false, error: "Ítem inválido." };
  const r = await destildar(eventId, clave, visto);
  if (r === "cambio") return { ok: false, error: "Ese ítem cambió recién: revisá lo que hay que aplicar." };
  revalidar(eventId);
  return { ok: true };
}

/** Tilda lo pendiente de un sector que se vio y sigue igual. Lo que cambió
 *  mientras tanto no se tilda, y se avisa sin frenar el resto. */
export async function tildarSectorEntero(eventId: string, category: string, vistos: VistoDeSector[]): Promise<PrepResult> {
  const { user, error } = await requerirPreparar(eventId);
  if (!user) return { ok: false, error: error! };
  if (!esCategoria(category)) return { ok: false, error: "Sector inválido." };
  if (!sonVistosDeSector(vistos)) return { ok: false, error: "Ítems inválidos." };
  const { tildados, salteados } = await tildarSector(eventId, category, user, vistos);
  revalidar(eventId);
  if (salteados === 0) return { ok: true, count: tildados };
  const aviso =
    salteados === 1
      ? "1 ítem cambió mientras tanto y no se tildó: revisalo."
      : `${salteados} ítems cambiaron mientras tanto y no se tildaron: revisalos.`;
  return { ok: true, count: tildados, aviso };
}
