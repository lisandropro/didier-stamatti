import { fmtEventDate, fmtRange } from "@/lib/format";
import { elegirFinde, findeCubre, proponerFinde, aISO, type RangoFinde } from "@/lib/weekend-fit";
import type { OrderChangeInput } from "@/lib/notify";

/**
 * Qué hay que cambiar al corregir un evento, decidido aparte de la escritura.
 *
 * Está separado de la acción para poder probarlo sin base de datos: acá vive lo
 * que puede salir mal —elegir mal el fin de semana, no darse cuenta de que algo
 * cambió, dejar el evento en un finde que no cubre su fecha—, y son cosas que
 * conviene tener fijadas por pruebas y no comprobadas a ojo.
 *
 * No escribe nada. Devuelve qué habría que hacer.
 */

export type EventoActual = {
  lugar: string;
  date: Date;
  guests: number;
  weekendId: string;
  weekendLabel: string;
};

export type EdicionPedida = { lugar: string; date: Date; guests: number };

export type Plan =
  | { tipo: "error"; error: string }
  /** No hay finde para esa fecha: hay que confirmar antes de crear uno. */
  | { tipo: "falta-finde"; startDate: string; endDate: string; label: string }
  /** No cambió nada: no se escribe ni se avisa. */
  | { tipo: "sin-cambios" }
  | { tipo: "guardar"; destinoId: string; destinoLabel: string; semudó: boolean; cambios: OrderChangeInput[] };

export function planEventEdit(
  actual: EventoActual,
  pedido: EdicionPedida,
  findes: RangoFinde[]
): Plan {
  const lugar = pedido.lugar.trim();
  if (!lugar) return { tipo: "error", error: "Poné el lugar del evento." };
  if (lugar.length > 80) return { tipo: "error", error: "El lugar es demasiado largo (máximo 80)." };
  if (Number.isNaN(pedido.date.getTime())) return { tipo: "error", error: "Esa fecha no es válida." };

  const invitados = Math.max(0, Math.round(pedido.guests));

  const destino = elegirFinde(findes, pedido.date, actual.weekendId);
  if (!destino) {
    const s = proponerFinde(pedido.date);
    return {
      tipo: "falta-finde",
      startDate: aISO(s.startDate),
      endDate: aISO(s.endDate),
      label: fmtRange(s.startDate, s.endDate),
    };
  }
  // Un evento nunca puede quedar colgado de un finde que no cubre su fecha:
  // contaría contra el stock del finde equivocado y nadie lo vería hasta el día.
  if (!findeCubre(destino, pedido.date)) {
    return { tipo: "error", error: "No se pudo ubicar el evento en un fin de semana que incluya esa fecha." };
  }

  const cambios: OrderChangeInput[] = [];
  if (actual.lugar !== lugar) {
    cambios.push({ itemName: "Nombre del evento", kind: "LUGAR", before: actual.lugar, after: lugar });
  }
  if (actual.date.getTime() !== pedido.date.getTime()) {
    cambios.push({
      itemName: "Fecha del evento",
      kind: "FECHA",
      before: fmtEventDate(actual.date),
      after: fmtEventDate(pedido.date),
    });
  }
  if (actual.guests !== invitados) {
    cambios.push({
      itemName: "Invitados",
      kind: "INVITADOS",
      before: String(actual.guests),
      after: String(invitados),
    });
  }
  const semudó = destino.id !== actual.weekendId;
  if (semudó) {
    cambios.push({
      itemName: "Fin de semana",
      kind: "FINDE",
      before: actual.weekendLabel,
      after: destino.label,
    });
  }

  if (cambios.length === 0) return { tipo: "sin-cambios" };
  return { tipo: "guardar", destinoId: destino.id, destinoLabel: destino.label, semudó, cambios };
}
