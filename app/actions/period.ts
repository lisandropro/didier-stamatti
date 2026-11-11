"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { canManagePeriods, canSetResponsable } from "@/lib/permissions";
import { notifyOrderChange } from "@/lib/notify";
import { avisarEventosDelPeriodo } from "@/lib/avisos-del-periodo";
import { diaDe, esDia, fmtRangoDias, instanteDe, partirLocal } from "@/lib/dates";
import {
  cubreDia,
  duplicadoDe,
  eventosQueQuedanFuera,
  nombreDe,
  problemaDeRango,
  rangoQueLosContiene,
  type Periodo,
} from "@/lib/period-fit";
import { TOPES, esId, textoOpcional } from "@/lib/entrada";
import { revalidarPedido, revalidarPeriodo } from "@/lib/revalidar";
import { corregirEvento, crearEventoUbicado, periodoNuevo } from "@/lib/evento-db";

export type ActionResult = { ok: boolean; error?: string; id?: string };

/** Un evento que se puede tocar: ni él ni su período están en la papelera. */
const EVENTO_VIVO = { deletedAt: null, period: { deletedAt: null } } as const;

const LABEL_LARGO = `El nombre del período es demasiado largo (máximo ${TOPES.label}).`;
const LUGAR_LARGO = `El lugar es demasiado largo (máximo ${TOPES.lugar}).`;
const RESPONSABLE_LARGO = `El nombre del responsable es demasiado largo (máximo ${TOPES.responsable}).`;
const INVITADOS_MAL = `La cantidad de invitados no es válida (máximo ${TOPES.invitados}).`;

/** Lo que llega es un objeto: una acción es un endpoint, y `null` o un texto en
 *  lugar del objeto no pueden terminar en un error crudo al leer un campo. */
function esObjeto(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/** Un día (`AAAA-MM-DD`) o una fecha y hora de formulario: texto corto, o nada. */
const textoCorto = (v: unknown): string => (typeof v === "string" && v.length <= 40 ? v.trim() : "");

/** Los invitados que llegan: `undefined`, `null` o algo que no es un número
 *  (un campo vacío llega así) no es un error, es "no vino". Un número se
 *  redondea y no baja de 0; pasado el tope, se rechaza. */
function invitadosDe(v: unknown): { ok: true; valor: number | null } | { ok: false } {
  if (typeof v !== "number" || !Number.isFinite(v)) return { ok: true, valor: null };
  const n = Math.max(0, Math.round(v));
  return n > TOPES.invitados ? { ok: false } : { ok: true, valor: n };
}

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
  if (!esObjeto(input)) return { ok: false, error: "Elegí las fechas del período." };

  const startDay = textoCorto(input.startDay);
  const endDay = textoCorto(input.endDay);
  const problema = problemaDeRango(startDay, endDay);
  if (problema) return { ok: false, error: problema };
  const nombre = textoOpcional(input.label, TOPES.label);
  if (!nombre.ok) return { ok: false, error: LABEL_LARGO };

  // Para detectar duplicados alcanza con buscar el rango, sin cargar el historial.
  const igual = await prisma.operationalPeriod.findFirst({
    where: { deletedAt: null, startDay, endDay },
    select: { id: true, label: true, startDay: true, endDay: true },
    orderBy: { id: "asc" },
  });
  if (igual && !input.permitirDuplicado) {
    return { ok: false, duplicado: { id: igual.id, nombre: nombreDe(igual) } };
  }

  // `periodoNuevo` lo hace nacer marcado para el barrido de faltantes (ver
  // lib/evento-db.ts): es la misma función con la que `createEvent` y
  // `updateEvent` crean el período que falta.
  const p = await prisma.operationalPeriod.create({ data: periodoNuevo(startDay, endDay, nombre.valor) });
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
  if (!esObjeto(input) || !esId(input.periodId)) return { ok: false, error: "No se encontró el período." };

  const startDay = textoCorto(input.startDay);
  const endDay = textoCorto(input.endDay);
  const problema = problemaDeRango(startDay, endDay);
  if (problema) return { ok: false, error: problema };
  const nombre = textoOpcional(input.label, TOPES.label);
  if (!nombre.ok) return { ok: false, error: LABEL_LARGO };

  const p = await prisma.operationalPeriod.findUnique({
    where: { id: input.periodId },
    include: { events: { where: { deletedAt: null }, select: { id: true, lugar: true, date: true } } },
  });
  if (!p) return { ok: false, error: "No se encontró el período." };
  if (p.deletedAt) return { ok: false, error: "Ese período está en la papelera." };

  // Solo se avisa de duplicado si el rango CAMBIA. Si no, renombrar un período
  // que ya convive a propósito con otro del mismo rango volvería a preguntar
  // por algo que la persona ya aceptó cuando lo creó.
  const cambioElRango = startDay !== p.startDay || endDay !== p.endDay;
  if (cambioElRango) {
    const existentes = await periodosVivos();
    const igual = duplicadoDe(existentes, startDay, endDay, p.id);
    if (igual && !input.permitirDuplicado) {
      return { ok: false, duplicado: { id: igual.id, nombre: nombreDe(igual) } };
    }
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

  // Condicionada a que siga vivo: si otro aparato lo mandó a la papelera entre la
  // lectura y esta escritura, no se le cambian las fechas a algo borrado (y si
  // ya no existe, no hay excepción cruda).
  const r = await prisma.operationalPeriod.updateMany({
    where: { id: p.id, deletedAt: null },
    data: { startDay, endDay, label: nombre.valor },
  });
  if (r.count !== 1) return { ok: false, error: "Ese período está en la papelera." };
  revalidarPeriodo(p.id);
  return { ok: true, id: p.id };
}

/** Manda un período a la papelera, con sus eventos y pedidos.
 *  No se borra nada: se recupera entero desde la papelera. */
export async function deletePeriod(periodId: string): Promise<ActionResult> {
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };
  if (!esId(periodId)) return { ok: false, error: "No se encontró el período." };
  const p = await prisma.operationalPeriod.findUnique({ where: { id: periodId }, select: { deletedAt: true } });
  if (!p) return { ok: false, error: "No se encontró el período." };
  if (p.deletedAt) return { ok: true };
  // La lectura solo distingue "no existe" de "ya estaba borrado". Quien decide si
  // el borrado fue de este aparato es la escritura: con dos teléfonos a la vez,
  // leer y escribir sin condición avisaba dos veces a cada evento.
  const r = await prisma.operationalPeriod.updateMany({ where: { id: periodId, deletedAt: null }, data: { deletedAt: new Date() } });
  // Se avisa DESPUÉS de guardar, y solo si esta escritura fue la que lo borró. Los
  // eventos no se tocan (siguen vivos adentro del período), pero para quien
  // prepara es como si se hubieran ido todos: se avisa de cada uno por el mismo
  // camino que el evento suelto. Si dio 0, otro aparato ya lo borró y avisó él.
  if (r.count === 1) {
    await avisarEventosDelPeriodo(user, periodId, "VIVO", "BORRADO");
  }
  revalidatePath("/");
  // Además de la portada: su pantalla, la papelera del historial y Preparar,
  // donde sus eventos dejan de estar.
  revalidarPeriodo(periodId);
  return { ok: true };
}

export async function restorePeriod(periodId: string): Promise<ActionResult> {
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };
  if (!esId(periodId)) return { ok: false, error: "No se encontró el período." };
  const p = await prisma.operationalPeriod.findUnique({ where: { id: periodId }, select: { deletedAt: true } });
  if (!p) return { ok: false, error: "No se encontró el período." };
  if (!p.deletedAt) {
    // Ya estaba vivo: no hay nada que recuperar ni que avisar. Se actualiza la
    // pantalla igual, porque quien llegó acá miraba una papelera vieja.
    revalidatePath("/");
    return { ok: true, id: periodId };
  }
  // Condicionada a que siga borrado: dos recuperaciones a la vez avisaban las dos.
  const r = await prisma.operationalPeriod.updateMany({ where: { id: periodId, deletedAt: { not: null } }, data: { deletedAt: null } });
  // Se avisa DESPUÉS de guardar, y solo si esta escritura fue la que lo recuperó.
  // Los eventos que alguien borró por su cuenta siguen en la papelera y no avisan.
  if (r.count === 1) {
    await avisarEventosDelPeriodo(user, periodId, "BORRADO", "VIVO");
  }
  revalidatePath("/");
  revalidarPeriodo(periodId);
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

/** La fecha y hora de un formulario (`datetime-local`), como instante argentino.
 *  `null` si no es una fecha de verdad: "2026-02-31T10:00" tiene la forma
 *  correcta y antes se guardaba corrida al 3 de marzo sin avisar. */
function fechaDe(valor: unknown): Date | null {
  const p = partirLocal(textoCorto(valor));
  if (!p || !esDia(p.dia)) return null;
  const [hh, mm] = p.hora.split(":").map(Number);
  if (hh > 23 || mm > 59) return null;
  return instanteDe(p.dia, p.hora);
}

/**
 * Crea un evento y lo ubica en el período que le corresponde por su fecha.
 *
 * No se pide el período: se deduce de la fecha, que es el dato que la persona
 * tiene. Si hay varios que la cubren, se le pregunta cuál — adivinar significa
 * contar la vajilla contra el grupo equivocado.
 *
 * Acá se comprueba el permiso y lo que llega; ubicar, crear el período que
 * falta y crear el evento van juntos en `crearEventoUbicado` (lib/evento-db.ts),
 * en una sola transacción.
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
  if (!esObjeto(input)) return { ok: false, error: "Poné el lugar del evento." };

  const lugar = textoOpcional(input.lugar, TOPES.lugar);
  if (!lugar.ok) return { ok: false, error: LUGAR_LARGO };
  if (!lugar.valor) return { ok: false, error: "Poné el lugar del evento." };
  const responsable = textoOpcional(input.responsable, TOPES.responsable);
  if (!responsable.ok) return { ok: false, error: RESPONSABLE_LARGO };
  const invitados = invitadosDe(input.guests);
  if (!invitados.ok) return { ok: false, error: INVITADOS_MAL };
  const elegidoId = input.periodoElegidoId ?? null;
  if (elegidoId !== null && !esId(elegidoId)) return { ok: false, error: "No se encontró el período elegido." };
  const fecha = fechaDe(input.date);
  if (!fecha) return { ok: false, error: "Elegí la fecha y hora." };

  const hecho = await crearEventoUbicado({
    lugar: lugar.valor,
    fecha,
    invitados: invitados.valor ?? 0,
    responsable: responsable.valor,
    periodoElegidoId: elegidoId,
    crearPeriodo: input.crearPeriodo === true,
  });
  if (!hecho.ok) return hecho;

  revalidatePath("/");
  revalidatePath(`/periodo/${hecho.periodId}`);
  revalidatePath("/preparar");
  return { ok: true, id: hecho.id };
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
 *
 * Acá se comprueba el permiso y lo que llega; leer, decidir y escribir van
 * juntos en `corregirEvento` (lib/evento-db.ts), en una sola transacción y con
 * la escritura condicionada a que el evento siga vivo.
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
  if (!esObjeto(input) || !esId(input.eventId)) return { ok: false, error: "No se encontró el evento." };
  const eventId = input.eventId;

  const lugar = textoOpcional(input.lugar, TOPES.lugar);
  if (!lugar.ok) return { ok: false, error: LUGAR_LARGO };
  const invitados = invitadosDe(input.guests);
  if (!invitados.ok) return { ok: false, error: INVITADOS_MAL };
  const elegidoId = input.periodoElegidoId ?? null;
  if (elegidoId !== null && !esId(elegidoId)) return { ok: false, error: "No se encontró el período elegido." };
  const fecha = fechaDe(input.date);
  if (!fecha) return { ok: false, error: "Elegí la fecha y hora." };

  const hecho = await corregirEvento({
    eventId,
    // Vacío llega a `planEventEdit`, que es quien dice "Poné el lugar del evento."
    lugar: lugar.valor ?? "",
    fecha,
    invitados: invitados.valor,
    periodoElegidoId: elegidoId,
    crearPeriodo: input.crearPeriodo === true,
  });
  if (!hecho.ok) return hecho;
  if (hecho.sinCambios) return { ok: true, id: eventId };
  const { cambios, destinoId, destinoNombre, semudó, periodoAnterior } = hecho;

  // Se avisa DESPUÉS de guardar, así el texto del aviso ya nombra al evento
  // corregido y no al que estaba mal.
  await notifyOrderChange(user, eventId, cambios);

  revalidarPedido(eventId, periodoAnterior);
  if (semudó) revalidatePath(`/periodo/${destinoId}`);

  return { ok: true, id: eventId, movidoA: semudó ? destinoNombre : undefined, periodo: destinoNombre };
}

export async function setEventStatus(eventId: string, status: "LISTO" | "NO_LISTO"): Promise<ActionResult> {
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };
  // El tipo dice "LISTO" | "NO_LISTO", pero eso es lo que manda la pantalla: una
  // acción es un endpoint y sin esto se guardaba cualquier texto como estado.
  if (!esId(eventId)) return { ok: false, error: "El evento ya no está disponible." };
  if (status !== "LISTO" && status !== "NO_LISTO") return { ok: false, error: "Ese estado no existe." };
  // Solo un evento vivo: antes se podía marcar LISTO uno que estaba en la papelera.
  const vivo = { id: eventId, deletedAt: null, period: { deletedAt: null } };
  // La lectura solo distingue "no existe" de "ya estaba así" (y da el estado de
  // antes para el aviso). Quien decide si el cambio fue de este aparato es la
  // escritura: leer y después escribir deja que dos teléfonos a la vez avisen,
  // cada uno, un estado y que solo quede el del último.
  const antes = await prisma.event.findFirst({ where: vivo, select: { status: true } });
  if (!antes) return { ok: false, error: "El evento ya no está disponible." };
  if (antes.status === status) {
    // Ya estaba así: no hay nada que guardar ni avisar. Pero el teléfono que llegó
    // acá tiene una vista vieja por definición (si no, no habría tocado el botón),
    // así que se le actualiza la pantalla igual que en la rama de abajo.
    revalidatePath("/");
    return { ok: true };
  }
  const r = await prisma.event.updateMany({ where: { ...vivo, status: { not: status } }, data: { status } });
  if (r.count === 0) {
    // Entre la lectura y la escritura, o lo borraron o otro aparato ya lo dejó así.
    const sigue = await prisma.event.findFirst({ where: vivo, select: { id: true } });
    if (!sigue) return { ok: false, error: "El evento ya no está disponible." };
    revalidatePath("/");
    return { ok: true };
  }

  // Se avisa DESPUÉS de guardar, y solo si esta escritura fue la que lo cambió.
  if (r.count === 1) {
    await notifyOrderChange(user, eventId, { itemName: "Estado", kind: "ESTADO", before: antes.status, after: status });
  }
  revalidatePath("/");
  // El estado también se ve en el editor del evento, en su período y en Preparar.
  revalidarPedido(eventId);
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

  if (!esId(eventId)) return { ok: false, error: "No se encontró el evento." };
  const texto = textoOpcional(responsable, TOPES.responsable);
  if (!texto.ok) return { ok: false, error: RESPONSABLE_LARGO };
  const nuevo = texto.valor;

  const ev = await prisma.event.findUnique({
    where: { id: eventId },
    select: { responsable: true, deletedAt: true, periodId: true, period: { select: { deletedAt: true } } },
  });
  if (!ev) return { ok: false, error: "No se encontró el evento." };
  if (ev.deletedAt) return { ok: false, error: "Ese evento está en la papelera." };
  if (ev.period.deletedAt) return { ok: false, error: "El período de ese evento está en la papelera: recuperalo primero." };

  const anterior = ev.responsable ?? null;
  // Guardar sin cambiar nada no avisa, igual que en el resto del pedido.
  if (anterior === nuevo) return { ok: true, id: eventId };

  // Condicionada a que el evento siga vivo y a que el responsable siga siendo el
  // que se leyó. Con un `update` sin condición, dos teléfonos a la vez avisaban
  // los dos con el mismo "antes" y quedaba el del último; y se le cambiaba el
  // responsable a un evento que otro aparato acababa de mandar a la papelera.
  const r = await prisma.event.updateMany({
    where: { id: eventId, ...EVENTO_VIVO, responsable: ev.responsable },
    data: { responsable: nuevo },
  });
  if (r.count !== 1) {
    const ahora = await prisma.event.findFirst({ where: { id: eventId, ...EVENTO_VIVO }, select: { responsable: true } });
    if (!ahora) return { ok: false, error: "El evento ya no está disponible." };
    revalidarPedido(eventId, ev.periodId);
    // Otro aparato ya lo dejó como se quería: avisó él.
    if ((ahora.responsable ?? null) === nuevo) return { ok: true, id: eventId };
    return { ok: false, error: "Otra persona cambió el responsable recién. Fijate cómo quedó y volvé a intentar." };
  }
  await notifyOrderChange(user, eventId, {
    itemName: "Responsable de la fiesta",
    kind: "RESPONSABLE",
    before: anterior,
    after: nuevo,
  });

  revalidarPedido(eventId, ev.periodId);
  return { ok: true, id: eventId };
}

/** Manda un evento a la papelera. El pedido queda intacto: se puede recuperar. */
export async function deleteEvent(eventId: string): Promise<ActionResult> {
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };
  if (!esId(eventId)) return { ok: false, error: "No se encontró el evento." };
  const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { deletedAt: true, periodId: true } });
  if (!ev) return { ok: false, error: "No se encontró el evento." };
  if (ev.deletedAt) return { ok: true }; // ya estaba borrado
  // La lectura solo distingue "no existe" de "ya estaba borrado". Quien decide si
  // el borrado fue de este aparato es la escritura: leer y después escribir sin
  // condición deja que dos teléfonos a la vez avisen, cada uno, "se borró".
  const r = await prisma.event.updateMany({ where: { id: eventId, deletedAt: null }, data: { deletedAt: new Date() } });
  // Se avisa DESPUÉS de guardar, y solo si esta escritura fue la que lo borró. Si
  // dio 0, otro aparato lo borró en el medio y ya avisó él: acá solo se actualiza
  // la pantalla.
  if (r.count === 1) {
    await notifyOrderChange(user, eventId, { itemName: "Evento", kind: "PAPELERA", before: "VIVO", after: "BORRADO" });
  }
  revalidatePath("/");
  // Además de la portada: su período, Preparar y la papelera del historial.
  revalidarPedido(eventId, ev.periodId);
  revalidatePath("/historial");
  return { ok: true };
}

/** Recupera un evento. Si su período también estaba borrado lo recupera junto,
 *  porque si no el evento volvería a un lugar al que no se puede entrar. */
export async function restoreEvent(eventId: string): Promise<ActionResult> {
  const { user, error: permiso } = await requireManage();
  if (!user) return { ok: false, error: permiso! };
  if (!esId(eventId)) return { ok: false, error: "No se encontró el evento." };
  const ev = await prisma.event.findUnique({
    where: { id: eventId },
    select: { periodId: true, deletedAt: true, period: { select: { deletedAt: true } } },
  });
  if (!ev) return { ok: false, error: "No se encontró el evento." };

  // El evento se toca SOLO si al leer estaba borrado, y condicionado a que siga
  // borrado. Sin eso, recuperar uno que al leer estaba vivo (solo su período)
  // deshacía en silencio el borrado que otro aparato hizo en el medio, y dos
  // recuperaciones a la vez avisaban las dos "se recuperó". Va primero en la
  // lista para saber cuál de los resultados es el suyo. Con el período pasa lo
  // mismo: también condicionado, para que solo avise quien lo trajo de vuelta.
  const resultados = await prisma.$transaction([
    ...(ev.deletedAt
      ? [prisma.event.updateMany({ where: { id: eventId, deletedAt: { not: null } }, data: { deletedAt: null } })]
      : []),
    ...(ev.period.deletedAt
      ? [prisma.operationalPeriod.updateMany({ where: { id: ev.periodId, deletedAt: { not: null } }, data: { deletedAt: null } })]
      : []),
  ]);
  // Se avisa DESPUÉS de guardar, y solo si esta escritura fue la que lo recuperó.
  // Si el evento no estaba borrado al leer (solo su período) no se lo tocó, y si
  // dio 0 otro aparato ya lo recuperó y avisó él. Cada resultado se lee por su
  // posición: el del evento va primero solo si estaba borrado.
  const resultadoDelEvento = ev.deletedAt ? resultados[0] : null;
  const resultadoDelPeriodo = ev.period.deletedAt ? resultados[ev.deletedAt ? 1 : 0] : null;
  const recuperoElEvento = resultadoDelEvento?.count === 1;
  const recuperoElPeriodo = resultadoDelPeriodo?.count === 1;
  if (recuperoElPeriodo) {
    // El período volvió con todos sus eventos: para quien prepara reaparece cada
    // uno, no solo el que se tocó. Ese aviso ya incluye al evento recuperado (en
    // la transacción volvió antes), así que NO se avisa además el evento solo:
    // saldría "hizo 2 cambios" por una sola recuperación.
    await avisarEventosDelPeriodo(user, ev.periodId, "BORRADO", "VIVO");
  } else if (recuperoElEvento) {
    await notifyOrderChange(user, eventId, { itemName: "Evento", kind: "PAPELERA", before: "BORRADO", after: "VIVO" });
  }
  revalidatePath("/");
  revalidarPedido(eventId, ev.periodId);
  revalidatePath("/historial");
  return { ok: true, id: ev.periodId };
}

/** Se exporta para las pantallas que ofrecen elegir período. */
export async function listPeriodsForDay(dia: string): Promise<{ id: string; nombre: string; rango: string }[]> {
  const user = await getSessionUser();
  if (!user) return [];
  if (typeof dia !== "string" || !esDia(dia)) return [];
  const periodos = await periodosVivos();
  return periodos
    .filter((p) => cubreDia(p, dia))
    .map((p) => ({ id: p.id, nombre: nombreDe(p), rango: fmtRangoDias(p.startDay, p.endDay) }));
}
