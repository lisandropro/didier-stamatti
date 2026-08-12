"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { canManagePeriods, canSetResponsable } from "@/lib/permissions";
import { notifyOrderChange } from "@/lib/notify";
import { planEventEdit } from "@/lib/event-edit";
import { diaDe, esDia, fmtRangoDias, instanteDeLocal } from "@/lib/dates";
import {
  cubreDia,
  duplicadoDe,
  eventosQueQuedanFuera,
  nombreDe,
  problemaDeRango,
  rangoQueLosContiene,
  ubicarDia,
  type Periodo,
} from "@/lib/period-fit";

export type ActionResult = { ok: boolean; error?: string; id?: string };

/** Crear, borrar, recuperar y editar períodos y eventos. El encargado de
 *  logística mira pero no toca: lo único que puede escribir es el responsable. */
async function requireManage() {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Tenés que iniciar sesión." };
  if (!canManagePeriods(user.role)) {
    return { user: null, error: "No tenés permiso para modificar los períodos ni los eventos." };
  }
  return { user, error: null };
}

/** Todos los períodos vivos, en la forma que usan las reglas. */
async function periodosVivos(): Promise<Periodo[]> {
  return prisma.operationalPeriod.findMany({
    where: { deletedAt: null },
    select: { id: true, label: true, startDay: true, endDay: true },
    orderBy: { startDay: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Períodos
// ---------------------------------------------------------------------------

export type PeriodResult = ActionResult & {
  /** Ya existe uno con el mismo rango: la pantalla pregunta antes de repetirlo. */
  duplicado?: { id: string; nombre: string };
  /** Al achicar el rango, estos eventos quedarían afuera. */
  eventosFuera?: { id: string; lugar: string; dia: string }[];
  /** El rango mínimo que sí los contiene, para ofrecerlo como arreglo. */
  rangoSugerido?: { startDay: string; endDay: string; label: string };
};

/**
 * Crea un período operativo.
 *
 * El rango es libre: puede ser una sola jornada, tres días de semana o una
 * semana entera. No hay ninguna regla sobre qué día empieza — la empresa
 * trabaja todos los días.
 */
export async function createPeriod(input: {
  label?: string;
  startDay: string; // AAAA-MM-DD
  endDay: string;
  /** La persona ya vio que existe uno igual y quiere crearlo igual. */
  permitirDuplicado?: boolean;
}): Promise<PeriodResult> {
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };

  const startDay = (input.startDay ?? "").trim();
  const endDay = (input.endDay ?? "").trim();
  const problema = problemaDeRango(startDay, endDay);
  if (problema) return { ok: false, error: problema };

  const existentes = await periodosVivos();
  const igual = duplicadoDe(existentes, startDay, endDay);
  if (igual && !input.permitirDuplicado) {
    return { ok: false, duplicado: { id: igual.id, nombre: nombreDe(igual) } };
  }

  const label = input.label?.trim() || null;
  const p = await prisma.operationalPeriod.create({ data: { label, startDay, endDay } });
  revalidatePath("/");
  return { ok: true, id: p.id };
}

/**
 * Cambia las fechas o el nombre de un período.
 *
 * Si al achicarlo quedaran eventos afuera, no se guarda: un evento colgado de un
 * período que no cubre su fecha cuenta contra el stock del grupo equivocado, y
 * eso no se ve hasta el día del evento. Se devuelven cuáles quedarían afuera y
 * el rango mínimo que sí los contiene.
 */
export async function updatePeriod(input: {
  periodId: string;
  label?: string;
  startDay: string;
  endDay: string;
  permitirDuplicado?: boolean;
}): Promise<PeriodResult> {
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };

  const startDay = (input.startDay ?? "").trim();
  const endDay = (input.endDay ?? "").trim();
  const problema = problemaDeRango(startDay, endDay);
  if (problema) return { ok: false, error: problema };

  const p = await prisma.operationalPeriod.findUnique({
    where: { id: input.periodId },
    include: { events: { where: { deletedAt: null }, select: { id: true, lugar: true, date: true } } },
  });
  if (!p) return { ok: false, error: "No se encontró el período." };
  if (p.deletedAt) return { ok: false, error: "Ese período está en la papelera." };

  const existentes = await periodosVivos();
  const igual = duplicadoDe(existentes, startDay, endDay, p.id);
  if (igual && !input.permitirDuplicado) {
    return { ok: false, duplicado: { id: igual.id, nombre: nombreDe(igual) } };
  }

  const fuera = eventosQueQuedanFuera(p.events, startDay, endDay);
  if (fuera.length > 0) {
    const minimo = rangoQueLosContiene(p.events)!;
    return {
      ok: false,
      eventosFuera: fuera.map((e) => ({ id: e.id, lugar: e.lugar, dia: diaDe(e.date) })),
      rangoSugerido: { ...minimo, label: fmtRangoDias(minimo.startDay, minimo.endDay) },
    };
  }

  await prisma.operationalPeriod.update({
    where: { id: p.id },
    data: { startDay, endDay, label: input.label?.trim() || null },
  });
  revalidatePath("/");
  revalidatePath(`/periodo/${p.id}`);
  return { ok: true, id: p.id };
}

/** Manda un período a la papelera, con sus eventos y pedidos.
 *  No se borra nada: se recupera entero desde la papelera. */
export async function deletePeriod(periodId: string): Promise<ActionResult> {
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };
  const p = await prisma.operationalPeriod.findUnique({ where: { id: periodId }, select: { deletedAt: true } });
  if (!p) return { ok: false, error: "No se encontró el período." };
  if (p.deletedAt) return { ok: true };
  await prisma.operationalPeriod.update({ where: { id: periodId }, data: { deletedAt: new Date() } });
  revalidatePath("/");
  return { ok: true };
}

export async function restorePeriod(periodId: string): Promise<ActionResult> {
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };
  const p = await prisma.operationalPeriod.findUnique({ where: { id: periodId }, select: { id: true } });
  if (!p) return { ok: false, error: "No se encontró el período." };
  await prisma.operationalPeriod.update({ where: { id: periodId }, data: { deletedAt: null } });
  revalidatePath("/");
  return { ok: true, id: periodId };
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

export type EventPlacementResult = ActionResult & {
  /** Ningún período cubre la fecha: se ofrece crear uno. */
  faltaPeriodo?: { startDay: string; endDay: string; label: string };
  /** Varios la cubren: elige la persona. Nunca se desempata solo. */
  elegirPeriodo?: { id: string; nombre: string; rango: string }[];
  /** Nombre del período al que fue a parar. */
  periodo?: string;
};

/**
 * Crea un evento y lo ubica en el período que le corresponde por su fecha.
 *
 * No se pide el período: se deduce de la fecha, que es el dato que la persona
 * tiene. Si hay varios que la cubren, se le pregunta cuál — adivinar significa
 * contar la vajilla contra el grupo equivocado.
 */
export async function createEvent(input: {
  lugar: string;
  date: string; // datetime-local
  guests?: number;
  responsable?: string;
  /** El período que eligió la persona, si hubo que preguntarle. */
  periodoElegidoId?: string | null;
  /** Ya confirmó que quiere crear el período que falta. */
  crearPeriodo?: boolean;
}): Promise<EventPlacementResult> {
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };
  if (!input.lugar?.trim()) return { ok: false, error: "Poné el lugar del evento." };

  const fecha = instanteDeLocal(input.date ?? "");
  if (!fecha) return { ok: false, error: "Elegí la fecha y hora." };
  const dia = diaDe(fecha);

  let destinoId = input.periodoElegidoId ?? null;
  const periodos = await periodosVivos();

  if (destinoId) {
    const elegido = periodos.find((p) => p.id === destinoId);
    if (!elegido) return { ok: false, error: "No se encontró el período elegido." };
    if (!cubreDia(elegido, dia)) {
      return { ok: false, error: `El período "${nombreDe(elegido)}" no incluye el ${dia}.` };
    }
  } else {
    const ubicacion = ubicarDia(periodos, dia);
    if (ubicacion.tipo === "ninguno") {
      const s = ubicacion.sugerido;
      if (!input.crearPeriodo) {
        return { ok: false, faltaPeriodo: { ...s, label: fmtRangoDias(s.startDay, s.endDay) } };
      }
      const creado = await createPeriod({ startDay: s.startDay, endDay: s.endDay, permitirDuplicado: true });
      if (!creado.ok || !creado.id) return { ok: false, error: creado.error ?? "No se pudo crear el período." };
      destinoId = creado.id;
    } else if (ubicacion.tipo === "varios") {
      return {
        ok: false,
        elegirPeriodo: ubicacion.candidatos.map((p) => ({
          id: p.id,
          nombre: nombreDe(p),
          rango: fmtRangoDias(p.startDay, p.endDay),
        })),
      };
    } else {
      destinoId = ubicacion.periodo.id;
    }
  }

  const ev = await prisma.event.create({
    data: {
      periodId: destinoId!,
      lugar: input.lugar.trim(),
      date: fecha,
      guests: Number.isFinite(input.guests) ? Math.max(0, Math.round(input.guests as number)) : 0,
      responsable: input.responsable?.trim() || null,
      status: "NO_LISTO",
    },
  });
  revalidatePath("/");
  revalidatePath(`/periodo/${destinoId}`);
  return { ok: true, id: ev.id };
}

export type UpdateEventResult = EventPlacementResult & { movidoA?: string };

/**
 * Corrige los datos generales de un evento ya cargado: nombre, fecha e
 * invitados. **No toca el pedido.**
 *
 * Que el pedido ya tenga cosas cargadas no bloquea nada, y es justamente el
 * caso para el que existe: cuando alguien se da cuenta del error, el pedido ya
 * está hecho y volver a crearlo significaría cargar todo de nuevo. Las líneas
 * cuelgan del id del evento, así que corregir el encabezado no las mueve.
 *
 * Si la fecha nueva cae en otro período, se muda **el mismo evento** — mismo id,
 * mismas líneas—, y con eso los faltantes de los dos períodos se recalculan
 * solos: no están guardados, se calculan al mirarlos sumando lo que piden los
 * eventos de cada período.
 */
export async function updateEvent(input: {
  eventId: string;
  lugar: string;
  date: string; // datetime-local
  guests?: number;
  periodoElegidoId?: string | null;
  crearPeriodo?: boolean;
}): Promise<UpdateEventResult> {
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };

  const fecha = instanteDeLocal(input.date ?? "");
  if (!fecha) return { ok: false, error: "Elegí la fecha y hora." };

  const ev = await prisma.event.findUnique({
    where: { id: input.eventId },
    include: { period: { select: { id: true, label: true, startDay: true, endDay: true } } },
  });
  if (!ev) return { ok: false, error: "No se encontró el evento." };
  if (ev.deletedAt) return { ok: false, error: "Ese evento está en la papelera." };

  const pedido = {
    lugar: input.lugar ?? "",
    date: fecha,
    guests: Number.isFinite(input.guests) ? (input.guests as number) : ev.guests,
    periodoElegidoId: input.periodoElegidoId ?? null,
  };
  const actual = {
    lugar: ev.lugar,
    date: ev.date,
    guests: ev.guests,
    periodId: ev.periodId,
    periodLabel: nombreDe(ev.period),
  };

  let periodos = await periodosVivos();
  let plan = planEventEdit(actual, pedido, periodos);

  if (plan.tipo === "falta-periodo") {
    if (!input.crearPeriodo) {
      return { ok: false, faltaPeriodo: plan.sugerido };
    }
    const creado = await createPeriod({
      startDay: plan.sugerido.startDay,
      endDay: plan.sugerido.endDay,
      permitirDuplicado: true,
    });
    if (!creado.ok || !creado.id) return { ok: false, error: creado.error ?? "No se pudo crear el período." };
    periodos = await periodosVivos();
    plan = planEventEdit(actual, { ...pedido, periodoElegidoId: creado.id }, periodos);
  }

  if (plan.tipo === "elegir-periodo") return { ok: false, elegirPeriodo: plan.candidatos };
  if (plan.tipo === "error") return { ok: false, error: plan.error };
  // Guardar sin cambiar nada no avisa, igual que en el resto del pedido.
  if (plan.tipo === "sin-cambios") return { ok: true, id: ev.id };
  if (plan.tipo !== "guardar") return { ok: false, error: "No se pudo guardar el cambio." };

  const { destinoId, destinoNombre, semudó, cambios } = plan;
  const periodoAnterior = ev.periodId;
  await prisma.event.update({
    where: { id: ev.id },
    data: {
      lugar: pedido.lugar.trim(),
      date: fecha,
      guests: Math.max(0, Math.round(pedido.guests)),
      periodId: destinoId,
    },
  });

  // Se avisa DESPUÉS de guardar, así el texto del aviso ya nombra al evento
  // corregido y no al que estaba mal.
  await notifyOrderChange(user, ev.id, cambios);

  revalidatePath("/");
  revalidatePath(`/evento/${ev.id}`);
  revalidatePath(`/evento/${ev.id}/pdf`);
  revalidatePath(`/periodo/${periodoAnterior}`);
  if (semudó) revalidatePath(`/periodo/${destinoId}`);

  return { ok: true, id: ev.id, movidoA: semudó ? destinoNombre : undefined, periodo: destinoNombre };
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

/** Recupera un evento. Si su período también estaba borrado lo recupera junto,
 *  porque si no el evento volvería a un lugar al que no se puede entrar. */
export async function restoreEvent(eventId: string): Promise<ActionResult> {
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };
  const ev = await prisma.event.findUnique({
    where: { id: eventId },
    select: { periodId: true, period: { select: { deletedAt: true } } },
  });
  if (!ev) return { ok: false, error: "No se encontró el evento." };

  await prisma.$transaction([
    prisma.event.update({ where: { id: eventId }, data: { deletedAt: null } }),
    ...(ev.period.deletedAt
      ? [prisma.operationalPeriod.update({ where: { id: ev.periodId }, data: { deletedAt: null } })]
      : []),
  ]);
  revalidatePath("/");
  return { ok: true, id: ev.periodId };
}

/** Se exporta para las pantallas que ofrecen elegir período. */
export async function listPeriodsForDay(dia: string): Promise<{ id: string; nombre: string; rango: string }[]> {
  const user = await getSessionUser();
  if (!user) return [];
  if (!esDia(dia)) return [];
  const periodos = await periodosVivos();
  return periodos
    .filter((p) => cubreDia(p, dia))
    .map((p) => ({ id: p.id, nombre: nombreDe(p), rango: fmtRangoDias(p.startDay, p.endDay) }));
}
