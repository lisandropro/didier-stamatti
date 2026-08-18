import { prisma } from "@/lib/db";
import { PeriodHub } from "@/components/PeriodHub";
import { fmtEvento, fmtRangoDias, fmtMomento, hoy } from "@/lib/dates";
import { nombreDe, separarPorFecha } from "@/lib/period-fit";
import { ensurePeriodSnapshot } from "@/lib/snapshot";
import { shortageCountByEvent } from "@/lib/shortages";
import { getSessionUser } from "@/lib/auth";
import { canManagePeriods, canEditOrders } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ w?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSessionUser();

  // Lo que está en la papelera no aparece en ningún lado ni suma al stock.
  const periodos = await prisma.operationalPeriod.findMany({
    where: { deletedAt: null },
    orderBy: { startDay: "desc" },
    include: {
      events: {
        where: { deletedAt: null },
        orderBy: { date: "asc" },
        include: { _count: { select: { lines: true } } },
      },
    },
  });

  const selected = periodos.find((w) => w.id === sp.w) ?? periodos[0] ?? null;

  const today = hoy();
  // El selector de "Período" solo muestra los actuales/próximos —
  // los que ya pasaron viven en Historial (salvo el que estás mirando ahora).
  const periodosDelSelector = periodos.filter((w) => w.endDay >= today || w.id === selected?.id);

  // Aviso de stock: suma de cada reutilizable entre todos los eventos del finde
  const overProducts: { name: string; total: number; stock: number }[] = [];
  let okCount = 0;
  let totalReut = 0;
  let isPast = false;
  let snapshotTakenAt: string | null = null;
  // Cuántos productos le faltan a cada evento, con la misma regla del pedido.
  let faltantesPorEvento = new Map<string, number>();

  if (selected) {
    isPast = selected.endDay < today;
    faltantesPorEvento = await shortageCountByEvent(selected.id);

    const lines = await prisma.orderLine.findMany({
      where: { event: { periodId: selected.id, deletedAt: null } },
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
      const snap = await ensurePeriodSnapshot(selected.id);
      snapshotTakenAt = fmtMomento(snap.takenAt);
    }
  }

  // Papelera: lo borrado sigue existiendo hasta que alguien lo recupere, o
  // hasta el lunes siguiente, cuando el barrido de lib/trash.ts lo borra en serio.
  const [periodosBorrados, trashedEvents, versions] = await Promise.all([
    prisma.operationalPeriod.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      take: 20,
      include: { _count: { select: { events: true } } },
    }),
    prisma.event.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      take: 20,
      include: { _count: { select: { lines: true } }, period: { select: { label: true, startDay: true, endDay: true } } },
    }),
    // Copias guardadas antes de descartar o restaurar pedidos. Se muestran las
    // que todavía nadie usó para volver atrás.
    prisma.periodVersion.findMany({
      where: { restoredAt: null, period: { deletedAt: null } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { period: { select: { label: true, startDay: true, endDay: true } } },
    }),
  ]);

  // Lo que ya se hizo se pliega abajo; arriba queda solo lo que falta.
  const { porHacer, pasados } = selected
    ? separarPorFecha(selected.events, today)
    : { porHacer: [], pasados: [] };

  const tarjetaDeEvento = (e: (typeof porHacer)[number]) => ({
    id: e.id,
    lugar: e.lugar,
    dateLabel: fmtEvento(e.date),
    guests: e.guests,
    responsable: e.responsable,
    status: e.status,
    lineCount: e._count.lines,
    shortageCount: faltantesPorEvento.get(e.id) ?? 0,
  });

  const data = {
    periodos: periodosDelSelector.map((w) => ({
      id: w.id,
      label: nombreDe(w),
      rangeLabel: fmtRangoDias(w.startDay, w.endDay),
      eventCount: w.events.length,
    })),
    selected: selected
      ? {
          id: selected.id,
          label: nombreDe(selected),
          labelPropio: selected.label ?? "",
          startDay: selected.startDay,
          endDay: selected.endDay,
          rangeLabel: fmtRangoDias(selected.startDay, selected.endDay),
          isPast,
          snapshotTakenAt,
          // Los que ya se hicieron van aparte: en la pantalla se pliegan, así
          // quien arma un pedido no lee fechas para saber qué le falta.
          events: porHacer.map(tarjetaDeEvento),
          pasados: pasados.map(tarjetaDeEvento),
        }
      : null,
    alert: { overProducts, okCount, totalReut },
    canManage: canManagePeriods(session?.role ?? ""),
    canEdit: canEditOrders(session?.role ?? ""),
    trash: {
      periodos: periodosBorrados.map((w) => ({
        id: w.id,
        label: nombreDe(w),
        rangeLabel: fmtRangoDias(w.startDay, w.endDay),
        eventCount: w._count.events,
        deletedLabel: fmtMomento(w.deletedAt!),
      })),
      events: trashedEvents.map((e) => ({
        id: e.id,
        lugar: e.lugar,
        dateLabel: fmtEvento(e.date),
        periodLabel: nombreDe(e.period),
        lineCount: e._count.lines,
        deletedLabel: fmtMomento(e.deletedAt!),
      })),
      versions: versions.map((v) => ({
        id: v.id,
        periodLabel: nombreDe(v.period),
        kind: v.kind,
        lineCount: v.lineCount,
        actorName: v.actorName,
        atLabel: fmtMomento(v.createdAt),
      })),
    },
  };

  return <PeriodHub data={data} />;
}
