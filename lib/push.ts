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

/** Envía una notificación push a todos los dispositivos suscriptos de un usuario.
 *  Nunca lanza error; limpia las suscripciones que ya no son válidas. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!ready()) return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload)
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
}
