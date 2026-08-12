"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { applySnapshotData, buildSnapshotData, saveRecoverableVersion } from "@/lib/snapshot";
import { canManagePeriods } from "@/lib/permissions";

export type SnapshotResult = {
  ok: boolean;
  error?: string;
  takenAt?: string;
  guardadas?: number;
  restauradas?: number;
};

function revalidar(periodId: string) {
  revalidatePath("/");
  revalidatePath(`/periodo/${periodId}`);
  revalidatePath("/historial");
}

/** Guarda (o actualiza) la "versión segura" de los pedidos de un período.
 *  Sirve como punto al que volver si algo se modifica por error.
 *  Invocada por el usuario (botón "Actualizar versión") — a diferencia de
 *  ensurePeriodSnapshot(), esta SÍ revalida rutas, por eso no puede llamarse
 *  durante el render de una página. */
export async function savePeriodSnapshot(periodId: string): Promise<SnapshotResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (!canManagePeriods(user.role)) return { ok: false, error: "No tenés permiso para cambiar las versiones guardadas." };

  const { data } = await buildSnapshotData(periodId);
  const snap = await prisma.periodSnapshot.upsert({
    where: { periodId },
    update: { data, takenAt: new Date() },
    create: { periodId, data },
  });

  revalidar(periodId);
  return { ok: true, takenAt: snap.takenAt.toISOString() };
}

/** Descarta los cambios hechos a los pedidos desde la última versión guardada.
 *  Antes de pisar nada guarda una copia recuperable del estado actual, así el
 *  descarte deja de ser un camino de ida. Solo afecta cantidades/notas de los
 *  pedidos, no los datos del evento ni si se agregó o borró un evento. */
export async function discardPeriodChanges(periodId: string): Promise<SnapshotResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (!canManagePeriods(user.role)) return { ok: false, error: "No tenés permiso para cambiar las versiones guardadas." };

  const snap = await prisma.periodSnapshot.findUnique({ where: { periodId } });
  if (!snap) return { ok: false, error: "Todavía no hay una versión guardada para este período." };

  // Primero el resguardo, después el descarte. Si el resguardo fallara, no se
  // pisa nada: es preferible no descartar a descartar sin poder volver.
  const resguardo = await saveRecoverableVersion(periodId, "PRE_DESCARTE", user);
  const restauradas = await applySnapshotData(periodId, snap.data);

  revalidar(periodId);
  return { ok: true, takenAt: snap.takenAt.toISOString(), guardadas: resguardo.lineCount, restauradas };
}

/** Vuelve a un estado guardado en el historial de versiones. Antes de aplicarlo
 *  resguarda el estado actual, para que también se pueda deshacer esta vuelta. */
export async function restorePeriodVersion(versionId: string): Promise<SnapshotResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (!canManagePeriods(user.role)) return { ok: false, error: "No tenés permiso para cambiar las versiones guardadas." };

  const version = await prisma.periodVersion.findUnique({ where: { id: versionId } });
  if (!version) return { ok: false, error: "No se encontró esa versión." };

  const resguardo = await saveRecoverableVersion(version.periodId, "PRE_RESTAURACION", user);
  const restauradas = await applySnapshotData(version.periodId, version.data);
  await prisma.periodVersion.update({ where: { id: versionId }, data: { restoredAt: new Date() } });

  revalidar(version.periodId);
  return { ok: true, guardadas: resguardo.lineCount, restauradas };
}
