import { prisma } from "@/lib/db";
import { diaDe, hoy, instanteDe, sumarDias } from "@/lib/dates";
import { claveDeLinea } from "@/lib/preparacion";
import { canEditStock } from "@/lib/permissions";
import { sendPushToUser } from "@/lib/push";
import { moverStock } from "@/lib/stock";
import {
  DIAS_PARA_LEVANTAR,
  bajaDe,
  itemsDeLevante,
  linkDelLevante,
  notaDeBaja,
  ordenarLevante,
  paraMarcarSector,
  productoDeClave,
  resumenDeLevante,
  stockDespuesDeBaja,
  textoDelLevante,
  vuelveDelEvento,
  type Baja,
  type ItemLevante,
  type LineaLevante,
  type Marca,
  type MotivoBaja,
  type VistoDeLevante,
} from "@/lib/levante";

// El levante contra la base: leer lo que vuelve y lo marcado, marcar y
// desmarcar. El cálculo vive en lib/levante.ts, que es puro.
//
// Toda escritura va en una transacción que primero mira que el levante siga
// abierto (evento vivo y sin terminar): terminar y marcar a la vez desde dos
// teléfonos no puede dejar una marca nueva en un levante ya avisado.

/** `prisma` o el cliente de una transacción: lo que hace falta para leer. */
export type Db = Pick<typeof prisma, "orderLine" | "levante" | "event">;

export type Actor = { id: string; name: string };

/** Un evento vivo: ni él ni su período en la papelera. */
const VIVO = { deletedAt: null, period: { deletedAt: null } };

/** Lo que vuelve del evento según su pedido de ahora, con nombre, unidad y sector. */
export async function lineasParaLevantar(db: Db, eventId: string): Promise<LineaLevante[]> {
  const lineas = await db.orderLine.findMany({
    where: { eventId },
    include: { product: { select: { name: true, unit: true, category: true, type: true } } },
  });
  return lineas
    .filter((l) => vuelveDelEvento({ productId: l.productId, productType: l.product?.type ?? null, qty: l.qty }))
    .map((l) => ({
      clave: claveDeLinea(l),
      itemName: l.product?.name ?? l.customName ?? "Ítem",
      unit: l.product?.unit ?? l.customUnit ?? "Unidad",
      category: l.product?.category ?? l.customCategory ?? "ENSERES",
      qty: l.qty,
      note: l.note,
    }));
}

async function marcasDelEvento(db: Db, eventId: string): Promise<Marca[]> {
  const filas = await db.levante.findMany({ where: { eventId } });
  return filas.map((f) => ({
    clave: f.clave,
    itemName: f.itemName,
    unit: f.unit,
    category: f.category,
    qty: f.qty,
    faltan: f.faltan,
    porName: f.porName,
    at: f.at,
    descontado: f.descontadoAt
      ? { motivo: f.descontadoMotivo ?? "", porName: f.descontadoPorName ?? "", at: f.descontadoAt }
      : null,
  }));
}

/** El estado de cada ítem del levante, ordenado por sector y por nombre. */
export async function levanteDelEvento(eventId: string, db: Db = prisma): Promise<ItemLevante[]> {
  const [lineas, marcas] = await Promise.all([lineasParaLevantar(db, eventId), marcasDelEvento(db, eventId)]);
  return ordenarLevante(itemsDeLevante(lineas, marcas));
}

/** ¿Se puede marcar? El evento sigue vivo y su levante no se terminó. */
async function abierto(db: Db, eventId: string): Promise<boolean> {
  return (await db.event.count({ where: { id: eventId, ...VIVO, levanteAt: null } })) > 0;
}

/** `cambio`: el pedido no dice lo que mostraba la fila. `cerrado`: el levante
 *  se terminó o el evento ya no está. `descontado`: ese faltante ya bajó el
 *  stock y no se toca. */
export type ResultadoMarca = "marcado" | "cambio" | "no-existe" | "cerrado" | "descontado";

/**
 * Marca un ítem con cuántos no volvieron (0 = volvió todo).
 *
 * `mandado` es la cantidad que mostraba la fila. Si el pedido cambió entre el
 * dibujo y el toque, no se marca un número que nadie vio: vuelve "cambio" y la
 * pantalla se pone al día. Nombre, unidad y sector salen del renglón de ahora.
 * El rango de `faltan` lo comprueba la acción (`esFaltaValida`).
 */
async function marcar(eventId: string, clave: string, actor: Actor, mandado: number, faltan: number): Promise<ResultadoMarca> {
  return prisma.$transaction(async (tx): Promise<ResultadoMarca> => {
    if (!(await abierto(tx, eventId))) return "cerrado";
    const linea = (await lineasParaLevantar(tx, eventId)).find((l) => l.clave === clave);
    if (!linea) return "no-existe";
    if (linea.qty !== mandado) return "cambio";
    const datos = {
      itemName: linea.itemName,
      unit: linea.unit,
      category: linea.category,
      qty: linea.qty,
      faltan,
      porId: actor.id,
      porName: actor.name,
      at: new Date(),
    };
    return (await escribirMarca(tx, eventId, clave, datos)) ? "marcado" : "descontado";
  });
}

/**
 * Escribe una marca sin pisar un renglón ya descontado del stock. La guarda va
 * en la escritura misma (`descontadoAt: null`) y no solo en una lectura previa:
 * lo descontado ya movió el stock y no se vuelve a tocar, pase lo que pase en el
 * medio. Devuelve `false` si el renglón está descontado y no se escribió nada.
 */
async function escribirMarca(
  tx: Pick<typeof prisma, "levante">,
  eventId: string,
  clave: string,
  datos: { itemName: string; unit: string; category: string; qty: number; faltan: number; porId: string; porName: string; at: Date },
): Promise<boolean> {
  const hecha = await tx.levante.updateMany({ where: { eventId, clave, descontadoAt: null }, data: datos });
  if (hecha.count === 1) return true;
  const existe = await tx.levante.findUnique({ where: { eventId_clave: { eventId, clave } }, select: { id: true } });
  if (existe) return false;
  await tx.levante.create({ data: { eventId, clave, ...datos } });
  return true;
}

/** Volvió todo lo que se mandó de este ítem. */
export function marcarVolvio(eventId: string, clave: string, actor: Actor, mandado: number): Promise<ResultadoMarca> {
  return marcar(eventId, clave, actor, mandado, 0);
}

/** No volvieron `faltan` de los `mandado`. También corrige un faltante ya marcado. */
export function marcarFalta(eventId: string, clave: string, actor: Actor, mandado: number, faltan: number): Promise<ResultadoMarca> {
  return marcar(eventId, clave, actor, mandado, faltan);
}

/**
 * Desmarca un ítem: vuelve a quedar sin revisar. Solo si sigue como se vio
 * (`faltanVisto`): un "volvió todo" viejo en la pantalla no puede borrar el
 * "faltan 3" que otro teléfono marcó después. Lo descontado no se desmarca.
 */
export async function desmarcar(eventId: string, clave: string, faltanVisto: number): Promise<"desmarcado" | "cambio" | "cerrado"> {
  return prisma.$transaction(async (tx) => {
    if (!(await abierto(tx, eventId))) return "cerrado" as const;
    const borrada = await tx.levante.deleteMany({ where: { eventId, clave, faltan: faltanVisto, descontadoAt: null } });
    return borrada.count > 0 ? ("desmarcado" as const) : ("cambio" as const);
  });
}

/**
 * "Tachar todo el sector": marca como "volvió todo" lo pendiente del sector que
 * se vio y sigue igual (`paraMarcarSector`). Devuelve cuántos marcó este toque
 * y cuántos de los vistos salteó porque cambiaron mientras tanto.
 */
export async function marcarSector(
  eventId: string,
  category: string,
  actor: Actor,
  vistos: VistoDeLevante[],
): Promise<{ resultado: "ok" | "cerrado"; marcados: number; salteados: number }> {
  return prisma.$transaction(async (tx) => {
    if (!(await abierto(tx, eventId))) return { resultado: "cerrado" as const, marcados: 0, salteados: 0 };
    const items = await levanteDelEvento(eventId, tx);
    const { claves, salteados } = paraMarcarSector(items, category, vistos);
    const porClave = new Map(items.map((i) => [i.clave, i]));
    const at = new Date();
    let marcados = 0;
    for (const clave of claves) {
      const i = porClave.get(clave)!;
      const datos = { itemName: i.itemName, unit: i.unit, category: i.category, qty: i.qty, faltan: 0, porId: actor.id, porName: actor.name, at };
      // Actualiza y no solo crea: un ítem pendiente puede tener una marca vieja
      // (el pedido cambió después de marcarlo), y esa se pisa con lo de ahora.
      // Un renglón descontado nunca se pisa: se saltea.
      if (await escribirMarca(tx, eventId, clave, datos)) marcados++;
    }
    return { resultado: "ok" as const, marcados, salteados: salteados + (claves.length - marcados) };
  });
}

export type EventoParaLevantar = {
  id: string;
  lugar: string;
  date: Date;
  dia: string;
  /** Lo revisado ("Levante · N de M"). */
  marcados: number;
  total: number;
};

/**
 * Los eventos vivos con el levante sin terminar, desde su día (en Argentina)
 * hasta `DIAS_PARA_LEVANTAR` días para atrás. El más reciente primero: es el
 * que se está levantando. Un evento sin nada que vuelva (sin pedido, o solo
 * consumibles) no tiene levante y no aparece.
 */
export async function eventosParaLevantar(hoyDia: string = hoy()): Promise<EventoParaLevantar[]> {
  const eventos = await prisma.event.findMany({
    where: {
      ...VIVO,
      levanteAt: null,
      date: { gte: instanteDe(sumarDias(hoyDia, -DIAS_PARA_LEVANTAR), "00:00"), lt: instanteDe(sumarDias(hoyDia, 1), "00:00") },
    },
    orderBy: { date: "desc" },
    select: { id: true, lugar: true, date: true },
  });
  const out: EventoParaLevantar[] = [];
  for (const e of eventos) {
    const { total, marcados } = resumenDeLevante(await levanteDelEvento(e.id));
    if (total === 0) continue;
    out.push({ ...e, dia: diaDe(e.date), marcados, total });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Terminar y reabrir
// ---------------------------------------------------------------------------

/** `confirmar`: cambió cuántos quedan sin revisar desde que se preguntó; trae
 *  el número de ahora para volver a preguntar. `ya`: otro teléfono lo terminó.
 *  `vacio`: el evento no tiene nada que vuelva (la pantalla no lo ofrece; esto
 *  frena un llamado directo, que avisaría "Levante de X:" sin nada). */
export type ResultadoTerminar =
  | { r: "terminado"; avisados: number }
  | { r: "confirmar"; sinRevisar: number }
  | { r: "ya" }
  | { r: "vacio" }
  | { r: "no-existe" };

/**
 * Termina el levante y le avisa a quien puede tocar el stock.
 *
 * `sinRevisarVisto` es el número que se confirmó en la pantalla ("Quedan 3 sin
 * revisar"). Si mientras tanto otro teléfono marcó o desmarcó algo, no se
 * termina: vuelve "confirmar" con el número de ahora. Salvo que ahora sea 0: ya
 * no hay nada que confirmar ("Quedan 0 sin revisar" sería una pregunta de más) y
 * se termina. Lo que queda sin revisar queda así, no como faltante.
 *
 * La marca del evento es condicionada (`levanteAt: null`) y los avisos de la
 * app se crean en la misma transacción: con dos teléfonos a la vez, termina y
 * avisa uno solo, y no puede quedar un levante terminado sin su aviso. El push
 * sale después, fuera de la transacción: `sendPushToUser` nunca lanza. No le
 * llega a quien lo terminó (como el resto de los avisos de la app).
 */
export async function terminarLevante(
  eventId: string,
  actor: Actor,
  sinRevisarVisto: number,
  ahora: Date = new Date(),
): Promise<ResultadoTerminar> {
  const hecho = await prisma.$transaction(async (tx) => {
    const ev = await tx.event.findFirst({ where: { id: eventId, ...VIVO }, select: { lugar: true, levanteAt: true } });
    if (!ev) return { r: "no-existe" as const };
    if (ev.levanteAt) return { r: "ya" as const };
    const items = await levanteDelEvento(eventId, tx);
    if (items.length === 0) return { r: "vacio" as const };
    const { sinRevisar } = resumenDeLevante(items);
    if (sinRevisar !== sinRevisarVisto && sinRevisar > 0) return { r: "confirmar" as const, sinRevisar };
    const puesta = await tx.event.updateMany({
      where: { id: eventId, levanteAt: null },
      data: { levanteAt: ahora, levantePorId: actor.id, levantePorName: actor.name },
    });
    if (puesta.count !== 1) return { r: "ya" as const };
    const texto = textoDelLevante(ev.lugar, items, actor.name);
    const link = linkDelLevante(eventId);
    const personas = await tx.user.findMany({ where: { id: { not: actor.id } }, select: { id: true, role: true }, orderBy: { name: "asc" } });
    const avisos: { id: string; userId: string }[] = [];
    for (const u of personas.filter((p) => canEditStock(p.role))) {
      const n = await tx.notification.create({
        data: {
          recipientId: u.id,
          actorName: actor.name,
          type: "LEVANTE",
          message: texto.mensaje,
          eventId,
          linkUrl: link,
          // El push sale acá mismo: nace marcado como enviado para que ningún
          // barrido lo vuelva a mandar (como el resumen de la mañana).
          pushedAt: ahora,
        },
      });
      avisos.push({ id: n.id, userId: u.id });
    }
    return { r: "terminado" as const, texto, link, avisos };
  });
  if (hecho.r !== "terminado") return hecho;
  for (const a of hecho.avisos) {
    await sendPushToUser(
      a.userId,
      { title: hecho.texto.title, body: hecho.texto.body, url: hecho.link, tag: `levante-${eventId}` },
      { kind: "LEVANTE", notificationId: a.id },
    );
  }
  return { r: "terminado", avisados: hecho.avisos.length };
}

/**
 * Reabre un levante terminado para corregirlo: el evento vuelve a "Para
 * levantar" (si está dentro de la semana) y se puede marcar de nuevo. Lo ya
 * descontado del stock no se toca. Condicionado: con dos toques, reabre uno.
 */
export async function reabrirLevante(eventId: string): Promise<"reabierto" | "ya" | "no-existe"> {
  const ev = await prisma.event.findFirst({ where: { id: eventId, ...VIVO }, select: { id: true } });
  if (!ev) return "no-existe";
  const r = await prisma.event.updateMany({
    where: { id: eventId, levanteAt: { not: null } },
    data: { levanteAt: null, levantePorId: null, levantePorName: null },
  });
  return r.count === 1 ? "reabierto" : "ya";
}

// ---------------------------------------------------------------------------
// Descontar del stock lo que no volvió
// ---------------------------------------------------------------------------

/** `abierto`: el levante no está terminado (se reabrió). `cambio`: el stock
 *  cambió entre la lectura y la escritura; se puede volver a intentar. El resto
 *  de los motivos son los de `bajaDe`. */
export type ResultadoDescuento = "descontado" | "ya" | "abierto" | "no-existe" | "cambio" | Exclude<Baja, "DESCONTABLE">;

/** Para deshacer la marca de descontado si el stock no se pudo mover. */
class StockCambio extends Error {}

/**
 * Da de baja del stock lo que no volvió de un ítem, una sola vez.
 *
 * Solo en un levante terminado y sobre un ítem que hoy figura como FALTA. La
 * marca del renglón va primero y condicionada (`descontadoAt: null`): de dos
 * toques a la vez, uno solo la pone y uno solo descuenta. El stock se mueve por
 * el mismo camino que el ajuste de Inventario (`moverStock`): mismo control de
 * que nadie lo cambió en el medio, mismo movimiento en el historial. Si ese
 * control falla, se deshace la marca (la transacción entera vuelve atrás).
 */
export async function descontarFaltante(eventId: string, clave: string, motivo: MotivoBaja, actor: Actor): Promise<ResultadoDescuento> {
  try {
    return await prisma.$transaction(async (tx): Promise<ResultadoDescuento> => {
      const ev = await tx.event.findFirst({ where: { id: eventId, ...VIVO }, select: { lugar: true, date: true, levanteAt: true } });
      if (!ev) return "no-existe";
      if (!ev.levanteAt) return "abierto";
      const item = (await levanteDelEvento(eventId, tx)).find((i) => i.clave === clave);
      if (!item || item.estado !== "FALTA") return "no-existe";
      if (item.descontado) return "ya";
      const productId = productoDeClave(clave);
      const producto = productId ? await tx.product.findUnique({ where: { id: productId }, select: { type: true, stock: true } }) : null;
      const baja = bajaDe(clave, producto);
      if (baja !== "DESCONTABLE") return baja;
      // `bajaDe` ya garantizó un producto reutilizable con stock contado y mayor que 0.
      const stock = producto!.stock!;
      const marcada = await tx.levante.updateMany({
        where: { eventId, clave, descontadoAt: null },
        data: { descontadoMotivo: motivo, descontadoAt: new Date(), descontadoPorId: actor.id, descontadoPorName: actor.name },
      });
      if (marcada.count !== 1) return "ya";
      const r = await moverStock(
        tx,
        {
          productId: productId!,
          expectedStock: stock,
          newStock: stockDespuesDeBaja(stock, item.faltan),
          reason: motivo,
          note: notaDeBaja(ev.lugar, ev.date),
        },
        actor.id,
      );
      if (!r.ok) throw new StockCambio();
      return "descontado";
    });
  } catch (e) {
    if (e instanceof StockCambio) return "cambio";
    throw e;
  }
}
