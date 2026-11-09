import { prisma } from "@/lib/db";
import { diaDe, hoy, instanteDe, sumarDias } from "@/lib/dates";
import { claveDeLinea } from "@/lib/preparacion";
import {
  DIAS_PARA_LEVANTAR,
  itemsDeLevante,
  ordenarLevante,
  paraMarcarSector,
  resumenDeLevante,
  vuelveDelEvento,
  type ItemLevante,
  type LineaLevante,
  type Marca,
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
    const previa = await tx.levante.findUnique({ where: { eventId_clave: { eventId, clave } }, select: { descontadoAt: true } });
    if (previa?.descontadoAt) return "descontado";
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
    await tx.levante.upsert({
      where: { eventId_clave: { eventId, clave } },
      update: datos,
      create: { eventId, clave, ...datos },
    });
    return "marcado";
  });
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
    for (const clave of claves) {
      const i = porClave.get(clave)!;
      const datos = { itemName: i.itemName, unit: i.unit, category: i.category, qty: i.qty, faltan: 0, porId: actor.id, porName: actor.name, at };
      // upsert y no create: un ítem pendiente puede tener una marca vieja (el
      // pedido cambió después de marcarlo), y esa se pisa con lo de ahora.
      await tx.levante.upsert({ where: { eventId_clave: { eventId, clave } }, update: datos, create: { eventId, clave, ...datos } });
    }
    return { resultado: "ok" as const, marcados: claves.length, salteados };
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
