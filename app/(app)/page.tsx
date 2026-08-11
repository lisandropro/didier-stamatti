import { prisma } from "@/lib/db";
import { WeekendHub } from "@/components/WeekendHub";
import { fmtEventDate, fmtRange, fmtDateTime, startOfToday } from "@/lib/format";
import { ensureWeekendSnapshot } from "@/lib/snapshot";
import { shortageCountByEvent } from "@/lib/shortages";
import { getSessionUser } from "@/lib/auth";
import { canManageWeekends } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ w?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSessionUser();

  // Lo que está en la papelera no aparece en ningún lado ni suma al stock.
  const weekends = await prisma.weekend.findMany({
    where: { deletedAt: null },
    orderBy: { startDate: "desc" },
    include: {
      events: {
        where: { deletedAt: null },
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
  // Cuántos productos le faltan a cada evento, con la misma regla del pedido.
  let faltantesPorEvento = new Map<string, number>();

  if (selected) {
    isPast = selected.endDate < today;
    faltantesPorEvento = await shortageCountByEvent(selected.id);

    const lines = await prisma.orderLine.findMany({
      where: { event: { weekendId: selected.id, deletedAt: null } },
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

  // Papelera: lo borrado sigue existiendo hasta que alguien lo recupere.
  const [trashedWeekends, trashedEvents, versions] = await Promise.all([
    prisma.weekend.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      take: 20,
      include: { _count: { select: { events: true } } },
    }),
    prisma.event.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      take: 20,
      include: { _count: { select: { lines: true } }, weekend: { select: { label: true } } },
    }),
    // Copias guardadas antes de descartar o restaurar pedidos. Se muestran las
    // que todavía nadie usó para volver atrás.
    prisma.weekendVersion.findMany({
      where: { restoredAt: null, weekend: { deletedAt: null } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { weekend: { select: { label: true } } },
    }),
  ]);

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
            shortageCount: faltantesPorEvento.get(e.id) ?? 0,
          })),
        }
      : null,
    alert: { overProducts, okCount, totalReut },
    canManage: canManageWeekends(session?.role ?? ""),
    trash: {
      weekends: trashedWeekends.map((w) => ({
        id: w.id,
        label: w.label,
        rangeLabel: fmtRange(w.startDate, w.endDate),
        eventCount: w._count.events,
        deletedLabel: fmtDateTime(w.deletedAt!),
      })),
      events: trashedEvents.map((e) => ({
        id: e.id,
        lugar: e.lugar,
        dateLabel: fmtEventDate(e.date),
        weekendLabel: e.weekend.label,
        lineCount: e._count.lines,
        deletedLabel: fmtDateTime(e.deletedAt!),
      })),
      versions: versions.map((v) => ({
        id: v.id,
        weekendLabel: v.weekend.label,
        kind: v.kind,
        lineCount: v.lineCount,
        actorName: v.actorName,
        atLabel: fmtDateTime(v.createdAt),
      })),
    },
  };

  return <WeekendHub data={data} />;
}
