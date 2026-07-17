"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export type OrderResult = { ok: boolean; error?: string; lineId?: string };

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
  revalidatePath("/");
  return { ok: true, lineId: line.id };
}

/** Cambia la cantidad de un ítem fuera de catálogo. */
export async function setCustomQty(lineId: string, qty: number): Promise<OrderResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  const q = Math.max(1, Math.round(qty));
  await prisma.orderLine.update({ where: { id: lineId }, data: { qty: q } });
  revalidatePath("/");
  return { ok: true };
}

/** Borra una línea (se usa para los ítems fuera de catálogo). */
export async function deleteLine(lineId: string): Promise<OrderResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  await prisma.orderLine.delete({ where: { id: lineId } });
  revalidatePath("/");
  return { ok: true };
}
