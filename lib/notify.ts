import { prisma } from "@/lib/db";

// Ventana para "agrupar": si el mismo usuario sigue tocando el mismo pedido
// dentro de estos minutos, se actualiza el aviso existente en vez de crear otro.
const COALESCE_MINUTES = 15;

/** Avisa a TODOS los usuarios (menos quien hizo el cambio) que se modificó un
 *  pedido. Nunca lanza error: si algo falla, el guardado del pedido sigue igual. */
export async function notifyOrderChange(actor: { id: string; name: string }, eventId: string): Promise<void> {
  try {
    const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { lugar: true } });
    if (!ev) return;

    const message = `${actor.name} modificó el pedido de ${ev.lugar}`;
    const recipients = await prisma.user.findMany({ where: { id: { not: actor.id } }, select: { id: true } });
    if (recipients.length === 0) return;

    const cutoff = new Date(Date.now() - COALESCE_MINUTES * 60 * 1000);

    for (const r of recipients) {
      const recent = await prisma.notification.findFirst({
        where: {
          recipientId: r.id,
          type: "ORDER_EDIT",
          eventId,
          actorName: actor.name,
          read: false,
          createdAt: { gte: cutoff },
        },
        orderBy: { createdAt: "desc" },
      });
      if (recent) {
        // Ya hay un aviso sin leer de esta persona sobre este pedido: lo "refresca".
        await prisma.notification.update({ where: { id: recent.id }, data: { createdAt: new Date(), message } });
      } else {
        await prisma.notification.create({
          data: { recipientId: r.id, actorName: actor.name, type: "ORDER_EDIT", message, eventId },
        });
      }
    }
  } catch {
    // Un fallo de notificación no debe romper el guardado del pedido.
  }
}
