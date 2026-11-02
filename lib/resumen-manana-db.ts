// El resumen de la mañana: junta los datos, decide a quién le toca y lo manda.
//
// El texto lo arma `lib/resumen-manana.ts`, sin base de datos. Acá se resuelve
// lo que esa función no sabe: qué eventos hay hoy y mañana, quién tiene un rol
// vigente, quién ya lo recibió y si es hora.
//
// Una vez por persona y por día. Lo que lo garantiza es la fila de la app
// (`Notification` con `type = "RESUMEN:<día>"`), no la memoria del proceso: si
// el servidor se reinicia a las 8 y ya había salido a las 7, no sale de nuevo.

import { prisma } from "@/lib/db";
import { diaDe, instanteDe, partesDe, sumarDias } from "@/lib/dates";
import { sendPushToUser } from "@/lib/push";
import { ROLES, sortByNotificationPriority } from "@/lib/permissions";
import { periodShortages } from "@/lib/shortages";
import { esHoraDelResumen, textoDelResumen, type DatosDelResumen } from "@/lib/resumen-manana";

const mensajeDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// Una corrida a la vez, como los barridos de avisos y de faltantes: leer quién
// ya lo recibió y crear su aviso son dos pasos, y con un servicio de push lento
// una corrida podía seguir mandando cuando arrancaba la siguiente, que leía lo
// mismo y mandaba todo de nuevo.
let enviando = false;

/**
 * Manda el resumen de la mañana a quien todavía no lo recibió hoy. Devuelve a
 * cuántas personas se les dio: un aviso en la app por cada una, y el push a
 * sus teléfonos si los tiene.
 *
 * Fuera de la franja de las 7 a las 11 (hora argentina) no hace nada: si el
 * servidor arranca a la tarde, ese día no sale. Y si no hay eventos ni hoy ni
 * mañana, tampoco: no hay nada que resumir.
 *
 * Nunca lanza: es una tarea de fondo y un fallo acá no puede afectar a la app.
 */
export async function enviarResumenDeLaManana(ahora: Date = new Date()): Promise<{ enviados: number }> {
  if (!esHoraDelResumen(partesDe(ahora).hour)) return { enviados: 0 };
  if (enviando) return { enviados: 0 };
  enviando = true;
  let enviados = 0;
  try {
    const hoyDia = diaDe(ahora);
    const mananaDia = sumarDias(hoyDia, 1);

    // El día de un evento es el de Argentina, no el del servidor: el rango se
    // arma con instantes argentinos y cada evento se ubica con `diaDe`.
    const eventos = await prisma.event.findMany({
      where: {
        deletedAt: null,
        period: { deletedAt: null },
        date: { gte: instanteDe(hoyDia, "00:00"), lt: instanteDe(sumarDias(hoyDia, 2), "00:00") },
      },
      select: { lugar: true, date: true, status: true, periodId: true, _count: { select: { lines: true } } },
      orderBy: { date: "asc" },
    });
    if (eventos.length === 0) return { enviados: 0 };

    const aEvento = (e: (typeof eventos)[number]) => ({ lugar: e.lugar, renglones: e._count.lines, listo: e.status === "LISTO" });
    // "Faltan" cuenta los productos que faltan en los períodos de esos eventos,
    // con la misma regla que la pantalla (`periodShortages`).
    let faltan = 0;
    for (const periodId of new Set(eventos.map((e) => e.periodId))) faltan += (await periodShortages(periodId)).length;

    const personas = await prisma.user.findMany({
      where: { role: { in: [...ROLES] } },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    });
    const conTelefono = new Set(
      (await prisma.pushSubscription.findMany({ where: { userId: { in: personas.map((p) => p.id) } }, select: { userId: true } })).map((s) => s.userId),
    );
    const datos: DatosDelResumen = {
      hoy: eventos.filter((e) => diaDe(e.date) === hoyDia).map(aEvento),
      manana: eventos.filter((e) => diaDe(e.date) === mananaDia).map(aEvento),
      faltan,
      sinAvisos: personas.filter((p) => !conTelefono.has(p.id)).map((p) => p.name),
    };

    const tipo = `RESUMEN:${hoyDia}`;
    const yaRecibieron = new Set(
      (await prisma.notification.findMany({ where: { type: tipo, recipientId: { in: personas.map((p) => p.id) } }, select: { recipientId: true } })).map(
        (n) => n.recipientId,
      ),
    );

    // Uno por uno y en orden de prioridad: quienes salen a conseguir o a juntar
    // las cosas se enteran primero.
    for (const u of sortByNotificationPriority(personas)) {
      if (yaRecibieron.has(u.id)) continue;
      // Cada persona con su propio try/catch: si algo falla con una, y como se
      // repite en cada corrida (cada 10 minutos), las que siguen en la lista se
      // quedarían sin resumen toda la mañana. Si falló antes de guardar su aviso,
      // no queda anotada y la corrida siguiente lo vuelve a intentar.
      try {
        const texto = textoDelResumen(u.role, datos);
        if (!texto) continue;
        const { title, body, url } = texto;
        const aviso = await prisma.notification.create({
          data: {
            recipientId: u.id,
            actorName: "Sistema",
            type: tipo,
            message: body,
            linkUrl: url,
            // El push sale acá mismo, así que queda marcado como enviado: ningún
            // barrido lo vuelve a mandar. Si un envío falla y queda registrado, lo
            // reintenta `reintentarFallidos`.
            pushedAt: new Date(),
          },
        });
        // A lo sumo una vez, como en `lib/faltantes-db.ts`: si el proceso se cae
        // entre guardar el aviso y mandarlo, esa persona tiene el aviso en la app
        // pero no el push. Se elige así porque dos resúmenes el mismo día es peor
        // que uno que queda sin el push.
        await sendPushToUser(u.id, { title, body, url, tag: `resumen-${hoyDia}` }, { kind: "RESUMEN", notificationId: aviso.id }, { urgency: "normal" });
        enviados++;
      } catch (e) {
        console.error(`[resumen] no se pudo mandar el resumen a ${u.name}:`, mensajeDe(e));
      }
    }
    return { enviados };
  } catch (e) {
    console.error("[resumen] error al mandar el resumen de la mañana:", mensajeDe(e));
    return { enviados };
  } finally {
    enviando = false;
  }
}
