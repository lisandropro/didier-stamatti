"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { applySnapshotData, buildSnapshotData, saveRecoverableVersion } from "@/lib/snapshot";
import { canManagePeriods } from "@/lib/permissions";
import { notifyOrderChange } from "@/lib/notify";
import { estadoDelEvento } from "@/lib/preparacion-db";
import { cambiosParaAplicar, type ItemPreparacion } from "@/lib/preparacion";
import { hoy, instanteDe } from "@/lib/dates";

export type SnapshotResult = {
  ok: boolean;
  error?: string;
  takenAt?: string;
  guardadas?: number;
  restauradas?: number;
};

function revalidar(periodId: string) {
  revalidatePath("/");
  revalidatePath(`/periodo/${periodId}`);
  revalidatePath("/historial");
}

const mensajeDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Lo que el depósito tiene pendiente en un evento, como un texto comparable:
 *  qué ítems quedaron para rehacer, en qué estado y con qué cantidad y nota. */
const firmaDePendientes = (items: ItemPreparacion[]): string =>
  cambiosParaAplicar(items)
    .map((i) => `${i.clave}:${i.estado}:${i.qty}:${i.note ?? ""}`)
    .sort()
    .join("|");

/**
 * Descartar o restaurar reemplaza los pedidos de todo el período. El depósito
 * tiene que revisar lo que ya juntó, así que a cada evento con algo tildado se
 * le avisa como cambio tardío, pero solo si la restauración le cambió lo que
 * había para rehacer.
 *
 * Son dos pasos porque `applySnapshotData` es una transacción en lote y no se
 * puede leer en el medio. `pendientesPorEvento` saca la foto ANTES de aplicar
 * (por evento tildado, la firma de lo pendiente) y `avisarATildados` la compara
 * DESPUÉS. Un evento que la versión dejó igual no recibe aviso, aunque tuviera
 * un cambio tardío viejo sin aplicar; tampoco uno que quedó sin nada pendiente.
 *
 * Ninguno de los dos lanza: el primero corre antes de tocar nada y el segundo
 * con la restauración ya hecha, y un fallo al avisar no puede hacerle creer al
 * usuario que no se restauró. Si la foto de antes falla queda vacía, y entonces
 * el segundo paso no puede comparar: avisa a todo evento tildado que haya
 * quedado con algo pendiente (mejor un aviso de más que un depósito sin
 * enterarse).
 *
 * Los dos saltean los eventos cuyo día ya pasó: ahí no queda nada que rehacer.
 * Descartar solo se ofrece en períodos terminados, así que sin este corte cada
 * descarte mandaba avisos urgentes de fiestas que ya se hicieron.
 */
async function pendientesPorEvento(periodId: string): Promise<Map<string, string>> {
  try {
    const eventos = await prisma.event.findMany({
      where: { periodId, deletedAt: null, preparaciones: { some: {} }, date: { gte: instanteDe(hoy(), "00:00") } },
      select: { id: true },
    });
    const antes = new Map<string, string>();
    for (const e of eventos) antes.set(e.id, firmaDePendientes(await estadoDelEvento(e.id)));
    return antes;
  } catch (e) {
    console.error("[avisos] no se pudo leer lo pendiente del depósito antes de restaurar, se avisa a todo evento tildado", periodId, mensajeDe(e));
    return new Map();
  }
}

/** Segundo paso: compara contra la foto de `pendientesPorEvento` y avisa
 *  `RESTAURADO` (tardío) a los eventos cuyo pendiente cambió y no quedó vacío. */
async function avisarATildados(
  periodId: string,
  antes: Map<string, string>,
  actor: { id: string; name: string },
  que: string,
): Promise<void> {
  try {
    const eventos = await prisma.event.findMany({
      where: { periodId, deletedAt: null, preparaciones: { some: {} }, date: { gte: instanteDe(hoy(), "00:00") } },
      select: { id: true },
    });
    for (const e of eventos) {
      const despues = firmaDePendientes(await estadoDelEvento(e.id));
      if (despues === "") continue;
      // `antes` vacío = no hay con qué comparar (falló la foto, o no había nada
      // tildado): ahí se avisa a todo el que tenga algo pendiente.
      if (antes.size > 0 && despues === (antes.get(e.id) ?? "")) continue;
      await notifyOrderChange(actor, e.id, { itemName: "Todo el pedido", kind: "RESTAURADO", before: null, after: que, tardio: true });
    }
  } catch (e) {
    console.error("[avisos] no se pudo avisar al depósito de la restauración, que ya se aplicó", periodId, mensajeDe(e));
  }
}

/** Guarda (o actualiza) la "versión segura" de los pedidos de un período.
 *  Sirve como punto al que volver si algo se modifica por error.
 *  Invocada por el usuario (botón "Actualizar versión") — a diferencia de
 *  ensurePeriodSnapshot(), esta SÍ revalida rutas, por eso no puede llamarse
 *  durante el render de una página. */
export async function savePeriodSnapshot(periodId: string): Promise<SnapshotResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (!canManagePeriods(user.role)) return { ok: false, error: "No tenés permiso para cambiar las versiones guardadas." };

  const { data } = await buildSnapshotData(periodId);
  const snap = await prisma.periodSnapshot.upsert({
    where: { periodId },
    update: { data, takenAt: new Date() },
    create: { periodId, data },
  });

  revalidar(periodId);
  return { ok: true, takenAt: snap.takenAt.toISOString() };
}

/** Descarta los cambios hechos a los pedidos desde la última versión guardada.
 *  Antes de pisar nada guarda una copia recuperable del estado actual, así el
 *  descarte deja de ser un camino de ida. Solo afecta cantidades/notas de los
 *  pedidos, no los datos del evento ni si se agregó o borró un evento. */
export async function discardPeriodChanges(periodId: string): Promise<SnapshotResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (!canManagePeriods(user.role)) return { ok: false, error: "No tenés permiso para cambiar las versiones guardadas." };

  const vivo = await prisma.operationalPeriod.findFirst({ where: { id: periodId, deletedAt: null }, select: { id: true } });
  if (!vivo) return { ok: false, error: "El período está en la papelera: recuperalo primero." };
  const snap = await prisma.periodSnapshot.findUnique({ where: { periodId } });
  if (!snap) return { ok: false, error: "Todavía no hay una versión guardada para este período." };

  // Primero el resguardo, después el descarte. Si el resguardo fallara, no se
  // pisa nada: es preferible no descartar a descartar sin poder volver.
  const resguardo = await saveRecoverableVersion(periodId, "PRE_DESCARTE", user);
  const antes = await pendientesPorEvento(periodId);
  const restauradas = await applySnapshotData(periodId, snap.data);
  await avisarATildados(periodId, antes, user, "Se descartaron los cambios del pedido");

  revalidar(periodId);
  return { ok: true, takenAt: snap.takenAt.toISOString(), guardadas: resguardo.lineCount, restauradas };
}

/** Vuelve a un estado guardado en el historial de versiones. Antes de aplicarlo
 *  resguarda el estado actual, para que también se pueda deshacer esta vuelta. */
export async function restorePeriodVersion(versionId: string): Promise<SnapshotResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (!canManagePeriods(user.role)) return { ok: false, error: "No tenés permiso para cambiar las versiones guardadas." };

  const version = await prisma.periodVersion.findFirst({ where: { id: versionId, period: { deletedAt: null } } });
  if (!version) return { ok: false, error: "No se encontró esa versión, o su período está en la papelera." };

  const resguardo = await saveRecoverableVersion(version.periodId, "PRE_RESTAURACION", user);
  const antes = await pendientesPorEvento(version.periodId);
  const restauradas = await applySnapshotData(version.periodId, version.data);
  await prisma.periodVersion.update({ where: { id: versionId }, data: { restoredAt: new Date() } });
  // Al final: el aviso no puede frenar la marca de "restaurada" ni el revalidar.
  await avisarATildados(version.periodId, antes, user, "Se restauró una versión anterior del pedido");

  revalidar(version.periodId);
  return { ok: true, guardadas: resguardo.lineCount, restauradas };
}
