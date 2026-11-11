"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { canEditStock, canPreparar } from "@/lib/permissions";
import { esCategoria } from "@/lib/categories";
import { esClave } from "@/lib/preparacion";
import { validQuantity } from "@/lib/quantity";
import { esId } from "@/lib/entrada";
import { TEXTO_DE_BAJA, esFaltaValida, esMotivoBaja, sonVistosDeLevante, type MotivoBaja, type VistoDeLevante } from "@/lib/levante";
import {
  desmarcar,
  descontarFaltante,
  marcarFalta,
  marcarSector,
  marcarVolvio,
  reabrirLevante,
  terminarLevante,
  type ResultadoDescuento,
  type ResultadoMarca,
} from "@/lib/levante-db";

/** `aviso`: salió bien, pero hay algo que mirar (no es un error, no bloquea).
 *  `confirmar`: no se terminó porque cambió cuántos quedan sin revisar; es el
 *  número de ahora, para volver a preguntar. */
export type LevanteResult = { ok: boolean; error?: string; count?: number; aviso?: string; confirmar?: number };

type Guarda = { user: { id: string; name: string; role: string }; error: null } | { user: null; error: string };

/** El permiso se mira antes que la base (a quien no puede no se le dice ni si
 *  el evento existe), y solo vale sobre un evento vivo. */
async function requerirEvento(eventId: string, puede: (role: string) => boolean, sinPermiso: string): Promise<Guarda> {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Tenés que iniciar sesión." };
  if (!puede(user.role)) return { user: null, error: sinPermiso };
  if (!esId(eventId)) return { user: null, error: "Evento inválido." };
  const ev = await prisma.event.findFirst({
    where: { id: eventId, deletedAt: null, period: { deletedAt: null } },
    select: { id: true },
  });
  if (!ev) return { user: null, error: "El evento ya no está disponible." };
  return { user, error: null };
}

/** Marcar y terminar: los mismos que tildan la preparación. */
function requerirMarcar(eventId: string): Promise<Guarda> {
  return requerirEvento(eventId, canPreparar, "No tenés permiso para marcar el levante.");
}

function revalidar(eventId: string) {
  revalidatePath("/preparar");
  revalidatePath(`/preparar/${eventId}/levante`);
}

const ERROR_DE_MARCA: Record<Exclude<ResultadoMarca, "marcado">, string> = {
  cambio: "Ese ítem cambió recién: revisalo.",
  "no-existe": "Ese ítem ya no está en el pedido.",
  cerrado: "El levante ya se terminó: no se puede marcar.",
  descontado: "Ese faltante ya se descontó del stock: no se puede cambiar.",
};

function respuestaDeMarca(eventId: string, r: ResultadoMarca): LevanteResult {
  if (r !== "marcado") return { ok: false, error: ERROR_DE_MARCA[r] };
  revalidar(eventId);
  return { ok: true };
}

/** Volvió todo lo que se mandó de un ítem. `mandado` es lo que mostraba la fila. */
export async function marcarVolvioItem(eventId: string, clave: string, mandado: number): Promise<LevanteResult> {
  const { user, error } = await requerirMarcar(eventId);
  if (!user) return { ok: false, error: error! };
  if (!esClave(clave) || !validQuantity(mandado, 1)) return { ok: false, error: "Ítem inválido." };
  return respuestaDeMarca(eventId, await marcarVolvio(eventId, clave, user, mandado));
}

/** No volvieron `faltan` de los `mandado`. También corrige un faltante. */
export async function marcarFaltaItem(eventId: string, clave: string, mandado: number, faltan: number): Promise<LevanteResult> {
  const { user, error } = await requerirMarcar(eventId);
  if (!user) return { ok: false, error: error! };
  if (!esClave(clave)) return { ok: false, error: "Ítem inválido." };
  if (!esFaltaValida(faltan, mandado)) return { ok: false, error: "Elegí cuántos faltan: de 1 a lo que se mandó." };
  return respuestaDeMarca(eventId, await marcarFalta(eventId, clave, user, mandado, faltan));
}

/** Vuelve a dejar un ítem sin revisar. Solo si sigue como se vio. */
export async function desmarcarItem(eventId: string, clave: string, faltanVisto: number): Promise<LevanteResult> {
  const { user, error } = await requerirMarcar(eventId);
  if (!user) return { ok: false, error: error! };
  if (!esClave(clave) || !validQuantity(faltanVisto)) return { ok: false, error: "Ítem inválido." };
  const r = await desmarcar(eventId, clave, faltanVisto);
  if (r !== "desmarcado") return { ok: false, error: ERROR_DE_MARCA[r] };
  revalidar(eventId);
  return { ok: true };
}

/** Tacha lo pendiente de un sector que se vio y sigue igual. Lo que cambió
 *  mientras tanto no se marca, y se avisa sin frenar el resto. */
export async function marcarSectorEntero(eventId: string, category: string, vistos: VistoDeLevante[]): Promise<LevanteResult> {
  const { user, error } = await requerirMarcar(eventId);
  if (!user) return { ok: false, error: error! };
  if (!esCategoria(category)) return { ok: false, error: "Sector inválido." };
  if (!sonVistosDeLevante(vistos)) return { ok: false, error: "Ítems inválidos." };
  const { resultado, marcados, salteados } = await marcarSector(eventId, category, user, vistos);
  if (resultado === "cerrado") return { ok: false, error: ERROR_DE_MARCA.cerrado };
  revalidar(eventId);
  if (salteados === 0) return { ok: true, count: marcados };
  const aviso =
    salteados === 1
      ? "1 ítem cambió mientras tanto y no se tachó: revisalo."
      : `${salteados} ítems cambiaron mientras tanto y no se tacharon: revisalos.`;
  return { ok: true, count: marcados, aviso };
}

/** Termina el levante con lo que quedó sin revisar confirmado en la pantalla. */
export async function terminarElLevante(eventId: string, sinRevisarVisto: number): Promise<LevanteResult> {
  const { user, error } = await requerirMarcar(eventId);
  if (!user) return { ok: false, error: error! };
  if (!validQuantity(sinRevisarVisto)) return { ok: false, error: "Pedido inválido." };
  const r = await terminarLevante(eventId, user, sinRevisarVisto);
  if (r.r === "confirmar") return { ok: false, confirmar: r.sinRevisar };
  if (r.r === "no-existe") return { ok: false, error: "El evento ya no está disponible." };
  if (r.r === "vacio") return { ok: false, error: "Este evento no tiene nada que levantar." };
  // "ya": otro teléfono lo terminó recién. Para quien tocó es lo mismo: quedó terminado.
  revalidar(eventId);
  return { ok: true };
}

/** Reabrir y descontar: solo quien puede tocar el stock (hoy, la administradora). */
function requerirStock(eventId: string): Promise<Guarda> {
  return requerirEvento(eventId, canEditStock, "Solo la administradora puede reabrir el levante o descontar del stock.");
}

/** Reabre un levante terminado para corregirlo. */
export async function reabrirElLevante(eventId: string): Promise<LevanteResult> {
  const { user, error } = await requerirStock(eventId);
  if (!user) return { ok: false, error: error! };
  const r = await reabrirLevante(eventId);
  if (r === "no-existe") return { ok: false, error: "El evento ya no está disponible." };
  revalidar(eventId);
  return { ok: true };
}

const ERROR_DE_DESCUENTO: Record<Exclude<ResultadoDescuento, "descontado" | "ya">, string> = {
  abierto: "El levante se reabrió: hay que terminarlo antes de descontar.",
  "no-existe": "Ese faltante ya no está: revisá el levante.",
  cambio: "El stock cambió recién: probá de nuevo.",
  ...TEXTO_DE_BAJA,
};

/** Da de baja del stock lo que no volvió de un ítem, por rotura o pérdida. */
export async function descontarItem(eventId: string, clave: string, motivo: MotivoBaja): Promise<LevanteResult> {
  const { user, error } = await requerirStock(eventId);
  if (!user) return { ok: false, error: error! };
  if (!esClave(clave) || !esMotivoBaja(motivo)) return { ok: false, error: "Pedido inválido." };
  const r = await descontarFaltante(eventId, clave, motivo, user);
  // "ya": otro teléfono lo descontó recién. Quedó descontado una vez, que es lo que se quería.
  if (r !== "descontado" && r !== "ya") return { ok: false, error: ERROR_DE_DESCUENTO[r] };
  // El stock se ve en Inventario, en el historial y en los faltantes de cada período.
  revalidatePath("/", "layout");
  return { ok: true };
}
