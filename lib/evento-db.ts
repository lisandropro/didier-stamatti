// Crear y corregir un evento contra la base, cada cosa en UNA transacción.
//
// Vive aparte de `app/actions/period.ts` para poder probarlo con una base de
// verdad: las acciones leen la sesión de las cookies y no corren fuera de Next.
// Acá no hay permisos ni validación de lo que llega: eso lo hace la acción
// antes de llamar. Las reglas (a qué período va un evento, qué cambió) siguen
// en `lib/period-fit.ts` y `lib/event-edit.ts`, que son puras.

import { prisma } from "@/lib/db";
import { diaDe, fmtRangoDias } from "@/lib/dates";
import { cubreDia, nombreDe, ubicarDia, type Periodo } from "@/lib/period-fit";
import { planEventEdit } from "@/lib/event-edit";
import type { OrderChangeInput } from "@/lib/notify";

/** Un evento que se puede tocar: ni él ni su período están en la papelera. */
const EVENTO_VIVO = { deletedAt: null, period: { deletedAt: null } } as const;

const SELECCION_DE_PERIODO = { id: true, label: true, startDay: true, endDay: true } as const;

/** Los datos con que nace un período, acá para que crearlo solo (`createPeriod`)
 *  y crearlo junto con un evento no puedan discrepar.
 *
 *  Nace marcado para el barrido de faltantes: no tiene faltantes viejos, así
 *  que no le toca el primer barrido que registra sin avisar (ese es para los
 *  períodos que ya existían al desplegar). Sin esto, los faltantes de su primer
 *  pedido (copiar uno es un toque) se registrarían en silencio. */
export function periodoNuevo(startDay: string, endDay: string, label: string | null = null) {
  return { label, startDay, endDay, faltantesDesde: new Date() };
}

/** Lo que se contesta cuando no se pudo ubicar el evento sin preguntar. */
export type SinUbicar = {
  ok: false;
  error?: string;
  /** Ningún período cubre la fecha: se ofrece crear uno. */
  faltaPeriodo?: { startDay: string; endDay: string; label: string };
  /** Varios la cubren: elige la persona. Nunca se desempata solo. */
  elegirPeriodo?: { id: string; nombre: string; rango: string }[];
};

export type EventoCreado = { ok: true; id: string; periodId: string; periodoCreado: boolean };

/**
 * Crea un evento y lo ubica en el período que le corresponde por su fecha.
 *
 * Todo va en una sola transacción: mirar qué períodos hay, crear el que falta
 * y crear el evento. Antes el período se creaba aparte y, si después fallaba el
 * evento, quedaba un período vacío; y dos toques a la vez podían crear dos
 * períodos iguales, porque cada uno miraba antes de que el otro escribiera
 * (las transacciones van de a una: el segundo ya ve el período del primero).
 */
export async function crearEventoUbicado(datos: {
  lugar: string;
  fecha: Date;
  invitados: number;
  responsable: string | null;
  /** El período que eligió la persona, si hubo que preguntarle. */
  periodoElegidoId: string | null;
  /** Ya confirmó que quiere crear el período que falta. */
  crearPeriodo: boolean;
}): Promise<EventoCreado | SinUbicar> {
  const dia = diaDe(datos.fecha);
  return prisma.$transaction(async (tx): Promise<EventoCreado | SinUbicar> => {
    const periodos: Periodo[] = await tx.operationalPeriod.findMany({
      where: { deletedAt: null },
      select: SELECCION_DE_PERIODO,
      orderBy: { startDay: "desc" },
    });

    let destinoId: string;
    let periodoCreado = false;
    if (datos.periodoElegidoId) {
      const elegido = periodos.find((p) => p.id === datos.periodoElegidoId);
      if (!elegido) return { ok: false, error: "No se encontró el período elegido." };
      if (!cubreDia(elegido, dia)) {
        return { ok: false, error: `El período "${nombreDe(elegido)}" no incluye el ${dia}.` };
      }
      destinoId = elegido.id;
    } else {
      const ubicacion = ubicarDia(periodos, dia);
      if (ubicacion.tipo === "varios") {
        return {
          ok: false,
          elegirPeriodo: ubicacion.candidatos.map((p) => ({
            id: p.id,
            nombre: nombreDe(p),
            rango: fmtRangoDias(p.startDay, p.endDay),
          })),
        };
      }
      if (ubicacion.tipo === "ninguno") {
        const s = ubicacion.sugerido;
        if (!datos.crearPeriodo) {
          return { ok: false, faltaPeriodo: { ...s, label: fmtRangoDias(s.startDay, s.endDay) } };
        }
        // Si el evento de abajo falla, este período no queda: es la misma transacción.
        destinoId = (await tx.operationalPeriod.create({ data: periodoNuevo(s.startDay, s.endDay), select: { id: true } })).id;
        periodoCreado = true;
      } else {
        destinoId = ubicacion.periodo.id;
      }
    }

    const ev = await tx.event.create({
      data: {
        periodId: destinoId,
        lugar: datos.lugar,
        date: datos.fecha,
        guests: datos.invitados,
        responsable: datos.responsable,
        status: "NO_LISTO",
      },
      select: { id: true },
    });
    return { ok: true, id: ev.id, periodId: destinoId, periodoCreado };
  });
}

export type EventoCorregido =
  /** No cambió nada: no se escribió ni hay que avisar. */
  | { ok: true; id: string; sinCambios: true }
  | {
      ok: true;
      id: string;
      sinCambios: false;
      cambios: OrderChangeInput[];
      destinoId: string;
      destinoNombre: string;
      semudó: boolean;
      periodoAnterior: string;
    };

/** Para deshacer la transacción a propósito y contestar con un resultado
 *  normal: lo que se haya creado adentro (un período nuevo) no queda. */
class VolverAtras extends Error {
  constructor(public resultado: SinUbicar) {
    super("volver atrás");
  }
}

/**
 * Corrige nombre, fecha e invitados de un evento. **No toca el pedido.**
 *
 * Leer el evento, decidir y escribir van en una sola transacción, y la
 * escritura es condicionada a que el evento siga vivo. Antes se leía, se
 * decidía y después se escribía sin condición: con dos teléfonos a la vez
 * avisaban los dos con un "antes" que ya no era cierto, y se podía corregir un
 * evento que otro aparato acababa de mandar a la papelera. Si hay que crear el
 * período que falta, se crea adentro: si la corrección no se guarda, no queda.
 *
 * `invitados` nulo = no vino: se conservan los que tenía.
 */
export async function corregirEvento(datos: {
  eventId: string;
  lugar: string;
  fecha: Date;
  invitados: number | null;
  periodoElegidoId: string | null;
  crearPeriodo: boolean;
}): Promise<EventoCorregido | SinUbicar> {
  try {
    return await prisma.$transaction(async (tx): Promise<EventoCorregido | SinUbicar> => {
      const ev = await tx.event.findUnique({
        where: { id: datos.eventId },
        include: { period: { select: { ...SELECCION_DE_PERIODO, deletedAt: true } } },
      });
      if (!ev) return { ok: false, error: "No se encontró el evento." };
      if (ev.deletedAt) return { ok: false, error: "Ese evento está en la papelera." };
      if (ev.period.deletedAt) return { ok: false, error: "El período de ese evento está en la papelera: recuperalo primero." };

      const pedido = {
        lugar: datos.lugar,
        date: datos.fecha,
        guests: datos.invitados ?? ev.guests,
        periodoElegidoId: datos.periodoElegidoId,
      };
      const actual = {
        lugar: ev.lugar,
        date: ev.date,
        guests: ev.guests,
        periodId: ev.periodId,
        periodLabel: nombreDe(ev.period),
      };

      const periodos: Periodo[] = await tx.operationalPeriod.findMany({
        where: { deletedAt: null },
        select: SELECCION_DE_PERIODO,
        orderBy: { startDay: "desc" },
      });
      let plan = planEventEdit(actual, pedido, periodos);

      if (plan.tipo === "falta-periodo") {
        if (!datos.crearPeriodo) return { ok: false, faltaPeriodo: plan.sugerido };
        const creado = await tx.operationalPeriod.create({
          data: periodoNuevo(plan.sugerido.startDay, plan.sugerido.endDay),
          select: SELECCION_DE_PERIODO,
        });
        plan = planEventEdit(actual, { ...pedido, periodoElegidoId: creado.id }, [creado, ...periodos]);
        // Con el período recién creado el plan no puede ser otra cosa que
        // guardar; si lo fuera, el período no tiene que quedar.
        if (plan.tipo !== "guardar") throw new VolverAtras({ ok: false, error: "No se pudo guardar el cambio." });
      }

      if (plan.tipo === "elegir-periodo") return { ok: false, elegirPeriodo: plan.candidatos };
      if (plan.tipo === "error") return { ok: false, error: plan.error };
      // Guardar sin cambiar nada no avisa, igual que en el resto del pedido.
      if (plan.tipo === "sin-cambios") return { ok: true, id: ev.id, sinCambios: true };
      if (plan.tipo !== "guardar") return { ok: false, error: "No se pudo guardar el cambio." };

      const { destinoId, destinoNombre, semudó, cambios } = plan;
      const r = await tx.event.updateMany({
        where: { id: ev.id, ...EVENTO_VIVO },
        data: {
          lugar: pedido.lugar.trim(),
          date: datos.fecha,
          guests: Math.max(0, Math.round(pedido.guests)),
          periodId: destinoId,
        },
      });
      if (r.count !== 1) throw new VolverAtras({ ok: false, error: "El evento ya no está disponible." });
      return { ok: true, id: ev.id, sinCambios: false, cambios, destinoId, destinoNombre, semudó, periodoAnterior: ev.periodId };
    });
  } catch (e) {
    if (e instanceof VolverAtras) return e.resultado;
    throw e;
  }
}
