import { prisma } from "@/lib/db";

export type SnapshotLine = {
  /** El id del renglón. Las versiones guardadas antes de noviembre de 2026 no
   *  lo traen: ahí el renglón se recrea con un id nuevo, como siempre. */
  id?: string;
  eventId: string;
  productId: string | null;
  customName: string | null;
  customUnit: string | null;
  customCategory: string | null;
  qty: number;
  note: string | null;
};

/** Serializa los pedidos de un finde. Incluye `customCategory`: sin ella, al
 *  restaurar, los ítems fuera de catálogo perdían su sector y se imprimían
 *  todos en Enseres.
 *
 *  Incluye el `id` del renglón. Un ítem suelto no tiene producto: lo que el
 *  depósito tildó de él y lo que se marcó en su levante cuelgan de
 *  `custom:<id del renglón>`. Si al restaurar el renglón volviera con otro id,
 *  esas marcas quedarían apuntando a nada (ver `applySnapshotData`). */
export async function buildSnapshotData(periodId: string): Promise<{ data: string; lineCount: number }> {
  const events = await prisma.event.findMany({ where: { periodId, deletedAt: null }, select: { id: true } });
  const eventIds = events.map((e) => e.id);
  const lines = await prisma.orderLine.findMany({ where: { eventId: { in: eventIds } } });
  const payload: SnapshotLine[] = lines.map((l) => ({
    id: l.id,
    eventId: l.eventId,
    productId: l.productId,
    customName: l.customName,
    customUnit: l.customUnit,
    customCategory: l.customCategory,
    qty: l.qty,
    note: l.note,
  }));
  return { data: JSON.stringify(payload), lineCount: payload.length };
}

/** Crea la versión guardada de un finde solo si todavía no existe.
 *  Sin revalidatePath — seguro de llamar durante el render de una página
 *  (a diferencia de la server action equivalente en app/actions/snapshot.ts). */
export async function ensurePeriodSnapshot(periodId: string) {
  const existing = await prisma.periodSnapshot.findUnique({ where: { periodId } });
  if (existing) return existing;
  const { data } = await buildSnapshotData(periodId);
  try {
    return await prisma.periodSnapshot.create({ data: { periodId, data } });
  } catch (e) {
    // Dos cargas a la vez del mismo período pasado —el navegador precarga la
    // portada dos veces seguidas— llegan las dos a `create`. La segunda choca
    // con la clave única y antes terminaba en un error 500. Si la otra ganó, la
    // versión ya existe y es la que vale: la primera vista del período.
    if ((e as { code?: string }).code === "P2002") {
      const ganadora = await prisma.periodSnapshot.findUnique({ where: { periodId } });
      if (ganadora) return ganadora;
    }
    throw e;
  }
}

/** Guarda una copia recuperable del estado ACTUAL antes de pisarlo, y devuelve
 *  cuántas líneas quedaron resguardadas. Toda acción que reemplace los pedidos
 *  de un finde tiene que pasar por acá primero. */
export async function saveRecoverableVersion(
  periodId: string,
  kind: "PRE_DESCARTE" | "PRE_RESTAURACION" | "PRE_COPIA",
  actor: { id: string; name: string }
): Promise<{ id: string; lineCount: number }> {
  const { data, lineCount } = await buildSnapshotData(periodId);
  const v = await prisma.periodVersion.create({
    data: { periodId, kind, data, lineCount, actorId: actor.id, actorName: actor.name },
  });
  return { id: v.id, lineCount };
}

/** Lo que hizo `applySnapshotData`. */
export type Restauracion = {
  /** Renglones que volvieron al pedido. */
  restauradas: number;
  /** Renglones de la versión que NO volvieron porque su producto ya no existe
   *  en el catálogo (se eliminó después de guardar la versión). */
  omitidas: number;
};

/** El mensaje de una versión que no se puede leer. Lo reconoce la acción para
 *  contestar con un error claro en vez de una excepción cruda. */
export const VERSION_ILEGIBLE = "La versión guardada no se puede leer.";

/** Lee el JSON de una versión. Un dato ilegible no es un pedido vacío: se dice,
 *  y no se toca nada. Se comprueba renglón por renglón lo mínimo que hace falta
 *  para recrearlo. */
export function leerSnapshot(json: string): SnapshotLine[] {
  let crudo: unknown;
  try {
    crudo = JSON.parse(json);
  } catch {
    throw new Error(VERSION_ILEGIBLE);
  }
  if (!Array.isArray(crudo)) throw new Error(VERSION_ILEGIBLE);
  for (const l of crudo) {
    if (typeof l !== "object" || l === null) throw new Error(VERSION_ILEGIBLE);
    const r = l as Record<string, unknown>;
    if (typeof r.eventId !== "string" || !Number.isInteger(r.qty)) throw new Error(VERSION_ILEGIBLE);
    if (r.productId !== null && typeof r.productId !== "string") throw new Error(VERSION_ILEGIBLE);
  }
  return crudo as SnapshotLine[];
}

/** Reemplaza los pedidos de un finde por los de un JSON de versión.
 *  Sólo toca eventos vivos: un evento en la papelera no revive por esto.
 *
 *  Dos cuidados, los dos con un caso concreto atrás:
 *
 *  - **Un producto que ya no existe no vuelve, y no frena al resto.** Un
 *    producto dado de alta sin contar, usado en un pedido y después eliminado
 *    del catálogo seguía nombrado en la versión guardada. Recrear ese renglón
 *    chocaba con la clave foránea, el lote entero volvía atrás, y ese período
 *    no se podía descartar ni restaurar nunca más. Ahora ese renglón se saltea
 *    y se cuenta en `omitidas`, para que la pantalla lo pueda decir.
 *
 *  - **Cada renglón vuelve con su mismo id**, cuando la versión lo trae y está
 *    libre. Lo tildado y lo marcado en el levante de un ítem suelto cuelgan de
 *    ese id (`custom:<id>`); con un id nuevo, un "faltan 2" del levante se
 *    perdía al descartar. Las versiones viejas no traen id: para esas siguen
 *    estando `reasignarSueltos` y `reasignarSueltosDeLevante`. */
export async function applySnapshotData(periodId: string, json: string): Promise<Restauracion> {
  const events = await prisma.event.findMany({ where: { periodId, deletedAt: null }, select: { id: true } });
  const validEventIds = new Set(events.map((e) => e.id));

  const delPeriodo = leerSnapshot(json).filter((l) => validEventIds.has(l.eventId));

  // Los productos que siguen existiendo. Dado de baja (inactivo) cuenta: sigue
  // en la base y el pedido lo muestra marcado. Lo que no vuelve es lo borrado.
  const productIds = [...new Set(delPeriodo.map((l) => l.productId).filter((id): id is string => id !== null))];
  const existentes = new Set(
    (productIds.length === 0 ? [] : await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true } })).map(
      (p) => p.id,
    ),
  );
  const toRestore = delPeriodo.filter((l) => l.productId === null || existentes.has(l.productId));
  const omitidas = delPeriodo.length - toRestore.length;

  // Un id de la versión solo se reusa si queda libre después de borrar los
  // renglones de los eventos vivos del período. No debería haber otro renglón
  // con ese id (los renglones no cambian de evento), pero si lo hubiera —su
  // evento pasó a la papelera— el choque volvería atrás toda la restauración:
  // ese renglón nace con un id nuevo y listo.
  const ids = toRestore.map((l) => l.id).filter((id): id is string => typeof id === "string" && id.length > 0);
  const ocupados = new Set(
    (ids.length === 0
      ? []
      : await prisma.orderLine.findMany({ where: { id: { in: ids }, eventId: { notIn: [...validEventIds] } }, select: { id: true } })
    ).map((l) => l.id),
  );
  const usados = new Set<string>();
  const idPara = (l: SnapshotLine): string | undefined => {
    if (typeof l.id !== "string" || l.id.length === 0 || ocupados.has(l.id) || usados.has(l.id)) return undefined;
    usados.add(l.id);
    return l.id;
  };

  await prisma.$transaction([
    prisma.orderLine.deleteMany({ where: { eventId: { in: [...validEventIds] } } }),
    ...toRestore.map((l) =>
      prisma.orderLine.create({
        data: {
          id: idPara(l),
          eventId: l.eventId,
          productId: l.productId,
          customName: l.customName,
          customUnit: l.customUnit,
          customCategory: l.customCategory ?? null,
          qty: l.qty,
          note: l.note,
        },
      })
    ),
  ]);

  return { restauradas: toRestore.length, omitidas };
}
