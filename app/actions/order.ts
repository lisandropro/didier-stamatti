"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { notifyOrderChange } from "@/lib/notify";
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

  if (qty === 0) {
    if (existing) await prisma.orderLine.delete({ where: { id: existing.id } });
  } else if (existing) {
    await prisma.orderLine.update({ where: { id: existing.id }, data: { qty, note } });
  } else {
    await prisma.orderLine.create({
      data: { eventId: input.eventId, productId: input.productId, qty, note },
    });
  }

  await notifyOrderChange(user, input.eventId);
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
  await notifyOrderChange(user, input.eventId);
  revalidatePath("/");
  return { ok: true, lineId: line.id };
}

/** Cambia la cantidad de un ítem fuera de catálogo. */
export async function setCustomQty(lineId: string, qty: number): Promise<OrderResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  const q = Math.max(1, Math.round(qty));
  const line = await prisma.orderLine.update({ where: { id: lineId }, data: { qty: q }, select: { eventId: true } });
  await notifyOrderChange(user, line.eventId);
  revalidatePath("/");
  return { ok: true };
}

/** Borra una línea (se usa para los ítems fuera de catálogo). */
export async function deleteLine(lineId: string): Promise<OrderResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  const line = await prisma.orderLine.findUnique({ where: { id: lineId }, select: { eventId: true } });
  await prisma.orderLine.delete({ where: { id: lineId } });
  if (line) await notifyOrderChange(user, line.eventId);
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
  if (!target) return { ok: false, error: "No se encontró el evento." };

  const sourceLines = await prisma.orderLine.findMany({ where: { eventId: sourceEventId } });
  if (sourceLines.length === 0) return { ok: false, error: "Ese evento no tiene pedido para copiar." };

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

  await notifyOrderChange(user, targetEventId);
  revalidatePath("/");
  revalidatePath(`/evento/${targetEventId}`);
  return { ok: true, count: sourceLines.length };
}
