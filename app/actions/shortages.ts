"use server";

import { getSessionUser } from "@/lib/auth";
import { eventShortages, type ShortageRow } from "@/lib/shortages";

export type ShortagesResult = {
  ok: boolean;
  error?: string;
  lugar?: string;
  weekendLabel?: string;
  rows?: ShortageRow[];
};

/**
 * Detalle de faltantes de un evento. Es SOLO de lectura: no escribe pedidos,
 * productos ni movimientos.
 *
 * Acceso: cualquier usuario con sesión. En esta app no hay eventos asignados a
 * personas — administradora y armador ven los mismos findes—, así que "tener
 * acceso al evento" es estar autenticado. Igual se valida en el servidor: sin
 * sesión no devuelve nada, y un evento o finde en la papelera tampoco.
 */
export async function getEventShortages(eventId: string): Promise<ShortagesResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };

  const data = await eventShortages(eventId);
  if (!data) return { ok: false, error: "No se encontró el evento." };

  return { ok: true, lugar: data.lugar, weekendLabel: data.weekendLabel, rows: data.rows };
}
