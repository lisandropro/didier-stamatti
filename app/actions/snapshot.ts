"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { applySnapshotData, buildSnapshotData, saveRecoverableVersion } from "@/lib/snapshot";
import { canManageWeekends } from "@/lib/permissions";

export type SnapshotResult = {
  ok: boolean;
  error?: string;
  takenAt?: string;
  guardadas?: number;
  restauradas?: number;
};

function revalidar(weekendId: string) {
  revalidatePath("/");
  revalidatePath(`/finde/${weekendId}`);
  revalidatePath("/historial");
}

/** Guarda (o actualiza) la "versión segura" de los pedidos de un fin de semana.
 *  Sirve como punto al que volver si algo se modifica por error.
 *  Invocada por el usuario (botón "Actualizar versión") — a diferencia de
 *  ensureWeekendSnapshot(), esta SÍ revalida rutas, por eso no puede llamarse
 *  durante el render de una página. */
export async function saveWeekendSnapshot(weekendId: string): Promise<SnapshotResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (!canManageWeekends(user.role)) return { ok: false, error: "No tenés permiso para cambiar las versiones guardadas." };

  const { data } = await buildSnapshotData(weekendId);
  const snap = await prisma.weekendSnapshot.upsert({
    where: { weekendId },
    update: { data, takenAt: new Date() },
    create: { weekendId, data },
  });

  revalidar(weekendId);
  return { ok: true, takenAt: snap.takenAt.toISOString() };
}

/** Descarta los cambios hechos a los pedidos desde la última versión guardada.
 *  Antes de pisar nada guarda una copia recuperable del estado actual, así el
 *  descarte deja de ser un camino de ida. Solo afecta cantidades/notas de los
 *  pedidos, no los datos del evento ni si se agregó o borró un evento. */
export async function discardWeekendChanges(weekendId: string): Promise<SnapshotResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (!canManageWeekends(user.role)) return { ok: false, error: "No tenés permiso para cambiar las versiones guardadas." };

  const snap = await prisma.weekendSnapshot.findUnique({ where: { weekendId } });
  if (!snap) return { ok: false, error: "Todavía no hay una versión guardada para este fin de semana." };

  // Primero el resguardo, después el descarte. Si el resguardo fallara, no se
  // pisa nada: es preferible no descartar a descartar sin poder volver.
  const resguardo = await saveRecoverableVersion(weekendId, "PRE_DESCARTE", user);
  const restauradas = await applySnapshotData(weekendId, snap.data);

  revalidar(weekendId);
  return { ok: true, takenAt: snap.takenAt.toISOString(), guardadas: resguardo.lineCount, restauradas };
}

/** Vuelve a un estado guardado en el historial de versiones. Antes de aplicarlo
 *  resguarda el estado actual, para que también se pueda deshacer esta vuelta. */
export async function restoreWeekendVersion(versionId: string): Promise<SnapshotResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (!canManageWeekends(user.role)) return { ok: false, error: "No tenés permiso para cambiar las versiones guardadas." };

  const version = await prisma.weekendVersion.findUnique({ where: { id: versionId } });
  if (!version) return { ok: false, error: "No se encontró esa versión." };

  const resguardo = await saveRecoverableVersion(version.weekendId, "PRE_RESTAURACION", user);
  const restauradas = await applySnapshotData(version.weekendId, version.data);
  await prisma.weekendVersion.update({ where: { id: versionId }, data: { restoredAt: new Date() } });

  revalidar(version.weekendId);
  return { ok: true, guardadas: resguardo.lineCount, restauradas };
}
