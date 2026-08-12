import { prisma } from "@/lib/db";
import { computeShortage, type ShortageRow } from "@/lib/shortage-rule";
import { nombreDe } from "@/lib/period-fit";

export { computeShortage };
export type { ShortageRow };

type LineaPeriodo = { eventId: string; productId: string | null; qty: number };

/** Trae, de una sola vez, las líneas de catálogo de todos los eventos vivos de
 *  un finde y los productos involucrados. Base común de las dos funciones. */
async function cargarPeriodo(periodId: string) {
  const lines = (await prisma.orderLine.findMany({
    where: { event: { periodId, deletedAt: null }, productId: { not: null } },
    select: { eventId: true, productId: true, qty: true },
  })) as LineaPeriodo[];

  const productIds = [...new Set(lines.map((l) => l.productId!).filter(Boolean))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, unit: true, rubro: true, type: true, stock: true },
  });

  // Total pedido por producto entre TODOS los eventos vivos del finde.
  const totalPorProducto = new Map<string, number>();
  for (const l of lines) {
    if (!l.productId) continue;
    totalPorProducto.set(l.productId, (totalPorProducto.get(l.productId) ?? 0) + l.qty);
  }

  return { lines, products, totalPorProducto };
}

/** Cuántos productos le faltan a cada evento del finde. Se usa en la vista
 *  general para saber en qué tarjetas mostrar el aviso, sin abrir cada pedido. */
export async function shortageCountByEvent(periodId: string): Promise<Map<string, number>> {
  const { lines, products, totalPorProducto } = await cargarPeriodo(periodId);
  const porId = new Map(products.map((p) => [p.id, p]));

  // Lo que pide cada evento de cada producto.
  const pedidoPorEvento = new Map<string, Map<string, number>>();
  for (const l of lines) {
    if (!l.productId) continue;
    let m = pedidoPorEvento.get(l.eventId);
    if (!m) pedidoPorEvento.set(l.eventId, (m = new Map()));
    m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty);
  }

  const out = new Map<string, number>();
  for (const [eventId, pedido] of pedidoPorEvento) {
    let n = 0;
    for (const [productId, requested] of pedido) {
      const p = porId.get(productId);
      if (!p) continue;
      const otherRequested = (totalPorProducto.get(productId) ?? 0) - requested;
      if (computeShortage({ ...p, productId: p.id, requested, otherRequested })) n++;
    }
    out.set(eventId, n);
  }
  return out;
}

/** El detalle de los faltantes de un evento. Solo lee. */
export async function eventShortages(eventId: string): Promise<{
  lugar: string;
  periodLabel: string;
  rows: ShortageRow[];
} | null> {
  const ev = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, lugar: true, periodId: true, deletedAt: true, period: { select: { label: true, startDay: true, endDay: true, deletedAt: true } } },
  });
  // Un evento (o un finde) en la papelera no se consulta.
  if (!ev || ev.deletedAt || ev.period.deletedAt) return null;

  const { lines, products, totalPorProducto } = await cargarPeriodo(ev.periodId);
  const porId = new Map(products.map((p) => [p.id, p]));

  const pedido = new Map<string, number>();
  for (const l of lines) {
    if (l.eventId !== eventId || !l.productId) continue;
    pedido.set(l.productId, (pedido.get(l.productId) ?? 0) + l.qty);
  }

  const rows: ShortageRow[] = [];
  for (const [productId, requested] of pedido) {
    const p = porId.get(productId);
    if (!p) continue;
    const otherRequested = (totalPorProducto.get(productId) ?? 0) - requested;
    const row = computeShortage({ ...p, productId: p.id, requested, otherRequested });
    if (row) rows.push(row);
  }

  // Primero lo que más falta.
  rows.sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name));
  return { lugar: ev.lugar, periodLabel: nombreDe(ev.period), rows };
}
