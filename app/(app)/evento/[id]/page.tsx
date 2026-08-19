import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { fmtEvento, aLocal } from "@/lib/dates";
import { nombreDe } from "@/lib/period-fit";
import { OrderBuilder } from "@/components/OrderBuilder";
import { OrderReadOnly } from "@/components/OrderReadOnly";
import { getSessionUser } from "@/lib/auth";
import { canEditOrders, canSetResponsable } from "@/lib/permissions";
import { ordenDeCategoria } from "@/lib/categories";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";



export default async function EventoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSessionUser();
  if (!session) redirect("/login");

  const { id } = await params;
  const ev = await prisma.event.findUnique({ where: { id }, include: { period: { select: { label: true, startDay: true, endDay: true } } } });
  // Un evento en la papelera no se puede abrir ni editar.
  if (!ev || ev.deletedAt) notFound();

  // Líneas ya cargadas de ESTE evento
  const myLines = await prisma.orderLine.findMany({ where: { eventId: id } });

  // Catálogo, ordenado como el Excel.
  //
  // Se traen los productos activos **y además** los que este pedido ya usa,
  // aunque estén dados de baja. Filtrar solo por `active` dejaba el renglón
  // invisible en la única pantalla donde se puede sacar, mientras seguía
  // saliendo impreso en la hoja del depósito y contando contra el stock. Pasó
  // de verdad: un evento pedía 398 tenedores de postre dados de baja y nadie
  // podía verlo ni quitarlo.
  const yaPedidos = myLines.map((l) => l.productId).filter((x): x is string => Boolean(x));
  const products = await prisma.product.findMany({
    where: { OR: [{ active: true }, { id: { in: yaPedidos } }] },
    orderBy: [{ rubro: "asc" }, { name: "asc" }],
  });
  products.sort((a, b) => ordenDeCategoria(a.category) - ordenDeCategoria(b.category));
  const mine = new Map(myLines.filter((l) => l.productId).map((l) => [l.productId as string, l]));

  // Reservado por los OTROS eventos del mismo período
  const otherLines = await prisma.orderLine.findMany({
    where: { event: { periodId: ev.periodId, deletedAt: null }, eventId: { not: id } },
    select: { productId: true, qty: true },
  });
  const reserved = new Map<string, number>();
  for (const l of otherLines) {
    if (l.productId) reserved.set(l.productId, (reserved.get(l.productId) ?? 0) + l.qty);
  }

  // Otros eventos que ya tienen un pedido cargado → se pueden copiar acá.
  const sourceEventsRaw = await prisma.event.findMany({
    where: { id: { not: id }, deletedAt: null, lines: { some: {} } },
    orderBy: { date: "desc" },
    take: 40,
    include: {
      _count: { select: { lines: true } },
      period: { select: { label: true, startDay: true, endDay: true } },
    },
  });

  const data = {
    event: {
      id: ev.id,
      lugar: ev.lugar,
      subLabel: `${fmtEvento(ev.date)} · ${ev.guests} invitados${ev.responsable ? ` · ${ev.responsable}` : ""}`,
      status: ev.status,
      responsable: ev.responsable,
      // Para el formulario de corregir el evento.
      dateLocal: aLocal(ev.date),
      guests: ev.guests,
      periodoLabel: nombreDe(ev.period),
    },
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      rubro: p.rubro,
      type: p.type,
      unit: p.unit,
      stock: p.stock,
      reserved: reserved.get(p.id) ?? 0,
      qty: mine.get(p.id)?.qty ?? 0,
      note: mine.get(p.id)?.note ?? "",
      // Dado de baja del catálogo pero todavía pedido: se muestra marcado para
      // poder sacarlo, y no se ofrece para agregar a otros pedidos.
      deBaja: !p.active,
    })),
    customLines: myLines
      .filter((l) => !l.productId)
      .map((l) => ({
        id: l.id,
        name: l.customName ?? "",
        category: l.customCategory ?? "ENSERES",
        unit: l.customUnit,
        qty: l.qty,
        note: l.note,
      })),
    sourceEvents: sourceEventsRaw.map((e) => ({
      id: e.id,
      lugar: e.lugar,
      dateLabel: fmtEvento(e.date),
      periodLabel: nombreDe(e.period),
      lineCount: e._count.lines,
    })),
  };

  // Quien no puede editar pedidos ve una pantalla de solo lectura, no el
  // armador con los controles apagados: así no queda ningún control por el que
  // se pueda colar una edición.
  if (!canEditOrders(session.role)) {
    return (
      <OrderReadOnly
        data={{
          event: data.event,
          products: data.products,
          customLines: data.customLines,
          canSetResponsable: canSetResponsable(session.role),
        }}
      />
    );
  }

  return <OrderBuilder data={data} />;
}
