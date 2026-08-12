"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { fmtRange } from "@/lib/format";
import { revalidatePath } from "next/cache";
import { canManageWeekends, canSetResponsable } from "@/lib/permissions";
import { notifyOrderChange } from "@/lib/notify";
import { planEventEdit } from "@/lib/event-edit";

export type ActionResult = { ok: boolean; error?: string; id?: string };

/** Crear, borrar, recuperar y marcar listos findes y eventos. El encargado de
 *  logística mira pero no toca: lo único que puede escribir es el responsable. */
async function requireManage() {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Tenés que iniciar sesión." };
  if (!canManageWeekends(user.role)) {
    return { user: null, error: "No tenés permiso para modificar los fines de semana ni los eventos." };
  }
  return { user, error: null };
}

export async function createWeekend(input: {
  label?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
}): Promise<ActionResult> {
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };
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
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };
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

export type UpdateEventResult = ActionResult & {
  /** No hay ningún finde que cubra la fecha nueva. La pantalla tiene que pedir
   *  confirmación y volver a llamar con `crearFinde`. */
  faltaFinde?: { startDate: string; endDate: string; label: string };
  /** Nombre del finde al que se mudó, si se mudó. */
  movidoA?: string;
};

/**
 * Corrige los datos generales de un evento ya cargado: nombre, fecha e
 * invitados. **No toca el pedido.**
 *
 * Que el pedido ya tenga cosas cargadas no bloquea nada, y es justamente el
 * caso para el que existe: cuando alguien se da cuenta del error, el pedido ya
 * está hecho y volver a crearlo significaría cargar todo de nuevo. Las líneas
 * cuelgan del id del evento, así que corregir el encabezado no las mueve.
 *
 * Si la fecha nueva cae en otro fin de semana, se muda **el mismo evento** —
 * mismo id, mismas líneas—, y con eso los faltantes de los dos findes se
 * recalculan solos: se calculan al mirarlos, sumando lo que piden los eventos
 * de cada finde, y este evento dejó de estar en uno y pasó a estar en el otro.
 */
export async function updateEvent(input: {
  eventId: string;
  lugar: string;
  date: string; // datetime-local
  guests?: number;
  /** La persona ya confirmó que quiere crear el fin de semana que falta. */
  crearFinde?: boolean;
}): Promise<UpdateEventResult> {
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };

  if (!input.date) return { ok: false, error: "Elegí la fecha y hora." };
  const fecha = new Date(input.date);

  const ev = await prisma.event.findUnique({
    where: { id: input.eventId },
    include: { weekend: { select: { id: true, label: true } } },
  });
  if (!ev) return { ok: false, error: "No se encontró el evento." };
  if (ev.deletedAt) return { ok: false, error: "Ese evento está en la papelera." };

  const pedido = {
    lugar: input.lugar ?? "",
    date: fecha,
    guests: Number.isFinite(input.guests) ? (input.guests as number) : ev.guests,
  };
  const actual = {
    lugar: ev.lugar,
    date: ev.date,
    guests: ev.guests,
    weekendId: ev.weekendId,
    weekendLabel: ev.weekend.label,
  };
  const findes = await prisma.weekend.findMany({
    where: { deletedAt: null },
    select: { id: true, label: true, startDate: true, endDate: true },
  });

  let plan = planEventEdit(actual, pedido, findes);

  if (plan.tipo === "falta-finde") {
    if (!input.crearFinde) {
      // Se corta acá y se pregunta: crear un finde es un objeto nuevo en la app,
      // no un efecto secundario de corregir una fecha.
      return { ok: false, faltaFinde: { startDate: plan.startDate, endDate: plan.endDate, label: plan.label } };
    }
    // Se crea con el mismo flujo de siempre, que vuelve a comprobar el permiso.
    const creado = await createWeekend({ startDate: plan.startDate, endDate: plan.endDate });
    if (!creado.ok || !creado.id) return { ok: false, error: creado.error ?? "No se pudo crear el fin de semana." };
    const nuevo = await prisma.weekend.findUnique({
      where: { id: creado.id },
      select: { id: true, label: true, startDate: true, endDate: true },
    });
    if (!nuevo) return { ok: false, error: "No se pudo crear el fin de semana." };
    plan = planEventEdit(actual, pedido, [...findes, nuevo]);
  }

  if (plan.tipo === "error") return { ok: false, error: plan.error };
  // Guardar sin cambiar nada no avisa, igual que en el resto del pedido.
  if (plan.tipo === "sin-cambios") return { ok: true, id: ev.id };
  if (plan.tipo !== "guardar") return { ok: false, error: "No se pudo guardar el cambio." };

  const { destinoId, destinoLabel, semudó, cambios } = plan;
  const findeAnterior = ev.weekendId;
  await prisma.event.update({
    where: { id: ev.id },
    data: {
      lugar: pedido.lugar.trim(),
      date: fecha,
      guests: Math.max(0, Math.round(pedido.guests)),
      weekendId: destinoId,
    },
  });

  // Se avisa DESPUÉS de guardar, así el texto del aviso ya nombra al evento
  // corregido y no al que estaba mal.
  await notifyOrderChange(user, ev.id, cambios);

  revalidatePath("/");
  revalidatePath(`/evento/${ev.id}`);
  revalidatePath(`/evento/${ev.id}/pdf`);
  revalidatePath(`/finde/${findeAnterior}`);
  if (semudó) revalidatePath(`/finde/${destinoId}`);

  return { ok: true, id: ev.id, movidoA: semudó ? destinoLabel : undefined };
}

export async function setEventStatus(eventId: string, status: "LISTO" | "NO_LISTO"): Promise<ActionResult> {
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };
  await prisma.event.update({ where: { id: eventId }, data: { status } });
  revalidatePath("/");
  return { ok: true };
}

/** Cambia el responsable de la fiesta. Es la única escritura permitida al
 *  encargado de logística, porque es el dato que él administra.
 *
 *  El cambio se avisa como cualquier otro cambio del pedido: queda en el
 *  resumen con el valor anterior y el nuevo. */
export async function setEventResponsable(eventId: string, responsable: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (!canSetResponsable(user.role)) {
    return { ok: false, error: "No tenés permiso para cambiar el responsable." };
  }

  const ev = await prisma.event.findUnique({
    where: { id: eventId },
    select: { responsable: true, deletedAt: true },
  });
  if (!ev) return { ok: false, error: "No se encontró el evento." };
  if (ev.deletedAt) return { ok: false, error: "Ese evento está en la papelera." };

  const nuevo = responsable.trim() || null;
  const anterior = ev.responsable ?? null;
  // Guardar sin cambiar nada no avisa, igual que en el resto del pedido.
  if (anterior === nuevo) return { ok: true, id: eventId };

  await prisma.event.update({ where: { id: eventId }, data: { responsable: nuevo } });
  await notifyOrderChange(user, eventId, {
    itemName: "Responsable de la fiesta",
    kind: "RESPONSABLE",
    before: anterior,
    after: nuevo,
  });

  revalidatePath("/");
  revalidatePath(`/evento/${eventId}`);
  return { ok: true, id: eventId };
}

/** Manda un evento a la papelera. El pedido queda intacto: se puede recuperar. */
export async function deleteEvent(eventId: string): Promise<ActionResult> {
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };
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
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };
  const w = await prisma.weekend.findUnique({ where: { id: weekendId }, select: { deletedAt: true } });
  if (!w) return { ok: false, error: "No se encontró el fin de semana." };
  if (w.deletedAt) return { ok: true };
  await prisma.weekend.update({ where: { id: weekendId }, data: { deletedAt: new Date() } });
  revalidatePath("/");
  return { ok: true };
}

export async function restoreWeekend(weekendId: string): Promise<ActionResult> {
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };
  const w = await prisma.weekend.findUnique({ where: { id: weekendId }, select: { id: true } });
  if (!w) return { ok: false, error: "No se encontró el fin de semana." };
  await prisma.weekend.update({ where: { id: weekendId }, data: { deletedAt: null } });
  revalidatePath("/");
  return { ok: true, id: weekendId };
}

/** Recupera un evento. Si su fin de semana también estaba borrado lo recupera
 *  junto, porque si no el evento volvería a un lugar al que no se puede entrar. */
export async function restoreEvent(eventId: string): Promise<ActionResult> {
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };
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
