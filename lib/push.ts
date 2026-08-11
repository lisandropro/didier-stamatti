import webpush from "web-push";
import { prisma } from "@/lib/db";

let configured: boolean | null = null;

function ready(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@didier.local";
  if (!pub || !priv) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

/** `high` es la prioridad máxima que admite Web Push (RFC 8030): le pide al
 *  servicio de mensajería que despierte el teléfono en vez de esperar a la
 *  próxima ventana de ahorro de energía. */
export type PushOptions = { urgency?: "very-low" | "low" | "normal" | "high" };

/** Envía una notificación push a todos los dispositivos suscriptos de un usuario.
 *  Nunca lanza error; limpia las suscripciones que ya no son válidas.
 *
 *  Que no lance es parte del contrato: si falla el push de una persona, los del
 *  resto tienen que salir igual. */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  options: PushOptions = {}
): Promise<void> {
  if (!ready()) return;
  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
            { urgency: options.urgency ?? "normal", TTL: 60 * 60 * 12 }
          );
        } catch (e) {
          const code = (e as { statusCode?: number })?.statusCode;
          // 404/410 = la suscripción caducó (app desinstalada, permiso revocado): se borra.
          if (code === 404 || code === 410) {
            await prisma.pushSubscription.delete({ where: { endpoint: s.endpoint } }).catch(() => {});
          }
        }
      })
    );
  } catch {
    // Ni siquiera un fallo al leer las suscripciones puede cortar el envío al resto.
  }
}
