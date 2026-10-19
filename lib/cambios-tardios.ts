import { prisma } from "@/lib/db";
import { diaDe } from "@/lib/dates";

// El registro de cambios tardíos: lo que se cambió en un pedido después de que
// el depósito lo preparó. Es para medir el problema y hablarlo con datos: cuántos,
// en qué eventos, quién, y cuántos el día del evento o después.

/** Cuántos cambios se listan por evento. Los totales cuentan todos: el tope es
 *  solo para que la página no se haga eterna, nunca para los números. */
export const DETALLE_POR_EVENTO = 100;

export type CambioTardio = {
  id: string;
  at: Date;
  actorName: string;
  itemName: string;
  kind: string;
  before: string | null;
  after: string | null;
  /** El día del evento o después: el que menos margen deja. */
  mismoDia: boolean;
};
export type EventoTardio = { eventId: string; lugar: string; date: Date; total: number; mismoDia: number; cambios: CambioTardio[] };
export type PersonaTardia = { actorName: string; total: number; eventos: number; mismoDia: number };

export async function registroTardio(periodId?: string): Promise<{ total: number; eventos: EventoTardio[]; personas: PersonaTardia[] }> {
  // Solo lo vivo, como las pestañas de períodos: un evento en la papelera no se
  // ve en ningún otro lado y acá parecería vigente.
  const filas = await prisma.orderChange.findMany({
    where: {
      tardio: true,
      event: { deletedAt: null, period: { deletedAt: null }, ...(periodId ? { periodId } : {}) },
    },
    orderBy: { createdAt: "desc" },
    // Sin tope: los números tienen que ser los de verdad. Son pocos campos por
    // fila y la página es solo de la administradora.
    select: {
      id: true,
      eventId: true,
      createdAt: true,
      actorName: true,
      itemName: true,
      kind: true,
      before: true,
      after: true,
      event: { select: { lugar: true, date: true } },
    },
  });

  const eventos = new Map<string, EventoTardio>();
  const personas = new Map<string, { total: number; eventos: Set<string>; mismoDia: number }>();
  for (const f of filas) {
    const mismoDia = diaDe(f.createdAt) >= diaDe(f.event.date);
    const e = eventos.get(f.eventId) ?? { eventId: f.eventId, lugar: f.event.lugar, date: f.event.date, total: 0, mismoDia: 0, cambios: [] };
    e.total++;
    if (mismoDia) e.mismoDia++;
    if (e.cambios.length < DETALLE_POR_EVENTO) {
      e.cambios.push({ id: f.id, at: f.createdAt, actorName: f.actorName, itemName: f.itemName, kind: f.kind, before: f.before, after: f.after, mismoDia });
    }
    eventos.set(f.eventId, e);
    const p = personas.get(f.actorName) ?? { total: 0, eventos: new Set<string>(), mismoDia: 0 };
    p.total++;
    p.eventos.add(f.eventId);
    if (mismoDia) p.mismoDia++;
    personas.set(f.actorName, p);
  }

  return {
    total: filas.length,
    eventos: [...eventos.values()].sort((a, b) => b.date.getTime() - a.date.getTime()),
    personas: [...personas]
      .map(([actorName, p]) => ({ actorName, total: p.total, eventos: p.eventos.size, mismoDia: p.mismoDia }))
      .sort((a, b) => b.total - a.total || a.actorName.localeCompare(b.actorName, "es")),
  };
}
