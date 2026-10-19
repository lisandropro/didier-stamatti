import { randomUUID } from "node:crypto";
import webpush from "web-push";
import { prisma } from "@/lib/db";
import { validPushEndpoint } from "./push-subscription";

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

/** `high` es la prioridad máxima que admite Web Push (RFC 8030): le pide al
 *  servicio de mensajería que despierte el teléfono en vez de esperar a la
 *  próxima ventana de ahorro de energía. */
export type Urgencia = "very-low" | "low" | "normal" | "high";
export type PushOptions = { urgency?: Urgencia };

export type TipoDeAviso =
  | "ORDER_EDIT"
  | "CAMBIO_TARDIO"
  | "FALTANTE"
  | "PEDIDO_VACIO"
  | "SISTEMA"
  | "SUGERENCIA"
  | "PRUEBA";

/** Para qué es un envío. Queda en el registro. */
export type Meta = { kind: TipoDeAviso; notificationId?: string | null };

export type EstadoDeEntrega = "ACEPTADO" | "CADUCADO" | "RECHAZADO" | "ERROR";

/** Un reintento solo dentro de esta ventana: un aviso de hace horas ya no sirve. */
const VENTANA_REINTENTO_MIN = 60;

/** Los dos motivos por los que no se puede ni intentar el envío. Quedan en
 *  `error` del registro; las constantes evitan que quien lee el texto (la
 *  prueba de un teléfono, la pantalla de dispositivos) dependa de un literal. */
export const SIN_CLAVES = "sin claves";
export const CLAVES_INVALIDAS = "claves inválidas";

const mensajeDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

let configurado: boolean | null = null;

/**
 * El envío de verdad, aparte para que las pruebas lo reemplacen.
 *
 * Es un objeto y no dos funciones sueltas para poder pisar sus métodos desde
 * afuera: una función importada no se puede reasignar, una propiedad sí.
 */
export const transporte = {
  listo(): boolean {
    if (configurado !== null) return configurado;
    const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || "mailto:admin@didier.local";
    if (!pub || !priv) return (configurado = false);
    webpush.setVapidDetails(subject, pub, priv);
    return (configurado = true);
  },
  async enviar(
    destino: { endpoint: string; keys: { p256dh: string; auth: string } },
    cuerpo: string,
    urgency: Urgencia,
  ): Promise<{ statusCode: number }> {
    const r = await webpush.sendNotification(destino, cuerpo, { urgency, TTL: 60 * 60 * 12, timeout: 10_000 });
    return { statusCode: r.statusCode };
  },
};

/**
 * Qué significa la respuesta del servicio de push.
 *
 * `null` es que no hubo respuesta (red, tiempo agotado): como un 5xx, puede
 * andar en un rato. 404/410 es que el teléfono dio de baja la suscripción. El
 * resto de los 4xx no se arregla reintentando: claves mal, payload muy grande.
 */
export function clasificar(statusCode: number | null): { status: EstadoDeEntrega; reintentable: boolean } {
  if (statusCode !== null && statusCode >= 200 && statusCode < 300) return { status: "ACEPTADO", reintentable: false };
  if (statusCode === 404 || statusCode === 410) return { status: "CADUCADO", reintentable: false };
  if (statusCode === null || statusCode === 429 || statusCode >= 500) return { status: "ERROR", reintentable: true };
  return { status: "RECHAZADO", reintentable: false };
}

type Suscripcion = { id: string; userId: string; endpoint: string; p256dh: string; auth: string };

/**
 * Manda un push a UN dispositivo y deja escrito qué pasó. Nunca lanza.
 *
 * El id de la entrega viaja dentro del push (`d`): el service worker lo devuelve
 * cuando la persona lo toca, y así se sabe que se abrió. Lo que se guarda en
 * `payload` va SIN esa marca, para que un reintento tenga la suya.
 */
export async function enviarASuscripcion(
  sub: Suscripcion,
  payload: PushPayload,
  meta: Meta,
  urgency: Urgencia = "normal",
  attempt = 1,
): Promise<{ id: string; status: EstadoDeEntrega; error: string | null }> {
  const id = randomUUID();
  let statusCode: number | null = null;
  let error: string | null = null;
  let resultado: { status: EstadoDeEntrega; reintentable: boolean };

  // `listo()` puede lanzar: `setVapidDetails` rechaza una clave o un subject mal
  // formados. Si eso se escapara de acá, el envío se perdería sin dejar fila,
  // que es justo lo que este registro existe para evitar.
  let listo = false;
  let falloDeClaves: string | null = null;
  try {
    listo = transporte.listo();
  } catch (e) {
    falloDeClaves = `${CLAVES_INVALIDAS}: ${mensajeDe(e).slice(0, 300)}`;
  }

  if (falloDeClaves) {
    resultado = { status: "ERROR", reintentable: false };
    error = falloDeClaves;
  } else if (!listo) {
    // Antes esto volvía sin hacer nada y sin dejar rastro.
    resultado = { status: "ERROR", reintentable: false };
    error = SIN_CLAVES;
  } else if (!validPushEndpoint(sub.endpoint)) {
    resultado = { status: "RECHAZADO", reintentable: false };
    error = "endpoint no permitido";
  } else {
    try {
      const r = await transporte.enviar(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ ...payload, d: id }),
        urgency,
      );
      statusCode = r.statusCode;
    } catch (e) {
      const code = (e as { statusCode?: unknown })?.statusCode;
      statusCode = typeof code === "number" ? code : null;
      error = mensajeDe(e).slice(0, 300);
    }
    resultado = clasificar(statusCode);
  }

  // Una prueba que llega una hora tarde diría "si ves esto, andan" cuando ya no
  // es cierto: la prueba se mira en el momento o no sirve.
  if (meta.kind === "PRUEBA") resultado = { ...resultado, reintentable: false };

  // Dos bloques aparte: que no se pueda escribir el registro (base ocupada) no
  // puede dejar de borrar un dispositivo que ya murió.
  try {
    await prisma.pushDelivery.create({
      data: {
        id,
        notificationId: meta.notificationId ?? null,
        userId: sub.userId,
        subscriptionId: sub.id,
        kind: meta.kind,
        status: resultado.status,
        statusCode,
        error,
        attempt,
        reintentable: resultado.reintentable,
        payload: JSON.stringify(payload),
        urgency,
      },
    });
  } catch (e) {
    // No puede cortar el envío al resto, pero tampoco pasar en silencio.
    console.error("[push] no se pudo registrar la entrega", id, mensajeDe(e));
  }
  try {
    if (resultado.status === "CADUCADO") {
      // App desinstalada o permiso revocado: el dispositivo ya no existe.
      await prisma.pushSubscription.deleteMany({ where: { id: sub.id } });
    } else {
      await prisma.pushSubscription.updateMany({
        where: { id: sub.id },
        data: resultado.status === "ACEPTADO" ? { lastOkAt: new Date() } : { lastErrorAt: new Date() },
      });
    }
  } catch (e) {
    console.error("[push] no se pudo actualizar el dispositivo", sub.id, mensajeDe(e));
  }
  return { id, status: resultado.status, error };
}

/**
 * Manda un push a todos los dispositivos de una persona. Nunca lanza.
 *
 * Que no lance es parte del contrato: si falla el push de una persona, los del
 * resto tienen que salir igual. Devuelve cuántos dispositivos lo aceptaron, que
 * es lo único que dice si "se mandó".
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  meta: Meta,
  options: PushOptions = {},
): Promise<{ intentos: number; aceptados: number }> {
  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    const r = await Promise.all(subs.map((s) => enviarASuscripcion(s, payload, meta, options.urgency ?? "normal")));
    return { intentos: r.length, aceptados: r.filter((x) => x.status === "ACEPTADO").length };
  } catch (e) {
    console.error("[push] falló el envío a la persona", userId, mensajeDe(e));
    return { intentos: 0, aceptados: 0 };
  }
}

/**
 * Un segundo intento para lo que falló por algo pasajero. Corre en el barrido
 * de cada minuto. Una sola vez por envío: si vuelve a fallar, queda registrado
 * y se ve en Dispositivos.
 */
export async function reintentarFallidos(ahora = new Date()): Promise<number> {
  try {
    const desde = new Date(ahora.getTime() - VENTANA_REINTENTO_MIN * 60_000);
    const fallidos = await prisma.pushDelivery.findMany({
      where: { status: "ERROR", reintentable: true, attempt: 1, retriedAt: null, createdAt: { gte: desde } },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    let n = 0;
    for (const f of fallidos) {
      // Fila por fila: una entrega con el payload roto no puede frenar el
      // barrido de las demás.
      try {
        // Se marca ANTES de reenviar: si el barrido se corta a la mitad, el
        // siguiente no lo manda dos veces.
        const marcado = await prisma.pushDelivery.updateMany({
          where: { id: f.id, retriedAt: null },
          data: { retriedAt: ahora },
        });
        if (marcado.count === 0 || !f.subscriptionId) continue;
        const sub = await prisma.pushSubscription.findUnique({ where: { id: f.subscriptionId } });
        if (!sub) continue;
        const payload = JSON.parse(f.payload) as PushPayload;
        await enviarASuscripcion(
          sub,
          payload,
          { kind: f.kind as TipoDeAviso, notificationId: f.notificationId },
          f.urgency as Urgencia,
          2,
        );
        n++;
      } catch (e) {
        console.error("[push] no se pudo reintentar la entrega", f.id, mensajeDe(e));
      }
    }
    return n;
  } catch (e) {
    console.error("[push] falló el barrido de reintentos", mensajeDe(e));
    return 0;
  }
}

/** La persona tocó el push: queda la hora y el aviso pasa a leído. Solo el
 *  destinatario puede marcar el suyo. */
export async function registrarApertura(userId: string, deliveryId: string): Promise<boolean> {
  const d = await prisma.pushDelivery.findFirst({ where: { id: deliveryId, userId } });
  if (!d) return false;
  if (!d.openedAt) await prisma.pushDelivery.update({ where: { id: d.id }, data: { openedAt: new Date() } });
  if (d.notificationId) {
    await prisma.notification.updateMany({ where: { id: d.notificationId, recipientId: userId }, data: { read: true } });
  }
  return true;
}

/** "Probar en este teléfono": un push solo a ESTE dispositivo de ESTA persona. */
export async function enviarPrueba(userId: string, endpoint: string): Promise<{ ok: boolean; error?: string }> {
  const sub = await prisma.pushSubscription.findFirst({ where: { endpoint, userId } });
  if (!sub) {
    return { ok: false, error: "Este teléfono no está anotado a tu nombre. Desactivá los avisos y volvé a activarlos." };
  }
  const r = await enviarASuscripcion(
    sub,
    {
      title: "Didier Stamatti",
      body: "Prueba: si ves esto, los avisos llegan a este teléfono.",
      url: "/notificaciones",
      tag: "prueba",
    },
    { kind: "PRUEBA" },
    "high",
  );
  if (r.status === "ACEPTADO") return { ok: true };
  if (r.error === SIN_CLAVES || r.error?.startsWith(CLAVES_INVALIDAS)) {
    return { ok: false, error: "Las claves de avisos del servidor faltan o están mal. Avisale a la administradora." };
  }
  if (r.status === "CADUCADO") return { ok: false, error: "El servicio de avisos dio de baja este teléfono. Volvé a activar los avisos." };
  return { ok: false, error: "El servicio de avisos no aceptó el envío. Probá de nuevo en un rato." };
}

/** El registro se guarda 60 días: alcanza para diagnosticar y no crece sin fin. */
export async function podarEntregas(ahora = new Date(), dias = 60): Promise<number> {
  const corte = new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000);
  const r = await prisma.pushDelivery.deleteMany({ where: { createdAt: { lt: corte } } });
  return r.count;
}
