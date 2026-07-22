import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { fmtEventDate } from "@/lib/format";
import { OrderBuilder } from "@/components/OrderBuilder";

export const dynamic = "force-dynamic";

const CAT_ORDER: Record<string, number> = { ENSERES: 0, MOBILIARIO: 1, BEBIDA: 2 };

export default async function EventoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ev = await prisma.event.findUnique({ where: { id } });
  if (!ev) notFound();

  // Catálogo completo, ordenado como el Excel
  const products = await prisma.product.findMany({
    where: { active: true },
    orderBy: [{ rubro: "asc" }, { name: "asc" }],
  });
  products.sort((a, b) => (CAT_ORDER[a.category] ?? 9) - (CAT_ORDER[b.category] ?? 9));

  // Líneas ya cargadas de ESTE evento
  const myLines = await prisma.orderLine.findMany({ where: { eventId: id } });
  const mine = new Map(myLines.filter((l) => l.productId).map((l) => [l.productId as string, l]));

  // Reservado por los OTROS eventos del mismo fin de semana
  const otherLines = await prisma.orderLine.findMany({
    where: { event: { weekendId: ev.weekendId }, eventId: { not: id } },
    select: { productId: true, qty: true },
  });
  const reserved = new Map<string, number>();
  for (const l of otherLines) {
    if (l.productId) reserved.set(l.productId, (reserved.get(l.productId) ?? 0) + l.qty);
  }

  // Otros eventos que ya tienen un pedido cargado → se pueden copiar acá.
  const sourceEventsRaw = await prisma.event.findMany({
    where: { id: { not: id }, lines: { some: {} } },
    orderBy: { date: "desc" },
    take: 40,
    include: {
      _count: { select: { lines: true } },
      weekend: { select: { label: true } },
    },
  });

  const data = {
    event: {
      id: ev.id,
      lugar: ev.lugar,
      subLabel: `${fmtEventDate(ev.date)} · ${ev.guests} invitados${ev.responsable ? ` · ${ev.responsable}` : ""}`,
      status: ev.status,
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
      dateLabel: fmtEventDate(e.date),
      weekendLabel: e.weekend.label,
      lineCount: e._count.lines,
    })),
  };

  return <OrderBuilder data={data} />;
}
