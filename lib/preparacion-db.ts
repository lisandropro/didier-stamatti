import { prisma } from "@/lib/db";
import { diaDe, hoy, instanteDe, sumarDias } from "@/lib/dates";
import { nombreDeCategoria, ordenDeCategoria } from "@/lib/categories";
import {
  avancePorSector,
  cambiosParaAplicar,
  claveDeLinea,
  clavesParaTildarSector,
  estadoDeItems,
  type ItemPreparacion,
  type LineaPedido,
  type Tildado,
} from "@/lib/preparacion";

// La preparación contra la base: leer el pedido y lo tildado, tildar y
// destildar. El cálculo del estado vive en lib/preparacion.ts, que es puro.

/** `prisma` o el cliente de una transacción: lo que hace falta para leer. */
export type Db = Pick<typeof prisma, "orderLine" | "preparacion">;

/** Los eventos que el depósito tiene a la vista: de hoy a dos semanas. */
export const DIAS_A_PREPARAR = 14;

/** Los renglones del pedido de un evento, con nombre, unidad y sector. */
export async function lineasDelEvento(db: Db, eventId: string): Promise<LineaPedido[]> {
  const lineas = await db.orderLine.findMany({
    where: { eventId },
    include: { product: { select: { name: true, unit: true, category: true } } },
  });
  return lineas.map((l) => ({
    clave: claveDeLinea(l),
    itemName: l.product?.name ?? l.customName ?? "Ítem",
    unit: l.product?.unit ?? l.customUnit ?? "Unidad",
    category: l.product?.category ?? l.customCategory ?? "ENSERES",
    qty: l.qty,
    note: l.note,
  }));
}

async function tildadosDelEvento(db: Db, eventId: string): Promise<Tildado[]> {
  const filas = await db.preparacion.findMany({ where: { eventId } });
  return filas.map((f) => ({
    clave: f.clave,
    itemName: f.itemName,
    unit: f.unit,
    category: f.category,
    qty: f.qty,
    note: f.note,
    porName: f.porName,
    at: f.at,
  }));
}

function ordenar(items: ItemPreparacion[]): ItemPreparacion[] {
  return items.sort(
    (a, b) => ordenDeCategoria(a.category) - ordenDeCategoria(b.category) || a.itemName.localeCompare(b.itemName, "es"),
  );
}

/** El estado de cada ítem del evento, ordenado por sector y por nombre. */
export async function estadoDelEvento(eventId: string, db: Db = prisma): Promise<ItemPreparacion[]> {
  const [lineas, tildados] = await Promise.all([lineasDelEvento(db, eventId), tildadosDelEvento(db, eventId)]);
  return ordenar(estadoDeItems(lineas, tildados));
}

/** ¿Este ítem ya está tildado? Lo usa el pedido para saber si un cambio es tardío. */
export async function estaTildado(db: Db, eventId: string, clave: string): Promise<boolean> {
  return (await db.preparacion.count({ where: { eventId, clave } })) > 0;
}

/** ¿El evento tiene algo tildado? Para copiar o restaurar un pedido entero. */
export async function hayTildados(db: Db, eventId: string): Promise<boolean> {
  return (await db.preparacion.count({ where: { eventId } })) > 0;
}

/**
 * Tildar un ítem: copia lo que hay en el pedido ahora. Si el ítem ya no está en
 * el pedido (estado SACAR), tildarlo es confirmar que se sacó: la fila se borra
 * y no queda nada que recordar.
 */
export async function tildar(
  eventId: string,
  clave: string,
  actor: { id: string; name: string },
): Promise<"tildado" | "sacado" | "no-existe"> {
  return prisma.$transaction(async (tx) => {
    const linea = (await lineasDelEvento(tx, eventId)).find((l) => l.clave === clave && l.qty > 0);
    if (linea) {
      const datos = {
        itemName: linea.itemName,
        unit: linea.unit,
        category: linea.category,
        qty: linea.qty,
        note: linea.note,
        porId: actor.id,
        porName: actor.name,
        at: new Date(),
      };
      await tx.preparacion.upsert({
        where: { eventId_clave: { eventId, clave } },
        update: datos,
        create: { eventId, clave, ...datos },
      });
      return "tildado";
    }
    const borrado = await tx.preparacion.deleteMany({ where: { eventId, clave } });
    return borrado.count > 0 ? "sacado" : "no-existe";
  });
}

/** Destildar: para errores de quien tilda. Borra la fila. */
export async function destildar(eventId: string, clave: string): Promise<boolean> {
  return (await prisma.preparacion.deleteMany({ where: { eventId, clave } })).count > 0;
}

/** Tilda de una vez todo lo PENDIENTE de un sector. Devuelve cuántos tildó. */
export async function tildarSector(eventId: string, category: string, actor: { id: string; name: string }): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const lineas = await lineasDelEvento(tx, eventId);
    const items = estadoDeItems(lineas, await tildadosDelEvento(tx, eventId));
    const claves = new Set(clavesParaTildarSector(items, category));
    let n = 0;
    for (const l of lineas) {
      if (!claves.has(l.clave)) continue;
      await tx.preparacion.create({
        data: {
          eventId,
          clave: l.clave,
          itemName: l.itemName,
          unit: l.unit,
          category: l.category,
          qty: l.qty,
          note: l.note,
          porId: actor.id,
          porName: actor.name,
        },
      });
      n++;
    }
    return n;
  });
}

export type EventoParaPreparar = {
  id: string;
  lugar: string;
  date: Date;
  dia: string;
  avance: { category: string; label: string; listos: number; total: number }[];
  cambiosParaAplicar: number;
};

/** Los eventos vivos de hoy a `DIAS_A_PREPARAR` días, con su avance por sector
 *  y cuántos cambios hay para aplicar. */
export async function eventosParaPreparar(hoyDia: string = hoy()): Promise<EventoParaPreparar[]> {
  const eventos = await prisma.event.findMany({
    where: {
      deletedAt: null,
      period: { deletedAt: null },
      date: { gte: instanteDe(hoyDia, "00:00"), lt: instanteDe(sumarDias(hoyDia, DIAS_A_PREPARAR + 1), "00:00") },
    },
    orderBy: { date: "asc" },
    select: { id: true, lugar: true, date: true },
  });
  const out: EventoParaPreparar[] = [];
  for (const e of eventos) {
    const items = await estadoDelEvento(e.id);
    const avance = [...avancePorSector(items)]
      .sort(([a], [b]) => ordenDeCategoria(a) - ordenDeCategoria(b))
      .map(([category, a]) => ({ category, label: nombreDeCategoria(category), ...a }));
    out.push({ ...e, dia: diaDe(e.date), avance, cambiosParaAplicar: cambiosParaAplicar(items).length });
  }
  return out;
}
