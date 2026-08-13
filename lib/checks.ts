import { prisma } from "@/lib/db";
import { diaDe, hoy, diasEntre, fmtDia } from "@/lib/dates";
import { nombreDe } from "@/lib/period-fit";

/**
 * Controles que miran los datos y avisan, sin tocar nada.
 *
 * Todo lo de acá es **de solo lectura y determinista**. Ninguna de estas
 * comprobaciones corrige, completa ni decide nada: señala y deja que la persona
 * resuelva. Ese es el límite: automatizar el control, nunca la decisión.
 *
 * Existen porque cada una tiene un caso real detrás, encontrado auditando:
 * un pedido pedía 398 tenedores dados de baja y nadie podía verlo; dos de los
 * cuatro usuarios llevaban días sin avisos en el celular y nadie se enteró.
 */

export type Hallazgo = {
  /** Para agrupar y no repetir el mismo aviso todos los días. */
  code: string;
  /** Qué pasa, en una línea, entendible sin abrir nada. */
  message: string;
  /** A dónde ir a arreglarlo. */
  url?: string;
  gravedad: "alta" | "media" | "baja";
};

// ---------------------------------------------------------------------------
// A1 — Incoherencias del pedido
// ---------------------------------------------------------------------------

/**
 * Renglones que piden un producto dado de baja del catálogo.
 *
 * El caso que lo motivó: el producto sale de la lista pero el renglón queda,
 * se imprime en la hoja del depósito y cuenta contra el stock. Ahora la
 * pantalla del pedido los muestra marcados, pero igual hay que avisar: si nadie
 * abre ese pedido, nadie los ve.
 */
export async function pedidosConProductoDeBaja(): Promise<Hallazgo[]> {
  const filas = await prisma.orderLine.findMany({
    where: {
      qty: { gt: 0 },
      event: { deletedAt: null, period: { deletedAt: null } },
      product: { active: false },
    },
    select: {
      qty: true,
      product: { select: { name: true } },
      event: { select: { id: true, lugar: true } },
    },
  });
  return filas.map((f) => ({
    code: "linea-producto-de-baja",
    gravedad: "alta" as const,
    message: `"${f.event.lugar}" pide ${f.qty} de "${f.product!.name}", que está dado de baja del catálogo`,
    url: `/evento/${f.event.id}`,
  }));
}

/** Eventos con el pedido cargado pero sin invitados: casi siempre es un dato
 *  que quedó sin completar, y los invitados es lo que se usa para dimensionar. */
export async function eventosSinInvitados(): Promise<Hallazgo[]> {
  const evs = await prisma.event.findMany({
    where: { deletedAt: null, guests: 0, period: { deletedAt: null }, lines: { some: { qty: { gt: 0 } } } },
    select: { id: true, lugar: true, _count: { select: { lines: true } } },
  });
  return evs.map((e) => ({
    code: "evento-sin-invitados",
    gravedad: "media" as const,
    message: `"${e.lugar}" tiene ${e._count.lines} renglones cargados pero 0 invitados`,
    url: `/evento/${e.id}`,
  }));
}

/** Marcado listo pero sin responsable: el día del evento no se sabe a quién
 *  preguntarle. Es el dato que administra logística. */
export async function eventosListosSinResponsable(): Promise<Hallazgo[]> {
  const evs = await prisma.event.findMany({
    where: {
      deletedAt: null,
      status: "LISTO",
      period: { deletedAt: null },
      OR: [{ responsable: null }, { responsable: "" }],
    },
    select: { id: true, lugar: true },
  });
  return evs.map((e) => ({
    code: "listo-sin-responsable",
    gravedad: "media" as const,
    message: `"${e.lugar}" está marcado listo pero no tiene responsable de la fiesta`,
    url: `/evento/${e.id}`,
  }));
}

/** Eventos que ya vienen y todavía no tienen nada cargado. */
export async function eventosProximosSinPedido(diasDeAviso = 7): Promise<Hallazgo[]> {
  const evs = await prisma.event.findMany({
    where: { deletedAt: null, period: { deletedAt: null }, lines: { none: {} } },
    select: { id: true, lugar: true, date: true },
  });
  const desde = hoy();
  return evs
    .filter((e) => {
      const d = diaDe(e.date);
      const faltan = diasEntre(desde, d);
      return faltan >= 0 && faltan <= diasDeAviso;
    })
    .map((e) => ({
      code: "evento-sin-pedido",
      gravedad: "alta" as const,
      message: `"${e.lugar}" es el ${fmtDia(diaDe(e.date))} y todavía no tiene ningún producto cargado`,
      url: `/evento/${e.id}`,
    }));
}

/**
 * Eventos colgados de un período que no cubre su fecha.
 *
 * No debería poder pasar —las acciones lo impiden— pero si pasara, el pedido
 * contaría contra el stock del grupo equivocado y no se notaría hasta el día.
 * Es barato de comprobar y es exactamente el error que más caro sale.
 */
export async function eventosFueraDeSuPeriodo(): Promise<Hallazgo[]> {
  const evs = await prisma.event.findMany({
    where: { deletedAt: null, period: { deletedAt: null } },
    select: {
      id: true,
      lugar: true,
      date: true,
      period: { select: { label: true, startDay: true, endDay: true } },
    },
  });
  return evs
    .filter((e) => {
      const d = diaDe(e.date);
      return d < e.period.startDay || d > e.period.endDay;
    })
    .map((e) => ({
      code: "evento-fuera-de-periodo",
      gravedad: "alta" as const,
      message: `"${e.lugar}" es el ${fmtDia(diaDe(e.date))} pero cuelga del período ${nombreDe(e.period)}`,
      url: `/evento/${e.id}`,
    }));
}

/** Todas las incoherencias del pedido, juntas. */
export async function incoherenciasDePedido(): Promise<Hallazgo[]> {
  const [baja, sinInv, sinResp, sinPedido, fuera] = await Promise.all([
    pedidosConProductoDeBaja(),
    eventosSinInvitados(),
    eventosListosSinResponsable(),
    eventosProximosSinPedido(),
    eventosFueraDeSuPeriodo(),
  ]);
  const orden = { alta: 0, media: 1, baja: 2 };
  return [...baja, ...fuera, ...sinPedido, ...sinInv, ...sinResp].sort(
    (a, b) => orden[a.gravedad] - orden[b.gravedad]
  );
}

// ---------------------------------------------------------------------------
// A4 — Control de suscripciones
// ---------------------------------------------------------------------------

/**
 * Quién no va a recibir avisos en el celular.
 *
 * Aldana y Enrique llevaban días sin ninguna suscripción y nadie lo sabía: no
 * es un defecto del programa —hay que tocar "Activar notificaciones" en cada
 * teléfono— pero nada lo hacía visible, así que en la práctica era un silencio.
 */
export async function usuariosSinAvisos(): Promise<Hallazgo[]> {
  const us = await prisma.user.findMany({ select: { id: true, name: true } });
  const conSub = new Set(
    (await prisma.pushSubscription.findMany({ select: { userId: true } })).map((s) => s.userId)
  );
  const sin = us.filter((u) => !conSub.has(u.id));
  if (sin.length === 0) return [];
  return [
    {
      code: "usuarios-sin-push",
      gravedad: "media",
      message: `${sin.map((u) => u.name).join(", ")} no ${sin.length === 1 ? "recibe" : "reciben"} avisos en el celular (falta activarlos desde Avisos, en cada teléfono)`,
      url: "/notificaciones",
    },
  ];
}

/**
 * Suscripciones que quedaron sin dueño.
 *
 * `PushSubscription.userId` no tiene una relación formal con `User`, así que
 * dar de baja a alguien puede dejar la suya colgada — y una suscripción sin
 * dueño manda avisos a un teléfono que ya no debería recibirlos.
 */
export async function suscripcionesHuerfanas(): Promise<Hallazgo[]> {
  const subs = await prisma.pushSubscription.findMany({ select: { id: true, userId: true } });
  if (subs.length === 0) return [];
  const ids = new Set((await prisma.user.findMany({ select: { id: true } })).map((u) => u.id));
  const huerfanas = subs.filter((s) => !ids.has(s.userId));
  if (huerfanas.length === 0) return [];
  return [
    {
      code: "suscripciones-huerfanas",
      gravedad: "alta",
      message: `${huerfanas.length} suscripción${huerfanas.length === 1 ? "" : "es"} de aviso quedó sin dueño: sigue mandando a un teléfono de alguien que ya no está`,
    },
  ];
}

/** Los dos controles de avisos, juntos. */
export async function controlDeAvisos(): Promise<Hallazgo[]> {
  const [sin, huerfanas] = await Promise.all([usuariosSinAvisos(), suscripcionesHuerfanas()]);
  return [...huerfanas, ...sin];
}

/** Todo junto, para la revisión diaria y para la pantalla. */
export async function revisarTodo(): Promise<Hallazgo[]> {
  const [pedidos, avisos] = await Promise.all([incoherenciasDePedido(), controlDeAvisos()]);
  return [...pedidos, ...avisos];
}
