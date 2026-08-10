"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { notifyOrderChange, type OrderChangeInput } from "@/lib/notify";
import { revalidatePath } from "next/cache";

export type OrderResult = { ok: boolean; error?: string; lineId?: string; count?: number };

/** Fija la cantidad (y nota) de un producto del catálogo en el pedido de un evento.
 *  qty 0 = el producto no va → se borra la línea. */
export async function setLine(input: {
  eventId: string;
  productId: string;
  qty: number;
  note?: string | null;
}): Promise<OrderResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };

  const qty = Math.max(0, Math.round(input.qty));
  const note = input.note?.trim() || null;

  const existing = await prisma.orderLine.findFirst({
    where: { eventId: input.eventId, productId: input.productId },
  });
  const producto = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { name: true },
  });
  const nombre = producto?.name ?? "Producto";

  // Puede cambiar la cantidad Y la nota en el mismo guardado: se registran las
  // dos cosas, porque la nota es justo lo que le importa al del depósito.
  const cambios: OrderChangeInput[] = [];

  if (qty === 0) {
    if (existing) {
      await prisma.orderLine.delete({ where: { id: existing.id } });
      cambios.push({ itemName: nombre, kind: "QUITADO", before: String(existing.qty), after: null });
    }
  } else if (existing) {
    if (existing.qty !== qty) {
      cambios.push({ itemName: nombre, kind: "CANTIDAD", before: String(existing.qty), after: String(qty) });
    }
    if ((existing.note ?? null) !== note) {
      cambios.push({ itemName: nombre, kind: "NOTA", before: existing.note, after: note });
    }
    // Si no cambió ni la cantidad ni la nota, se guarda igual pero no se avisa:
    // abrir un pedido y volver a guardarlo no es una modificación.
    if (cambios.length > 0) await prisma.orderLine.update({ where: { id: existing.id }, data: { qty, note } });
  } else {
    await prisma.orderLine.create({
      data: { eventId: input.eventId, productId: input.productId, qty, note },
    });
    cambios.push({ itemName: nombre, kind: "AGREGADO", before: null, after: String(qty) });
  }

  if (cambios.length > 0) await notifyOrderChange(user, input.eventId, cambios);
  revalidatePath("/");
  return { ok: true };
}

const CATEGORIES = ["ENSERES", "BEBIDA", "MOBILIARIO"];

/** Agrega un ítem fuera de catálogo (sin control de stock). Necesita categoría
 *  para poder imprimirse en el pedido del sector que corresponde. */
export async function addCustomLine(input: {
  eventId: string;
  name: string;
  category: string;
  unit?: string;
  qty: number;
  note?: string;
}): Promise<OrderResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Poné el nombre del ítem." };
  if (!CATEGORIES.includes(input.category)) return { ok: false, error: "Elegí a qué sector pertenece." };
  const qty = Math.max(1, Math.round(input.qty || 1));

  const line = await prisma.orderLine.create({
    data: {
      eventId: input.eventId,
      customName: name,
      customCategory: input.category,
      customUnit: input.unit?.trim() || null,
      qty,
      note: input.note?.trim() || null,
    },
  });
  await notifyOrderChange(user, input.eventId, {
    itemName: name,
    kind: "AGREGADO",
    before: null,
    after: String(qty),
  });
  revalidatePath("/");
  return { ok: true, lineId: line.id };
}

/** Cambia la cantidad de un ítem fuera de catálogo. */
export async function setCustomQty(lineId: string, qty: number): Promise<OrderResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  const q = Math.max(1, Math.round(qty));
  const antes = await prisma.orderLine.findUnique({
    where: { id: lineId },
    select: { qty: true, customName: true, product: { select: { name: true } } },
  });
  if (!antes) return { ok: false, error: "No se encontró el ítem." };
  const line = await prisma.orderLine.update({ where: { id: lineId }, data: { qty: q }, select: { eventId: true } });
  if (antes.qty !== q) {
    await notifyOrderChange(user, line.eventId, {
      itemName: antes.customName ?? antes.product?.name ?? "Ítem",
      kind: "CANTIDAD",
      before: String(antes.qty),
      after: String(q),
    });
  }
  revalidatePath("/");
  return { ok: true };
}

/** Borra una línea (se usa para los ítems fuera de catálogo). */
export async function deleteLine(lineId: string): Promise<OrderResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  const line = await prisma.orderLine.findUnique({
    where: { id: lineId },
    select: { eventId: true, qty: true, customName: true, product: { select: { name: true } } },
  });
  await prisma.orderLine.delete({ where: { id: lineId } });
  if (line) {
    await notifyOrderChange(user, line.eventId, {
      itemName: line.customName ?? line.product?.name ?? "Ítem",
      kind: "QUITADO",
      before: String(line.qty),
      after: null,
    });
  }
  revalidatePath("/");
  return { ok: true };
}

/** Copia el pedido completo de otro evento a este (reemplaza lo que hubiera).
 *  Sirve para no cargar de cero un evento parecido a uno anterior. */
export async function copyOrderFromEvent(targetEventId: string, sourceEventId: string): Promise<OrderResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (targetEventId === sourceEventId) return { ok: false, error: "Es el mismo evento." };

  const target = await prisma.event.findUnique({ where: { id: targetEventId } });
  if (!target || target.deletedAt) return { ok: false, error: "No se encontró el evento." };

  const source = await prisma.event.findUnique({ where: { id: sourceEventId }, select: { lugar: true } });
  const sourceLines = await prisma.orderLine.findMany({ where: { eventId: sourceEventId } });
  if (sourceLines.length === 0) return { ok: false, error: "Ese evento no tiene pedido para copiar." };
  const habia = await prisma.orderLine.count({ where: { eventId: targetEventId } });

  await prisma.$transaction([
    prisma.orderLine.deleteMany({ where: { eventId: targetEventId } }),
    ...sourceLines.map((l) =>
      prisma.orderLine.create({
        data: {
          eventId: targetEventId,
          productId: l.productId,
          customName: l.customName,
          customCategory: l.customCategory,
          customUnit: l.customUnit,
          qty: l.qty,
          note: l.note,
        },
      })
    ),
  ]);

  await notifyOrderChange(user, targetEventId, {
    itemName: "Todo el pedido",
    kind: "COPIADO",
    before: habia > 0 ? `${habia} ${habia === 1 ? "producto" : "productos"}` : "pedido vacío",
    after: `${sourceLines.length} ${sourceLines.length === 1 ? "producto" : "productos"} copiados de ${source?.lugar ?? "otro evento"}`,
  });
  revalidatePath("/");
  revalidatePath(`/evento/${targetEventId}`);
  return { ok: true, count: sourceLines.length };
}
