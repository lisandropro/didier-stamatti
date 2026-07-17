"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { buildSnapshotData } from "@/lib/snapshot";

export type SnapshotResult = { ok: boolean; error?: string; takenAt?: string };

type SnapshotLine = {
  eventId: string;
  productId: string | null;
  customName: string | null;
  customUnit: string | null;
  qty: number;
  note: string | null;
};

/** Guarda (o actualiza) la "versión segura" de los pedidos de un fin de semana.
 *  Sirve como punto al que volver si algo se modifica por error.
 *  Invocada por el usuario (botón "Actualizar versión") — a diferencia de
 *  ensureWeekendSnapshot(), esta SÍ revalida rutas, por eso no puede llamarse
 *  durante el render de una página. */
export async function saveWeekendSnapshot(weekendId: string): Promise<SnapshotResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };

  const data = await buildSnapshotData(weekendId);
  const snap = await prisma.weekendSnapshot.upsert({
    where: { weekendId },
    update: { data, takenAt: new Date() },
    create: { weekendId, data },
  });

  revalidatePath("/");
  revalidatePath(`/finde/${weekendId}`);
  revalidatePath("/historial");
  return { ok: true, takenAt: snap.takenAt.toISOString() };
}

/** Descarta los cambios hechos a los pedidos desde la última versión guardada
 *  y restaura ese estado. Solo afecta cantidades/notas de los pedidos, no los
 *  datos del evento (lugar, fecha, invitados) ni si se agregó/borró un evento. */
export async function discardWeekendChanges(weekendId: string): Promise<SnapshotResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };

  const snap = await prisma.weekendSnapshot.findUnique({ where: { weekendId } });
  if (!snap) return { ok: false, error: "Todavía no hay una versión guardada para este fin de semana." };

  const events = await prisma.event.findMany({ where: { weekendId }, select: { id: true } });
  const validEventIds = new Set(events.map((e) => e.id));

  const data = JSON.parse(snap.data) as SnapshotLine[];
  const toRestore = data.filter((l) => validEventIds.has(l.eventId));

  await prisma.$transaction([
    prisma.orderLine.deleteMany({ where: { eventId: { in: [...validEventIds] } } }),
    ...toRestore.map((l) =>
      prisma.orderLine.create({
        data: {
          eventId: l.eventId,
          productId: l.productId,
          customName: l.customName,
          customUnit: l.customUnit,
          qty: l.qty,
          note: l.note,
        },
      })
    ),
  ]);

  revalidatePath("/");
  revalidatePath(`/finde/${weekendId}`);
  revalidatePath("/historial");
  return { ok: true, takenAt: snap.takenAt.toISOString() };
}
