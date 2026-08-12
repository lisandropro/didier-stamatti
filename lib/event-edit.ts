import { diaDe, fmtEvento, fmtRangoDias } from "@/lib/dates";
import { cubreDia, nombreDe, ubicarDia, type Periodo } from "@/lib/period-fit";
import type { OrderChangeInput } from "@/lib/notify";

/**
 * Qué hay que cambiar al corregir un evento, decidido aparte de la escritura.
 *
 * Está separado de la acción para poder probarlo sin base de datos: acá vive lo
 * que puede salir mal —mandar el evento al período equivocado, no darse cuenta
 * de que algo cambió, dejarlo colgado de un período que no cubre su fecha— y son
 * cosas que conviene tener fijadas por pruebas y no comprobadas a ojo.
 *
 * La regla que manda: **cuando varios períodos cubren la fecha, no se elige
 * solo.** Se devuelven los candidatos y decide la persona. Contar la vajilla
 * contra el grupo equivocado no se nota hasta el día del evento.
 *
 * No escribe nada. Devuelve qué habría que hacer.
 */

export type EventoActual = {
  lugar: string;
  date: Date;
  guests: number;
  periodId: string;
  periodLabel: string;
};

export type EdicionPedida = {
  lugar: string;
  date: Date;
  guests: number;
  /** El período que eligió la persona, cuando había más de uno o ninguno. */
  periodoElegidoId?: string | null;
};

export type Plan =
  | { tipo: "error"; error: string }
  /** Ningún período cubre esa fecha: hay que crear uno o elegir otro a mano. */
  | { tipo: "falta-periodo"; sugerido: { startDay: string; endDay: string; label: string } }
  /** Varios lo cubren: elige la persona, nunca la app. */
  | { tipo: "elegir-periodo"; candidatos: { id: string; nombre: string; rango: string }[] }
  /** No cambió nada: no se escribe ni se avisa. */
  | { tipo: "sin-cambios" }
  | {
      tipo: "guardar";
      destinoId: string;
      destinoNombre: string;
      semudó: boolean;
      cambios: OrderChangeInput[];
    };

export function planEventEdit(actual: EventoActual, pedido: EdicionPedida, periodos: Periodo[]): Plan {
  const lugar = pedido.lugar.trim();
  if (!lugar) return { tipo: "error", error: "Poné el lugar del evento." };
  if (lugar.length > 80) return { tipo: "error", error: "El lugar es demasiado largo (máximo 80)." };
  if (Number.isNaN(pedido.date.getTime())) return { tipo: "error", error: "Esa fecha no es válida." };

  const invitados = Math.max(0, Math.round(pedido.guests));
  const dia = diaDe(pedido.date);

  // Si la persona ya eligió un período, se respeta — siempre que de verdad
  // cubra la fecha, porque si no el evento contaría contra el grupo equivocado.
  let destino: Periodo | null = null;
  if (pedido.periodoElegidoId) {
    const elegido = periodos.find((p) => p.id === pedido.periodoElegidoId);
    if (!elegido) return { tipo: "error", error: "No se encontró el período elegido." };
    if (!cubreDia(elegido, dia)) {
      return {
        tipo: "error",
        error: `El período "${nombreDe(elegido)}" no incluye el ${dia}. Elegí otro o cambiá sus fechas.`,
      };
    }
    destino = elegido;
  } else {
    const ubicacion = ubicarDia(periodos, dia);
    if (ubicacion.tipo === "ninguno") {
      return {
        tipo: "falta-periodo",
        sugerido: {
          startDay: ubicacion.sugerido.startDay,
          endDay: ubicacion.sugerido.endDay,
          label: fmtRangoDias(ubicacion.sugerido.startDay, ubicacion.sugerido.endDay),
        },
      };
    }
    if (ubicacion.tipo === "varios") {
      // El que ya tiene el evento se ofrece igual que los demás: se muestra
      // primero por comodidad, pero no se da por elegido.
      const orden = [...ubicacion.candidatos].sort(
        (a, b) => Number(b.id === actual.periodId) - Number(a.id === actual.periodId)
      );
      return {
        tipo: "elegir-periodo",
        candidatos: orden.map((p) => ({
          id: p.id,
          nombre: nombreDe(p),
          rango: fmtRangoDias(p.startDay, p.endDay),
        })),
      };
    }
    destino = ubicacion.periodo;
  }

  const cambios: OrderChangeInput[] = [];
  if (actual.lugar !== lugar) {
    cambios.push({ itemName: "Nombre del evento", kind: "LUGAR", before: actual.lugar, after: lugar });
  }
  if (actual.date.getTime() !== pedido.date.getTime()) {
    cambios.push({
      itemName: "Fecha del evento",
      kind: "FECHA",
      before: fmtEvento(actual.date),
      after: fmtEvento(pedido.date),
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
  const semudó = destino.id !== actual.periodId;
  const destinoNombre = nombreDe(destino);
  if (semudó) {
    cambios.push({
      itemName: "Período operativo",
      kind: "PERIODO",
      before: actual.periodLabel,
      after: destinoNombre,
    });
  }

  if (cambios.length === 0) return { tipo: "sin-cambios" };
  return { tipo: "guardar", destinoId: destino.id, destinoNombre, semudó, cambios };
}
