import type { Notification } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db";
import { reintentarFallidos, sendPushToUser } from "@/lib/push";
import { esTituloSinPendientes, textoDeLoDeshecho, textoDePush, textoSinPendientes, textoTardio } from "@/lib/aviso-texto";
import { estadoDelEvento } from "@/lib/preparacion-db";
import { cambiosParaAplicar, textoDeAccion } from "@/lib/preparacion";
import { diaDe, hoy } from "@/lib/dates";
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
  // Se descartaron los cambios o se restauró una versión: el pedido entero.
  | "RESTAURADO"
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
  /** El ítem ya estaba tildado como preparado: el depósito tiene que rehacer algo. */
  tardio?: boolean;
};

const mensajeDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function resumen(actorName: string, lugar: string, n: number): string {
  if (n === 1) return `${actorName} hizo un cambio en el pedido de ${lugar}`;
  return `${actorName} hizo ${n} cambios en el pedido de ${lugar}`;
}

type TipoDeTanda = "ORDER_EDIT" | "CAMBIO_TARDIO";

function resumenDe(tipo: TipoDeTanda, actorName: string, lugar: string, n: number): string {
  if (tipo === "ORDER_EDIT") return resumen(actorName, lugar, n);
  return n === 1
    ? `${actorName} cambió un ítem ya preparado de ${lugar}`
    : `${actorName} cambió ${n} ítems ya preparados de ${lugar}`;
}

/** Suma `n` cambios a la tanda abierta de este destinatario y de este tipo, o
 *  abre una nueva. Las dos tandas (común y tardía) siguen la misma regla. */
async function sumarATanda(
  tipo: TipoDeTanda,
  recipientId: string,
  actor: { id: string; name: string },
  eventId: string,
  lugar: string,
  n: number,
  ahora: Date,
  batchCutoff: Date,
): Promise<void> {
  // Se busca un aviso de esta misma persona sobre este mismo pedido que
  // todavía no haya salido al celular. Si el push ya salió, este cambio
  // arranca una tanda nueva — si no, se colaría en un aviso ya avisado.
  const abierto = await prisma.notification.findFirst({
    where: {
      recipientId,
      type: tipo,
      eventId,
      actorName: actor.name,
      read: false,
      pushedAt: null,
      sinceAt: { gte: batchCutoff },
    },
    orderBy: { createdAt: "desc" },
  });

  if (abierto) {
    // Solo si sigue abierta. Entre la búsqueda de recién y esta escritura el
    // barrido la puede cerrar: si se sumara igual, el cambio quedaría adentro
    // de una tanda ya avisada y no saldría nunca al teléfono. En ese caso no
    // se suma nada y más abajo se abre una tanda nueva.
    const sumado = await prisma.notification.updateMany({
      where: { id: abierto.id, pushedAt: null },
      // `createdAt` se corre a ahora: es la marca de "última actividad". Nunca
      // hacia atrás: dos guardados de la misma persona desde dos aparatos
      // pueden llegar desordenados, y si la marca retrocediera, el resumen
      // de la tanda (que llega hasta `createdAt`) dejaría afuera un cambio.
      //
      // El contador se incrementa en la base y no se escribe "lo leído + estos
      // cambios": el barrido cierra la tanda solo si `changeCount` sigue igual,
      // y es la única marca que se mueve siempre: `createdAt` puede quedarse
      // quieta (si ya estaba adelante, porque nunca retrocede). Y con la suma
      // hecha acá, dos guardados juntos leían el mismo número y dejaban uno solo.
      data: {
        createdAt: abierto.createdAt > ahora ? abierto.createdAt : ahora,
        changeCount: { increment: n },
      },
    });
    if (sumado.count > 0) {
      // El mensaje dice el total que quedó en la base, releído después de
      // sumar y no calculado con lo leído antes: con dos guardados juntos, lo
      // leído ya no es el total. Se escribe solo si el contador sigue siendo
      // ése; si otro guardado sumó en el medio, ése escribe su número, que es
      // el nuevo. El texto del push no sale de acá sino de los cambios
      // guardados, así que esto es solo lo que se lee en la lista de avisos.
      const actual = await prisma.notification.findUnique({
        where: { id: abierto.id },
        select: { changeCount: true },
      });
      if (actual) {
        await prisma.notification.updateMany({
          where: { id: abierto.id, changeCount: actual.changeCount },
          data: { message: resumenDe(tipo, actor.name, lugar, actual.changeCount) },
        });
      }
      return;
    }
  }

  // No había tanda abierta, o se cerró justo antes de sumarle este cambio.
  await prisma.notification.create({
    data: {
      recipientId,
      actorName: actor.name,
      type: tipo,
      eventId,
      message: resumenDe(tipo, actor.name, lugar, n),
      changeCount: n,
      sinceAt: ahora,
      createdAt: ahora,
      // El aviso tardío abre Preparar, no "Qué cambió": lo que importa es qué
      // rehacer ahora, no la lista de lo que se tocó.
      linkUrl: tipo === "CAMBIO_TARDIO" ? `/preparar/${eventId}` : null,
    },
  });
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
    const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { lugar: true, date: true } });
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
        tardio: c.tardio ?? false,
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

    // Lo tardío va a su propia tanda: es otro aviso (qué rehacer, con prioridad
    // para todos) y no se mezcla con los cambios comunes.
    //
    // Salvo que el evento ya haya pasado: no queda nada que rehacer en el
    // depósito, y editar una fiesta que terminó mandaba "Sumá 14" con prioridad
    // alta. El cambio igual queda marcado como tardío en el registro de arriba,
    // que mide "el día del evento o después". El corte es por día argentino: el
    // evento de hoy, aunque ya haya empezado, todavía avisa.
    const comunes = cambios.filter((c) => !c.tardio).length;
    const tardios = diaDe(ev.date) < hoy() ? 0 : cambios.length - comunes;

    for (const r of recipients) {
      // La tardía primero: si una tanda falla, que no sea la urgente la que se pierda.
      if (tardios > 0) await sumarATanda("CAMBIO_TARDIO", r.id, actor, eventId, ev.lugar, tardios, ahora, batchCutoff);
      if (comunes > 0) await sumarATanda("ORDER_EDIT", r.id, actor, eventId, ev.lugar, comunes, ahora, batchCutoff);
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
      // Los tardíos tienen su propia tanda y se leen en Preparar, no acá.
      tardio: false,
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Hasta dónde se mira para atrás lo que recibió un teléfono. Un "Sumá 14" de
 *  hace más de dos días ya quedó tapado por todo lo que llegó después. */
const VENTANA_CORRECCION_MS = 48 * 60 * 60 * 1000;

/**
 * ¿Lo último que le llegó a esta persona sobre lo tardío de este evento pide
 * corrección? O sea: ¿fue un "⚠ Cambio en pedido ya preparado" y no ya la
 * corrección ("Pedido ya preparado · …")? Si lo último ya es la corrección,
 * repetirla solo haría sonar el teléfono de nuevo.
 *
 * Dos pasos: las tandas tardías de esta persona sobre este evento, y la última
 * entrega aceptada de alguna de ellas.
 */
async function quedoUnTardioSinCorregir(recipientId: string, eventId: string): Promise<boolean> {
  const tandas = await prisma.notification.findMany({
    where: { recipientId, eventId, type: "CAMBIO_TARDIO" },
    select: { id: true },
  });
  if (tandas.length === 0) return false;
  const ultima = await prisma.pushDelivery.findFirst({
    where: {
      userId: recipientId,
      kind: "CAMBIO_TARDIO",
      status: "ACEPTADO",
      notificationId: { in: tandas.map((t) => t.id) },
      createdAt: { gte: new Date(Date.now() - VENTANA_CORRECCION_MS) },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { payload: true },
  });
  if (!ultima) return false;
  let titulo: unknown;
  try {
    titulo = (JSON.parse(ultima.payload) as { title?: unknown }).title;
  } catch {
    // Un registro ilegible no dice qué quedó en la pantalla. Corregir de más
    // solo repite "ya no hay cambios para aplicar", que es la verdad.
    titulo = undefined;
  }
  return !esTituloSinPendientes(titulo);
}

// Un barrido a la vez. `setInterval` larga el siguiente al minuto aunque el
// anterior siga mandando, y con el servicio de push lento (reintentos, esperas
// de 10 segundos) pasa: el segundo leía las mismas tandas todavía abiertas, las
// volvía a mandar y anotaba cada fallo dos veces.
let barriendo = false;

/** Manda el push de los avisos cuya edición ya se quedó quieta (los dos tipos de
 *  tanda: cambios comunes y cambios tardíos), y reintenta lo que falló por algo
 *  pasajero en el barrido anterior. Corre cada un minuto desde
 *  `instrumentation.ts`. Nunca lanza. */
export async function flushPendingOrderPushes(): Promise<{ enviados: number; cerrados: number; reintentos: number }> {
  if (barriendo) return { enviados: 0, cerrados: 0, reintentos: 0 };
  barriendo = true;
  try {
    const reintentos = await reintentarFallidos();
    const cutoff = new Date(Date.now() - QUIET_MINUTES * 60 * 1000);
    const pendientesCrudos = await prisma.notification.findMany({
      where: { type: { in: ["ORDER_EDIT", "CAMBIO_TARDIO"] }, pushedAt: null, createdAt: { lte: cutoff } },
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
    for (const foto of pendientes) {
      // La lista se leyó una sola vez, al principio, y cada envío tarda (segundos,
      // si el servicio de push anda lento). Se relee cada aviso justo antes de
      // mandarlo. Antes, si llegaba un cambio a mitad del barrido, a quien venía
      // después en la lista le salía igual el push a medias; y si ese cambio
      // deshacía lo avisado, el barrido siguiente no tenía nada que mandar y el
      // teléfono se quedaba con lo viejo.
      //
      // Si la relectura falla no se cierra nada, por lo mismo que con el texto.
      let fresco: Notification | null;
      try {
        fresco = await prisma.notification.findUnique({ where: { id: foto.id } });
      } catch (e) {
        console.error("[avisos] no se pudo releer el aviso, se reintenta en el próximo barrido", foto.id, mensajeDe(e));
        continue;
      }
      // Se borró, ya salió, o siguió creciendo: en ese caso sale pasada la
      // próxima quietud, con todos sus cambios.
      if (
        !fresco ||
        fresco.pushedAt !== null ||
        fresco.createdAt.getTime() !== foto.createdAt.getTime() ||
        fresco.changeCount !== foto.changeCount
      ) {
        continue;
      }
      const n = { ...fresco, role: foto.role };

      // Si ya lo vio en la app, no tiene sentido hacerle sonar el teléfono.
      if (!n.read) {
        // Armar el texto lee la base. Si eso falla (base ocupada, por ejemplo)
        // NO se cierra la tanda: no se mandó nada, no quedó fila en el registro
        // de envíos, y cerrarla perdería el aviso sin dejar rastro. Sin cerrar,
        // el barrido del minuto siguiente la reintenta.
        const tardio = n.type === "CAMBIO_TARDIO";
        let texto: ReturnType<typeof textoDePush>;
        // Lo tardío sale con prioridad para todos: obliga a rehacer algo físico.
        let urgente = tardio || isPriorityRecipient(n.role);
        try {
          const ev = n.eventId
            ? await prisma.event.findUnique({ where: { id: n.eventId }, select: { lugar: true, date: true } })
            : null;
          const lugar = ev?.lugar ?? "Pedido";
          if (tardio) {
            // El texto no sale de los cambios sino de lo que hay que hacer AHORA:
            // si el depósito ya lo aplicó, o el cambio se deshizo, no queda nada.
            const acciones = n.eventId ? cambiosParaAplicar(await estadoDelEvento(n.eventId)).map(textoDeAccion) : [];
            texto = textoTardio(lugar, n.actorName, acciones, ev ? diaDe(ev.date) === hoy() : false);
          } else {
            texto = textoDePush(lugar, n.actorName, await cambiosDeLaTanda(n));
          }
          // `null`: los cambios se compensaron. En el depósito no hay nada que
          // hacer, así que normalmente el teléfono no suena; el aviso queda en la
          // app. Salvo que esta tanda ya haya llegado a un teléfono a medias (un
          // cambio entró mientras se mandaba): ese teléfono sigue mostrando lo que
          // se deshizo, y el depósito lo prepararía. Se lo corrige con el mismo
          // `tag`, que reemplaza al push anterior en la pantalla. En una tanda
          // tardía `null` es que ya no queda nada por aplicar, con el mismo criterio.
          if (!texto) {
            const yaLlego = await prisma.pushDelivery.findFirst({
              where: { notificationId: n.id, status: "ACEPTADO" },
              select: { id: true },
            });
            if (yaLlego) {
              texto = tardio ? textoSinPendientes(lugar, n.actorName) : textoDeLoDeshecho(lugar, n.actorName);
            } else if (tardio && n.eventId && (await quedoUnTardioSinCorregir(n.recipientId, n.eventId))) {
              // Esta tanda no llegó a ningún teléfono, pero una ANTERIOR sí: sale
              // "Sumá 14" y la tanda se cierra; minutos después alguien vuelve
              // atrás y abre otra, que ya no deja nada para aplicar. Sin esto no
              // sonaba nada y el teléfono se quedaba con "Sumá 14". Mismo `tag`
              // (es por evento), así que lo reemplaza. Sin prioridad: no hay nada
              // que hacer, solo dejar de hacer.
              texto = textoSinPendientes(lugar, n.actorName);
              urgente = false;
            }
          }
        } catch (e) {
          console.error("[avisos] no se pudo armar el texto del aviso, se reintenta en el próximo barrido", n.id, mensajeDe(e));
          continue;
        }
        if (texto) {
          // sendPushToUser nunca lanza, y un fallo del envío ya queda escrito
          // en el registro: acá no hay nada que reintentar. El try/catch es por
          // si acaso cambiara eso, para no dejar sin aviso a las demás personas.
          try {
            const r = await sendPushToUser(
              n.recipientId,
              {
                title: texto.title,
                body: texto.body,
                url: tardio ? `/preparar/${n.eventId}` : `/aviso/${n.id}`,
                tag: `${tardio ? "tardio" : "order"}-${n.eventId ?? n.id}`,
              },
              { kind: tardio ? "CAMBIO_TARDIO" : "ORDER_EDIT", notificationId: n.id },
              { urgency: urgente ? "high" : "normal" }
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
      // su `createdAt` y suma a `changeCount`. Se miran las dos porque la marca
      // de tiempo puede no moverse (nunca va hacia atrás), el contador sí. Si
      // cambió, la tanda siguió creciendo y quedó afuera de lo que se acaba de
      // avisar, así que se deja abierta: sale con todos sus cambios pasada la
      // próxima quietud.
      try {
        const cierre = await prisma.notification.updateMany({
          where: { id: n.id, createdAt: n.createdAt, changeCount: n.changeCount },
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
  } finally {
    barriendo = false;
  }
}
