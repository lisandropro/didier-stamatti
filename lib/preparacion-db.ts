import { prisma } from "@/lib/db";
import { diaDe, hoy, instanteDe, sumarDias } from "@/lib/dates";
import { nombreDeCategoria, ordenDeCategoria } from "@/lib/categories";
import {
  avancePorSector,
  cambiosParaAplicar,
  claveDeLinea,
  estadoDeItems,
  paraTildarSector,
  sePuedeDestildar,
  type ItemPreparacion,
  type LineaPedido,
  type Tildado,
  type Visto,
  type VistoDeSector,
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
 * Tildar un ítem: guarda la cantidad y la nota que se VIERON en la fila, no
 * las del pedido al llegar el toque (ver `Visto`). Si el pedido cambió en el
 * medio, el ítem queda en CAMBIO o NOTA y se ve en "Cambios para aplicar": no
 * hace falta nada más, es justamente lo que tiene que pasar.
 *
 * Lo que se vio para sacar (SACAR) se confirma borrando la fila: ya se sacó y
 * no queda nada que recordar. Si mientras tanto el ítem volvió al pedido, queda
 * PENDIENTE, que es la verdad: lo que se sacó ya no está preparado.
 *
 * Nombre, unidad y sector salen del renglón de ahora. Si el renglón ya no está
 * pero el ítem estaba tildado, se pone al día esa fila con lo visto: queda en
 * SACAR, con la cantidad que de verdad se juntó.
 */
export async function tildar(
  eventId: string,
  clave: string,
  actor: { id: string; name: string },
  visto: Visto,
): Promise<"tildado" | "sacado" | "no-existe"> {
  return prisma.$transaction(async (tx) => {
    if (visto.estado === "SACAR") {
      const borrado = await tx.preparacion.deleteMany({ where: { eventId, clave } });
      return borrado.count > 0 ? "sacado" : "no-existe";
    }
    const loVisto = { qty: visto.qty, note: visto.note, porId: actor.id, porName: actor.name, at: new Date() };
    const linea = (await lineasDelEvento(tx, eventId)).find((l) => l.clave === clave && l.qty > 0);
    if (linea) {
      const datos = { itemName: linea.itemName, unit: linea.unit, category: linea.category, ...loVisto };
      await tx.preparacion.upsert({
        where: { eventId_clave: { eventId, clave } },
        update: datos,
        create: { eventId, clave, ...datos },
      });
      return "tildado";
    }
    const puesta = await tx.preparacion.updateMany({ where: { eventId, clave }, data: loVisto });
    return puesta.count > 0 ? "tildado" : "no-existe";
  });
}

/**
 * Destildar: para errores de quien tilda. Borra la fila, pero solo si el ítem
 * sigue PREPARADO como se vio (`sePuedeDestildar`). Un ✓ viejo en la pantalla
 * no puede borrar un "Sumá 14" que llegó después: en ese caso no se toca nada y
 * vuelve "cambio", para que la pantalla se ponga al día.
 */
export async function destildar(eventId: string, clave: string, visto: Visto): Promise<"destildado" | "cambio"> {
  return prisma.$transaction(async (tx) => {
    const item = (await estadoDelEvento(eventId, tx)).find((i) => i.clave === clave);
    if (!sePuedeDestildar(item, visto)) return "cambio";
    await tx.preparacion.deleteMany({ where: { eventId, clave } });
    return "destildado";
  });
}

/**
 * Tilda de una vez lo PENDIENTE de un sector que se vio y sigue igual
 * (`paraTildarSector`), con lo que se vio. Devuelve cuántas filas creó y
 * cuántos de los vistos salteó porque cambiaron mientras tanto.
 */
export async function tildarSector(
  eventId: string,
  category: string,
  actor: { id: string; name: string },
  vistos: VistoDeSector[],
): Promise<{ tildados: number; salteados: number }> {
  return prisma.$transaction(async (tx) => {
    const lineas = await lineasDelEvento(tx, eventId);
    const items = estadoDeItems(lineas, await tildadosDelEvento(tx, eventId));
    const { claves, salteados } = paraTildarSector(items, category, vistos);
    if (claves.length === 0) return { tildados: 0, salteados };
    const linea = new Map(lineas.map((l) => [l.clave, l]));
    // El primero de cada clave: es el que `paraTildarSector` comparó.
    const visto = new Map<string, VistoDeSector>();
    for (const v of vistos) if (!visto.has(v.clave)) visto.set(v.clave, v);

    // Se cuentan las filas que hay antes y después, y no los upsert: un upsert
    // que encontró la fila hecha no tildó nada, y el número tiene que decir
    // cuántos tildó ESTE toque.
    const yaEstaban = await tx.preparacion.count({ where: { eventId, clave: { in: claves } } });
    for (const clave of claves) {
      const l = linea.get(clave)!;
      const v = visto.get(clave)!;
      // upsert y no create: si dos teléfonos tildan el mismo sector a la vez, el
      // segundo encuentra la fila hecha y no la pisa ni choca con la clave única.
      await tx.preparacion.upsert({
        where: { eventId_clave: { eventId, clave } },
        update: {},
        create: {
          eventId,
          clave,
          itemName: l.itemName,
          unit: l.unit,
          category: l.category,
          qty: v.qty,
          note: v.note,
          porId: actor.id,
          porName: actor.name,
        },
      });
    }
    const hay = await tx.preparacion.count({ where: { eventId, clave: { in: claves } } });
    return { tildados: hay - yaEstaban, salteados };
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
