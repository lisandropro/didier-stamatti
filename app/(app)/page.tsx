import { prisma } from "@/lib/db";
import { WeekendHub } from "@/components/WeekendHub";
import { fmtEventDate, fmtRange, fmtDateTime, startOfToday } from "@/lib/format";
import { ensureWeekendSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ w?: string }>;
}) {
  const sp = await searchParams;

  const weekends = await prisma.weekend.findMany({
    orderBy: { startDate: "desc" },
    include: {
      events: {
        orderBy: { date: "asc" },
        include: { _count: { select: { lines: true } } },
      },
    },
  });

  const selected = weekends.find((w) => w.id === sp.w) ?? weekends[0] ?? null;

  const today = startOfToday();
  // El selector de "Fin de semana" solo muestra los actuales/próximos —
  // los que ya pasaron viven en Historial (salvo el que estás mirando ahora).
  const dropdownWeekends = weekends.filter((w) => w.endDate >= today || w.id === selected?.id);

  // Aviso de stock: suma de cada reutilizable entre todos los eventos del finde
  const overProducts: { name: string; total: number; stock: number }[] = [];
  let okCount = 0;
  let totalReut = 0;
  let isPast = false;
  let snapshotTakenAt: string | null = null;

  if (selected) {
    isPast = selected.endDate < today;

    const lines = await prisma.orderLine.findMany({
      where: { event: { weekendId: selected.id } },
      select: { productId: true, qty: true },
    });
    const totals = new Map<string, number>();
    for (const l of lines) {
      if (l.productId) totals.set(l.productId, (totals.get(l.productId) ?? 0) + l.qty);
    }
    const reut = await prisma.product.findMany({
      where: { type: "REUTILIZABLE" },
      select: { id: true, name: true, stock: true },
    });
    totalReut = reut.length;
    for (const p of reut) {
      const t = totals.get(p.id) ?? 0;
      if (t > p.stock) overProducts.push({ name: p.name, total: t, stock: p.stock });
      else okCount++;
    }
    overProducts.sort((a, b) => b.total - b.stock - (a.total - a.stock));

    if (isPast) {
      // Primera vez que se ve este finde ya pasado: se guarda un resguardo automático.
      const snap = await ensureWeekendSnapshot(selected.id);
      snapshotTakenAt = fmtDateTime(snap.takenAt);
    }
  }

  const data = {
    weekends: dropdownWeekends.map((w) => ({
      id: w.id,
      label: w.label,
      rangeLabel: fmtRange(w.startDate, w.endDate),
      eventCount: w.events.length,
    })),
    selected: selected
      ? {
          id: selected.id,
          label: selected.label,
          rangeLabel: fmtRange(selected.startDate, selected.endDate),
          isPast,
          snapshotTakenAt,
          events: selected.events.map((e) => ({
            id: e.id,
            lugar: e.lugar,
            dateLabel: fmtEventDate(e.date),
            guests: e.guests,
            responsable: e.responsable,
            status: e.status,
            lineCount: e._count.lines,
          })),
        }
      : null,
    alert: { overProducts, okCount, totalReut },
  };

  return <WeekendHub data={data} />;
}
