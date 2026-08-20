// El aviso de "este evento no tiene pedido" le llega a quien puede armarlo.
//
// El control ya existía y ya se disparaba, pero solo lo veía la administradora,
// en el panel "Para revisar". La única persona que puede resolverlo —quien arma
// los pedidos— no se enteraba. Un aviso que no llega a quien actúa no es un
// aviso: es un registro.
//
// Es un aviso de trabajo, no de salud del sistema, y por eso vive aparte de
// `lib/healthcheck.ts`: ese le habla a la administradora sobre la app, este le
// habla al equipo sobre el próximo evento.

import { prisma } from "@/lib/db";
import { diaDe, diasEntre, fmtDia, hoy } from "@/lib/dates";
import { sendPushToUser } from "@/lib/push";
import { canEditOrders, sortByNotificationPriority } from "@/lib/permissions";

/**
 * A cuántos días del evento se avisa.
 *
 * Dos veces y no más: cuando entra en la semana corta y el día anterior. Avisar
 * todos los días de un pedido vacío enseña a ignorar el aviso, que es
 * exactamente lo contrario de lo que se busca.
 */
export const DIAS_DE_AVISO = [1, 3] as const;

export type EventoVacio = { id: string; lugar: string; dia: string };
export type AvisoDePedido = { id: string; lugar: string; dia: string; faltan: number; umbral: number };

/**
 * Cuáles de estos eventos vacíos merecen un aviso hoy, y bajo qué etiqueta.
 *
 * El umbral es lo que hace que cada evento avise dos veces y no diez: mientras
 * faltan 3 y 2 días la etiqueta es la misma —y la segunda vez no se repite—,
 * y recién cambia cuando queda un día. Un evento que ya pasó no avisa: tarde.
 */
export function avisosQueTocan(eventos: EventoVacio[], hoyDia: string): AvisoDePedido[] {
  const umbrales = [...DIAS_DE_AVISO].sort((a, b) => a - b);
  const maximo = umbrales[umbrales.length - 1];
  const avisos: AvisoDePedido[] = [];
  for (const e of eventos) {
    const faltan = diasEntre(hoyDia, e.dia);
    if (faltan < 0 || faltan > maximo) continue;
    const umbral = umbrales.find((u) => faltan <= u)!;
    avisos.push({ id: e.id, lugar: e.lugar, dia: e.dia, faltan, umbral });
  }
  return avisos;
}

/** Cómo se lee el aviso. El día se dice entero: "el sábado 22/8" se entiende de
 *  un vistazo, "faltan 2 días" obliga a hacer la cuenta. */
export function textoDelAviso(a: AvisoDePedido): string {
  const cuando = a.faltan === 0 ? "es hoy" : a.faltan === 1 ? "es mañana" : `es el ${fmtDia(a.dia)}`;
  return `"${a.lugar}" ${cuando} y su pedido está vacío`;
}

/**
 * Avisa, a quien puede armar pedidos, de los eventos que se vienen sin nada
 * cargado. Devuelve cuántos avisos se crearon.
 *
 * Nunca lanza: es una tarea de fondo y un fallo acá no puede afectar a la app.
 */
export async function notificarPedidosVacios(diaDeHoy = hoy()): Promise<{ avisos: number; eventos: number }> {
  try {
    const vacios = await prisma.event.findMany({
      where: { deletedAt: null, period: { deletedAt: null }, lines: { none: {} } },
      select: { id: true, lugar: true, date: true },
    });

    const avisos = avisosQueTocan(
      vacios.map((e) => ({ id: e.id, lugar: e.lugar, dia: diaDe(e.date) })),
      diaDeHoy
    );
    if (avisos.length === 0) return { avisos: 0, eventos: 0 };

    // Los que pueden hacer algo con esto. El encargado de logística no arma
    // pedidos: mandarle el aviso sería pedirle algo que no puede hacer.
    const todos = await prisma.user.findMany({ select: { id: true, role: true } });
    const destinatarios = sortByNotificationPriority(todos.filter((u) => canEditOrders(u.role)));
    if (destinatarios.length === 0) return { avisos: 0, eventos: 0 };

    let creados = 0;
    for (const a of avisos) {
      // La etiqueta lleva el evento y el umbral: así el mismo aviso no se repite
      // mientras la situación no cambie, y el recordatorio del día anterior sí sale.
      const etiqueta = `PEDIDO_VACIO:${a.id}:${a.umbral}`;
      const mensaje = textoDelAviso(a);

      for (const u of destinatarios) {
        const yaAvisado = await prisma.notification.findFirst({
          where: { recipientId: u.id, type: etiqueta },
          select: { id: true },
        });
        if (yaAvisado) continue;

        await prisma.notification.create({
          data: {
            recipientId: u.id,
            actorName: "Sistema",
            type: etiqueta,
            message: mensaje,
            eventId: a.id,
            linkUrl: `/evento/${a.id}`,
            // El push sale acá mismo, así que queda marcado como enviado. Sin
            // esto la fila queda para siempre como "pendiente de envío" y el
            // dato miente sobre lo que realmente pasó.
            pushedAt: new Date(),
          },
        });
        await sendPushToUser(u.id, {
          title: "Falta armar un pedido",
          body: mensaje,
          url: `/evento/${a.id}`,
          tag: `pedido-vacio-${a.id}`,
        });
        creados++;
      }
    }
    return { avisos: creados, eventos: avisos.length };
  } catch {
    return { avisos: 0, eventos: 0 };
  }
}
