import { prisma } from "@/lib/db";
import { sendPushToUser } from "@/lib/push";

// Mientras la persona sigue editando, los cambios se van sumando a un mismo
// aviso. El push al celular NO sale con cada cambio: sale uno solo cuando pasa
// este rato sin que nadie toque nada, o sea cuando terminó de editar.
const QUIET_MINUTES = 5;

// Tope para que una edición muy larga no quede acumulando para siempre en un
// único aviso: pasado este rato desde que empezó, la próxima tanda arranca de cero.
const MAX_BATCH_MINUTES = 60;

export type ChangeKind = "AGREGADO" | "QUITADO" | "CANTIDAD" | "NOTA" | "COPIADO";

export type OrderChangeInput = {
  itemName: string;
  kind: ChangeKind;
  before?: string | null;
  after?: string | null;
};

function resumen(actorName: string, lugar: string, n: number): string {
  if (n === 1) return `${actorName} hizo un cambio en el pedido de ${lugar}`;
  return `${actorName} hizo ${n} cambios en el pedido de ${lugar}`;
}

/** Registra QUÉ se cambió y suma el cambio al aviso abierto de cada destinatario
 *  (o abre uno nuevo). No manda push: de eso se encarga `flushPendingOrderPushes`
 *  cuando la edición se queda quieta. Nunca lanza error: si algo falla acá, el
 *  pedido igual queda guardado. */
export async function notifyOrderChange(
  actor: { id: string; name: string },
  eventId: string,
  entrada: OrderChangeInput | OrderChangeInput[]
): Promise<void> {
  const cambios = Array.isArray(entrada) ? entrada : [entrada];
  if (cambios.length === 0) return;
  try {
    const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { lugar: true } });
    if (!ev) return;

    // Una sola marca de tiempo para el cambio y para el aviso: si el cambio se
    // guardara con su propio `now()`, quedaría unos milisegundos ANTES del
    // `sinceAt` del aviso y el resumen se comería el primer cambio de la tanda.
    const ahora = new Date();

    await prisma.orderChange.createMany({
      data: cambios.map((c) => ({
        eventId,
        actorId: actor.id,
        actorName: actor.name,
        itemName: c.itemName,
        kind: c.kind,
        before: c.before ?? null,
        after: c.after ?? null,
        createdAt: ahora,
      })),
    });

    const recipients = await prisma.user.findMany({
      where: { id: { not: actor.id } },
      select: { id: true },
    });
    if (recipients.length === 0) return;

    const batchCutoff = new Date(ahora.getTime() - MAX_BATCH_MINUTES * 60 * 1000);

    for (const r of recipients) {
      // Se busca un aviso de esta misma persona sobre este mismo pedido que
      // todavía no haya salido al celular. Si el push ya salió, este cambio
      // arranca una tanda nueva — si no, se colaría en un aviso ya avisado.
      const abierto = await prisma.notification.findFirst({
        where: {
          recipientId: r.id,
          type: "ORDER_EDIT",
          eventId,
          actorName: actor.name,
          read: false,
          pushedAt: null,
          sinceAt: { gte: batchCutoff },
        },
        orderBy: { createdAt: "desc" },
      });

      if (abierto) {
        const n = abierto.changeCount + cambios.length;
        await prisma.notification.update({
          where: { id: abierto.id },
          // `createdAt` se corre a ahora: es la marca de "última actividad".
          data: { createdAt: ahora, changeCount: n, message: resumen(actor.name, ev.lugar, n) },
        });
      } else {
        await prisma.notification.create({
          data: {
            recipientId: r.id,
            actorName: actor.name,
            type: "ORDER_EDIT",
            eventId,
            message: resumen(actor.name, ev.lugar, cambios.length),
            changeCount: cambios.length,
            sinceAt: ahora,
            createdAt: ahora,
          },
        });
      }
    }
  } catch {
    // Un fallo de notificación no debe romper el guardado del pedido.
  }
}

/** Manda el push de los avisos cuya edición ya se quedó quieta. Corre cada un
 *  minuto desde `instrumentation.ts`. Devuelve cuántos push salieron. */
export async function flushPendingOrderPushes(): Promise<{ enviados: number; cerrados: number }> {
  try {
    const cutoff = new Date(Date.now() - QUIET_MINUTES * 60 * 1000);
    const pendientes = await prisma.notification.findMany({
      where: { type: "ORDER_EDIT", pushedAt: null, createdAt: { lte: cutoff } },
      take: 100,
      orderBy: { createdAt: "asc" },
    });

    let enviados = 0;
    for (const n of pendientes) {
      // Si ya lo vio en la app, no tiene sentido hacerle sonar el teléfono.
      if (!n.read) {
        await sendPushToUser(n.recipientId, {
          title: "Didier Stamatti",
          body: n.message,
          url: `/aviso/${n.id}`,
          tag: `order-${n.eventId ?? n.id}`,
        });
        enviados++;
      }
      await prisma.notification.update({ where: { id: n.id }, data: { pushedAt: new Date() } });
    }
    return { enviados, cerrados: pendientes.length };
  } catch {
    return { enviados: 0, cerrados: 0 };
  }
}
