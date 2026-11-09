"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { canPreparar } from "@/lib/permissions";
import { esCategoria } from "@/lib/categories";
import { esClave } from "@/lib/preparacion";
import { validQuantity } from "@/lib/quantity";
import { esFaltaValida, sonVistosDeLevante, type VistoDeLevante } from "@/lib/levante";
import { desmarcar, marcarFalta, marcarSector, marcarVolvio, type ResultadoMarca } from "@/lib/levante-db";

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
  if (typeof eventId !== "string" || eventId.length === 0 || eventId.length > 64) {
    return { user: null, error: "Evento inválido." };
  }
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
