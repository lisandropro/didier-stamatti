import { prisma } from "@/lib/db";
import { Historial } from "@/components/Historial";
import { fmtRange, fmtDateTime, startOfToday } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HistorialPage() {
  const today = startOfToday();

  const pastWeekends = await prisma.weekend.findMany({
    where: { endDate: { lt: today } },
    orderBy: { startDate: "desc" },
    include: {
      events: { select: { id: true } },
      snapshot: { select: { takenAt: true } },
    },
  });

  const movements = await prisma.stockMovement.findMany({
    orderBy: { createdAt: "desc" },
    include: { product: { select: { name: true, unit: true } } },
  });

  const data = {
    weekends: pastWeekends.map((w) => ({
      id: w.id,
      label: w.label,
      rangeLabel: fmtRange(w.startDate, w.endDate),
      eventCount: w.events.length,
      hasSnapshot: !!w.snapshot,
    })),
    movements: movements.map((m) => ({
      id: m.id,
      productName: m.product.name,
      unit: m.product.unit,
      delta: m.delta,
      reason: m.reason,
      note: m.note,
      dateLabel: fmtDateTime(m.createdAt),
    })),
  };

  return <Historial data={data} />;
}
