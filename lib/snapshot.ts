import { prisma } from "@/lib/db";

export type SnapshotLine = {
  eventId: string;
  productId: string | null;
  customName: string | null;
  customUnit: string | null;
  customCategory: string | null;
  qty: number;
  note: string | null;
};

/** Serializa los pedidos de un finde. Incluye `customCategory`: sin ella, al
 *  restaurar, los ítems fuera de catálogo perdían su sector y se imprimían
 *  todos en Enseres. */
export async function buildSnapshotData(periodId: string): Promise<{ data: string; lineCount: number }> {
  const events = await prisma.event.findMany({ where: { periodId, deletedAt: null }, select: { id: true } });
  const eventIds = events.map((e) => e.id);
  const lines = await prisma.orderLine.findMany({ where: { eventId: { in: eventIds } } });
  const payload: SnapshotLine[] = lines.map((l) => ({
    eventId: l.eventId,
    productId: l.productId,
    customName: l.customName,
    customUnit: l.customUnit,
    customCategory: l.customCategory,
    qty: l.qty,
    note: l.note,
  }));
  return { data: JSON.stringify(payload), lineCount: payload.length };
}

/** Crea la versión guardada de un finde solo si todavía no existe.
 *  Sin revalidatePath — seguro de llamar durante el render de una página
 *  (a diferencia de la server action equivalente en app/actions/snapshot.ts). */
export async function ensurePeriodSnapshot(periodId: string) {
  const existing = await prisma.periodSnapshot.findUnique({ where: { periodId } });
  if (existing) return existing;
  const { data } = await buildSnapshotData(periodId);
  return prisma.periodSnapshot.create({ data: { periodId, data } });
}

/** Guarda una copia recuperable del estado ACTUAL antes de pisarlo, y devuelve
 *  cuántas líneas quedaron resguardadas. Toda acción que reemplace los pedidos
 *  de un finde tiene que pasar por acá primero. */
export async function saveRecoverableVersion(
  periodId: string,
  kind: "PRE_DESCARTE" | "PRE_RESTAURACION",
  actor: { id: string; name: string }
): Promise<{ id: string; lineCount: number }> {
  const { data, lineCount } = await buildSnapshotData(periodId);
  const v = await prisma.periodVersion.create({
    data: { periodId, kind, data, lineCount, actorId: actor.id, actorName: actor.name },
  });
  return { id: v.id, lineCount };
}

/** Reemplaza los pedidos de un finde por los de un JSON de versión.
 *  Sólo toca eventos vivos: un evento en la papelera no revive por esto. */
export async function applySnapshotData(periodId: string, json: string): Promise<number> {
  const events = await prisma.event.findMany({ where: { periodId, deletedAt: null }, select: { id: true } });
  const validEventIds = new Set(events.map((e) => e.id));

  const parsed = JSON.parse(json) as SnapshotLine[];
  const toRestore = parsed.filter((l) => validEventIds.has(l.eventId));

  await prisma.$transaction([
    prisma.orderLine.deleteMany({ where: { eventId: { in: [...validEventIds] } } }),
    ...toRestore.map((l) =>
      prisma.orderLine.create({
        data: {
          eventId: l.eventId,
          productId: l.productId,
          customName: l.customName,
          customUnit: l.customUnit,
          customCategory: l.customCategory ?? null,
          qty: l.qty,
          note: l.note,
        },
      })
    ),
  ]);

  return toRestore.length;
}
