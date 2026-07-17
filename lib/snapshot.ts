import { prisma } from "@/lib/db";

export async function buildSnapshotData(weekendId: string): Promise<string> {
  const events = await prisma.event.findMany({ where: { weekendId }, select: { id: true } });
  const eventIds = events.map((e) => e.id);
  const lines = await prisma.orderLine.findMany({ where: { eventId: { in: eventIds } } });
  return JSON.stringify(
    lines.map((l) => ({
      eventId: l.eventId,
      productId: l.productId,
      customName: l.customName,
      customUnit: l.customUnit,
      qty: l.qty,
      note: l.note,
    }))
  );
}

/** Crea la versión guardada de un finde solo si todavía no existe.
 *  Sin revalidatePath — seguro de llamar durante el render de una página
 *  (a diferencia de la server action equivalente en app/actions/snapshot.ts). */
export async function ensureWeekendSnapshot(weekendId: string) {
  const existing = await prisma.weekendSnapshot.findUnique({ where: { weekendId } });
  if (existing) return existing;
  return prisma.weekendSnapshot.create({
    data: { weekendId, data: await buildSnapshotData(weekendId) },
  });
}
