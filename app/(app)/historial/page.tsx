import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canVerStock } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { Historial } from "@/components/Historial";
import { fmtRangoDias, fmtMomento, hoy } from "@/lib/dates";
import { nombreDe } from "@/lib/period-fit";

export const dynamic = "force-dynamic";

export default async function HistorialPage() {
  // Estas pantallas son del stock. La sesion ya la exige el layout, pero el rol
  // no lo comprobaba nadie: quien recibe mercaderia o quien paga podia escribir
  // la direccion a mano y entrar. No es informacion sensible, pero la regla del
  // proyecto es que cada pantalla comprueba su propio permiso — apoyarse en que
  // "no hay un enlace" es apoyarse en la navegacion, y la navegacion cambia.
  const sesion = await getSessionUser();
  if (!sesion || !canVerStock(sesion.role)) notFound();
  const today = hoy();

  const periodosPasados = await prisma.operationalPeriod.findMany({
    where: { endDay: { lt: today }, deletedAt: null },
    orderBy: { startDay: "desc" },
    include: {
      events: { select: { id: true } },
      snapshot: { select: { takenAt: true } },
    },
  });

  const movements = await prisma.stockMovement.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      product: { select: { name: true, unit: true } },
      user: { select: { name: true } },
    },
  });

  const data = {
    periodos: periodosPasados.map((w) => ({
      id: w.id,
      label: nombreDe(w),
      rangeLabel: fmtRangoDias(w.startDay, w.endDay),
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
      // Los movimientos viejos (y los de un usuario que se borró) no tienen autor.
      userName: m.user?.name ?? null,
      dateLabel: fmtMomento(m.createdAt),
    })),
  };

  return <Historial data={data} />;
}
