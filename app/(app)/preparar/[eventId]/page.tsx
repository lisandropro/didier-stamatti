import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { canPreparar, canVerPreparacion } from "@/lib/permissions";
import { estadoDelEvento } from "@/lib/preparacion-db";
import { periodShortages } from "@/lib/shortages";
import { diaDe, fmtEvento, fmtMomento, hoy } from "@/lib/dates";
import { nombreDe } from "@/lib/period-fit";
import { Preparar } from "@/components/Preparar";

export const dynamic = "force-dynamic";

export default async function PrepararEventoPage({ params }: { params: Promise<{ eventId: string }> }) {
  const sesion = await getSessionUser();
  if (!sesion || !canVerPreparacion(sesion.role)) notFound();

  const { eventId } = await params;
  const ev = await prisma.event.findFirst({
    where: { id: eventId, deletedAt: null, period: { deletedAt: null } },
    select: { id: true, lugar: true, date: true, periodId: true, period: { select: { label: true, startDay: true, endDay: true } } },
  });
  if (!ev) notFound();

  const [items, faltantes] = await Promise.all([estadoDelEvento(ev.id), periodShortages(ev.periodId)]);

  return (
    <Preparar
      data={{
        evento: {
          id: ev.id,
          lugar: ev.lugar,
          cuando: fmtEvento(ev.date),
          esHoy: diaDe(ev.date) === hoy(),
          periodo: nombreDe(ev.period),
        },
        items: items.map((i) => ({
          clave: i.clave,
          itemName: i.itemName,
          unit: i.unit,
          category: i.category,
          qty: i.qty,
          note: i.note,
          estado: i.estado,
          accion: i.accion,
          tildadoQty: i.tildado?.qty ?? null,
          tildadoNota: i.tildado?.note ?? null,
          tildadoPor: i.tildado ? `${i.tildado.porName} · ${fmtMomento(i.tildado.at)}` : null,
        })),
        faltantes: faltantes.map((f) => ({ id: f.productId, name: f.name, unit: f.unit, pedido: f.totalRequested, hay: f.stock, faltan: f.missing })),
        puedeTildar: canPreparar(sesion.role),
      }}
    />
  );
}
