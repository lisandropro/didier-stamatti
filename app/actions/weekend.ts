"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { fmtRange } from "@/lib/format";
import { revalidatePath } from "next/cache";

export type ActionResult = { ok: boolean; error?: string; id?: string };

export async function createWeekend(input: {
  label?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
}): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (!input.startDate || !input.endDate) return { ok: false, error: "Elegí las fechas del fin de semana." };

  const start = new Date(input.startDate + "T00:00");
  const end = new Date(input.endDate + "T00:00");
  if (end < start) return { ok: false, error: "La fecha de fin no puede ser anterior al inicio." };

  const label = input.label?.trim() || fmtRange(start, end);
  const w = await prisma.weekend.create({ data: { label, startDate: start, endDate: end } });
  revalidatePath("/");
  return { ok: true, id: w.id };
}

export async function createEvent(input: {
  weekendId: string;
  lugar: string;
  date: string; // datetime-local
  guests?: number;
  responsable?: string;
}): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (!input.lugar?.trim()) return { ok: false, error: "Poné el lugar del evento." };
  if (!input.date) return { ok: false, error: "Elegí la fecha y hora." };

  const ev = await prisma.event.create({
    data: {
      weekendId: input.weekendId,
      lugar: input.lugar.trim(),
      date: new Date(input.date),
      guests: Number.isFinite(input.guests) ? Math.max(0, Math.round(input.guests as number)) : 0,
      responsable: input.responsable?.trim() || null,
      status: "NO_LISTO",
    },
  });
  revalidatePath("/");
  return { ok: true, id: ev.id };
}

export async function setEventStatus(eventId: string, status: "LISTO" | "NO_LISTO"): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  await prisma.event.update({ where: { id: eventId }, data: { status } });
  revalidatePath("/");
  return { ok: true };
}

/** Manda un evento a la papelera. El pedido queda intacto: se puede recuperar. */
export async function deleteEvent(eventId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { deletedAt: true } });
  if (!ev) return { ok: false, error: "No se encontró el evento." };
  if (ev.deletedAt) return { ok: true }; // ya estaba borrado
  await prisma.event.update({ where: { id: eventId }, data: { deletedAt: new Date() } });
  revalidatePath("/");
  return { ok: true };
}

/** Manda un fin de semana a la papelera, con sus eventos y pedidos.
 *  No se borra nada: se recupera entero desde la papelera. */
export async function deleteWeekend(weekendId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  const w = await prisma.weekend.findUnique({ where: { id: weekendId }, select: { deletedAt: true } });
  if (!w) return { ok: false, error: "No se encontró el fin de semana." };
  if (w.deletedAt) return { ok: true };
  await prisma.weekend.update({ where: { id: weekendId }, data: { deletedAt: new Date() } });
  revalidatePath("/");
  return { ok: true };
}

export async function restoreWeekend(weekendId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  const w = await prisma.weekend.findUnique({ where: { id: weekendId }, select: { id: true } });
  if (!w) return { ok: false, error: "No se encontró el fin de semana." };
  await prisma.weekend.update({ where: { id: weekendId }, data: { deletedAt: null } });
  revalidatePath("/");
  return { ok: true, id: weekendId };
}

/** Recupera un evento. Si su fin de semana también estaba borrado lo recupera
 *  junto, porque si no el evento volvería a un lugar al que no se puede entrar. */
export async function restoreEvent(eventId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  const ev = await prisma.event.findUnique({
    where: { id: eventId },
    select: { weekendId: true, weekend: { select: { deletedAt: true } } },
  });
  if (!ev) return { ok: false, error: "No se encontró el evento." };

  await prisma.$transaction([
    prisma.event.update({ where: { id: eventId }, data: { deletedAt: null } }),
    ...(ev.weekend.deletedAt
      ? [prisma.weekend.update({ where: { id: ev.weekendId }, data: { deletedAt: null } })]
      : []),
  ]);
  revalidatePath("/");
  return { ok: true, id: ev.weekendId };
}
