import { prisma } from "@/lib/db";
import { reintentarFallidos, sendPushToUser } from "@/lib/push";
import { textoDePush } from "@/lib/aviso-texto";
import { ROLES, isPriorityRecipient, sortByNotificationPriority } from "@/lib/permissions";

// Mientras la persona sigue editando, los cambios se van sumando a un mismo
// aviso. El push al celular NO sale con cada cambio: sale uno solo cuando pasa
// este rato sin que nadie toque nada, o sea cuando terminó de editar.
//
// Eran 5 minutos hasta el 19/10/2026. Se sentía lento y parecía que el aviso no
// llegaba; con 2 sigue juntando la tanda de quien carga varias cosas seguidas.
const QUIET_MINUTES = 2;

// Tope para que una edición muy larga no quede acumulando para siempre en un
// único aviso: pasado este rato desde que empezó, la próxima tanda arranca de cero.
const MAX_BATCH_MINUTES = 60;

export type ChangeKind =
  | "AGREGADO"
  | "QUITADO"
  | "CANTIDAD"
  | "NOTA"
  | "COPIADO"
  | "RESPONSABLE"
  // Datos generales del evento, no del pedido: se corrigen sin tocar las líneas.
  | "LUGAR"
  | "FECHA"
  | "INVITADOS"
  | "PERIODO";

export type OrderChangeInput = {
  itemName: string;
  kind: ChangeKind;
  before?: string | null;
  after?: string | null;
};

const mensajeDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

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

    // El encargado de logística primero: su aviso queda disponible en la app
    // antes que el del resto. Es la única parte del orden que sí se puede
    // garantizar — el push viaja por servicios de terceros y su orden real de
    // entrega no depende de nosotros.
    //
    // Solo roles vigentes: antes le llegaba a cualquier usuario, incluidos los
    // del módulo financiero, que no veían ni el pedido del que se les avisaba.
    const recipients = sortByNotificationPriority(
      await prisma.user.findMany({
        where: { id: { not: actor.id }, role: { in: [...ROLES] } },
        select: { id: true, role: true },
      })
    );
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
          // `createdAt` se corre a ahora: es la marca de "última actividad". Nunca
          // hacia atrás: dos guardados de la misma persona desde dos aparatos
          // pueden llegar desordenados, y si la marca retrocediera, el resumen
          // de la tanda (que llega hasta `createdAt`) dejaría afuera un cambio.
          data: {
            createdAt: abierto.createdAt > ahora ? abierto.createdAt : ahora,
            changeCount: n,
            message: resumen(actor.name, ev.lugar, n),
          },
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

/**
 * Los cambios de UNA tanda: desde que arrancó (`sinceAt`) hasta su última
 * actividad (`createdAt`), sobre ese pedido y de esa persona.
 *
 * El tope de arriba es el arreglo: sin él, el resumen de una tanda vieja
 * mostraba también los cambios de las tandas siguientes de la misma persona.
 */
export async function cambiosDeLaTanda(aviso: {
  eventId: string | null;
  actorName: string;
  sinceAt: Date;
  createdAt: Date;
}) {
  if (!aviso.eventId) return [];
  return prisma.orderChange.findMany({
    where: {
      eventId: aviso.eventId,
      actorName: aviso.actorName,
      createdAt: { gte: aviso.sinceAt, lte: aviso.createdAt },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Manda el push de los avisos cuya edición ya se quedó quieta, y reintenta lo
 *  que falló por algo pasajero en el barrido anterior. Corre cada un minuto
 *  desde `instrumentation.ts`. Nunca lanza. */
export async function flushPendingOrderPushes(): Promise<{ enviados: number; cerrados: number; reintentos: number }> {
  try {
    const reintentos = await reintentarFallidos();
    const cutoff = new Date(Date.now() - QUIET_MINUTES * 60 * 1000);
    const pendientesCrudos = await prisma.notification.findMany({
      where: { type: "ORDER_EDIT", pushedAt: null, createdAt: { lte: cutoff } },
      take: 100,
      orderBy: { createdAt: "asc" },
      include: { recipient: { select: { role: true } } },
    });

    // Los prioritarios salen primero de la cola.
    const pendientes = sortByNotificationPriority(
      pendientesCrudos.map((n) => ({ ...n, role: n.recipient.role }))
    );

    let enviados = 0;
    let cerrados = 0;
    for (const n of pendientes) {
      // Si ya lo vio en la app, no tiene sentido hacerle sonar el teléfono.
      if (!n.read) {
        // Armar el texto lee la base. Si eso falla (base ocupada, por ejemplo)
        // NO se cierra la tanda: no se mandó nada, no quedó fila en el registro
        // de envíos, y cerrarla perdería el aviso sin dejar rastro. Sin cerrar,
        // el barrido del minuto siguiente la reintenta.
        let texto: ReturnType<typeof textoDePush>;
        try {
          const ev = n.eventId
            ? await prisma.event.findUnique({ where: { id: n.eventId }, select: { lugar: true } })
            : null;
          texto = textoDePush(ev?.lugar ?? "Pedido", n.actorName, await cambiosDeLaTanda(n));
        } catch (e) {
          console.error("[avisos] no se pudo armar el texto del aviso, se reintenta en el próximo barrido", n.id, mensajeDe(e));
          continue;
        }
        // `null`: los cambios se compensaron. En el depósito no hay nada que
        // hacer, así que el teléfono no suena; el aviso queda en la app.
        if (texto) {
          // sendPushToUser nunca lanza, y un fallo del envío ya queda escrito
          // en el registro: acá no hay nada que reintentar. El try/catch es por
          // si acaso cambiara eso, para no dejar sin aviso a las demás personas.
          try {
            const r = await sendPushToUser(
              n.recipientId,
              { title: texto.title, body: texto.body, url: `/aviso/${n.id}`, tag: `order-${n.eventId ?? n.id}` },
              { kind: "ORDER_EDIT", notificationId: n.id },
              { urgency: isPriorityRecipient(n.role) ? "high" : "normal" }
            );
            if (r.aceptados > 0) enviados++;
          } catch (e) {
            console.error("[avisos] falló el envío del aviso", n.id, mensajeDe(e));
          }
        }
      }
      // Se cierra la tanda aunque el push no lo hayan aceptado: el aviso ya está
      // en la app, y el reintento de un fallo pasajero lo hace `reintentarFallidos`.
      //
      // Solo si nadie tocó el aviso mientras se mandaba: cada cambio nuevo corre
      // su `createdAt`. Si cambió, la tanda siguió creciendo y quedó afuera de lo
      // que se acaba de avisar, así que se deja abierta: sale con todos sus
      // cambios pasada la próxima quietud.
      try {
        const cierre = await prisma.notification.updateMany({
          where: { id: n.id, createdAt: n.createdAt },
          data: { pushedAt: new Date() },
        });
        cerrados += cierre.count;
      } catch (e) {
        console.error("[avisos] no se pudo cerrar la tanda", n.id, mensajeDe(e));
      }
    }
    return { enviados, cerrados, reintentos };
  } catch (e) {
    console.error("[avisos] falló el barrido", mensajeDe(e));
    return { enviados: 0, cerrados: 0, reintentos: 0 };
  }
}
