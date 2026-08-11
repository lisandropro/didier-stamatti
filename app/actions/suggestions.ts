"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { sendPushToUser } from "@/lib/push";
import { appVersion } from "@/lib/app-version";
import { canSendSuggestions, canManageSuggestions } from "@/lib/permissions";
import {
  LIMITS,
  isKind,
  isStatus,
  KIND_SHORT,
  deviceSummary,
  eventIdFromScreen,
} from "@/lib/suggestions";

export type SuggestionResult = { ok: boolean; error?: string; id?: string; duplicada?: boolean };

/** Recorta y normaliza. Devuelve null si quedó vacío. */
function limpiar(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  if (!s) return null;
  return s.slice(0, max);
}

/** Igual, pero conserva los saltos de línea: una descripción larga los usa. */
function limpiarTexto(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}

export type NewSuggestion = {
  kind: string;
  title: string;
  body: string;
  contextNote?: string;
  screen?: string;
  /** Una por redacción del formulario. Es lo que evita los duplicados. */
  clientKey: string;
};

/**
 * Crea una sugerencia y le avisa a la administradora.
 *
 * Lo técnico (versión, navegador, sistema) se arma acá, en el servidor, y no se
 * acepta del cliente: es más confiable y evita que el teléfono mande de más.
 * De la cabecera solo se guarda un resumen legible, nunca el User-Agent crudo
 * ni nada de la sesión.
 */
export async function createSuggestion(input: NewSuggestion): Promise<SuggestionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (!canSendSuggestions(user.role)) {
    return { ok: false, error: "No tenés permiso para enviar sugerencias." };
  }

  const kind = typeof input?.kind === "string" ? input.kind.toUpperCase() : "";
  if (!isKind(kind)) return { ok: false, error: "Elegí un tipo de sugerencia." };

  const title = limpiar(input?.title, LIMITS.title);
  if (!title) return { ok: false, error: "Poné un título corto." };

  const body = limpiarTexto(input?.body, LIMITS.body);
  if (!body) return { ok: false, error: "Contá qué querías: la descripción no puede quedar vacía." };

  const clientKey = limpiar(input?.clientKey, 80);
  if (!clientKey) return { ok: false, error: "No se pudo enviar. Volvé a intentar." };

  const screen = limpiar(input?.screen, LIMITS.screen) ?? "/";
  const contextNote = limpiarTexto(input?.contextNote, LIMITS.context);

  // Si estaba parada en el pedido de un evento, queda anotado cuál.
  let eventId: string | null = eventIdFromScreen(screen);
  let eventLugar: string | null = null;
  if (eventId) {
    const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { lugar: true } });
    if (ev) eventLugar = ev.lugar;
    else eventId = null; // la ruta traía cualquier cosa: mejor nada que un id falso
  }

  const ua = (await headers()).get("user-agent") ?? "";

  // El doble toque manda dos veces la MISMA llave. La primera gana; la segunda
  // choca contra el índice único y devuelve la que ya existe, sin crear nada.
  const yaEstaba = await prisma.suggestion.findUnique({ where: { clientKey }, select: { id: true } });
  if (yaEstaba) return { ok: true, id: yaEstaba.id, duplicada: true };

  let creada;
  try {
    creada = await prisma.suggestion.create({
      data: {
        authorId: user.id,
        authorName: user.name,
        kind,
        title,
        body,
        screen,
        eventId,
        eventLugar,
        contextNote,
        appVersion: appVersion(),
        device: deviceSummary(ua),
        clientKey,
      },
    });
  } catch {
    // Dos envíos a la vez: el índice único frena al segundo. Se devuelve el que
    // sí entró, así quien la mandó ve un solo resultado y no un error.
    const gemela = await prisma.suggestion.findUnique({ where: { clientKey }, select: { id: true } });
    if (gemela) return { ok: true, id: gemela.id, duplicada: true };
    return { ok: false, error: "No se pudo guardar la sugerencia." };
  }

  await avisarALaAdministradora(creada.id, user.name, kind, title);

  revalidatePath("/sugerencias");
  return { ok: true, id: creada.id };
}

/** Aviso dentro de la app + push. Aparte de los avisos de pedidos: no entra en
 *  el agrupamiento de cinco minutos, porque una sugerencia es un hecho suelto.
 *  Nunca lanza: que falle el aviso no puede perder la sugerencia. */
async function avisarALaAdministradora(
  suggestionId: string,
  autor: string,
  kind: string,
  title: string
): Promise<void> {
  try {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true },
    });
    const message = `${autor} envió una sugerencia (${KIND_SHORT[kind] ?? kind}): ${title}`;
    const url = `/sugerencias/${suggestionId}`;

    for (const a of admins) {
      try {
        await prisma.notification.create({
          data: {
            recipientId: a.id,
            actorName: autor,
            type: "SUGERENCIA",
            message,
            linkUrl: url,
            // Ya sale el push acá mismo: marcarlo evita que el barrido de
            // pedidos lo vuelva a tomar y lo mande dos veces.
            pushedAt: new Date(),
          },
        });
        await sendPushToUser(a.id, {
          title: "Didier Stamatti",
          body: message,
          url,
          tag: `sugerencia-${suggestionId}`,
        });
      } catch {
        // Si falla con una administradora, se sigue con las demás.
      }
    }
  } catch {
    // La sugerencia ya quedó guardada; eso es lo que importa.
  }
}

// ---------------------------------------------------------------------------
// Gestión: solo la administradora
// ---------------------------------------------------------------------------

type Guard = { ok: false; error: string } | { ok: true; user: { id: string; name: string } };

async function requireManage(): Promise<Guard> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (!canManageSuggestions(user.role)) {
    return { ok: false, error: "Solo la administradora puede gestionar las sugerencias." };
  }
  return { ok: true, user };
}

export async function setSuggestionStatus(id: string, status: string): Promise<SuggestionResult> {
  const guard = await requireManage();
  if (!guard.ok) return { ok: false, error: guard.error };

  const nuevo = typeof status === "string" ? status.toUpperCase() : "";
  if (!isStatus(nuevo)) return { ok: false, error: "Ese estado no existe." };

  const actual = await prisma.suggestion.findUnique({ where: { id }, select: { status: true } });
  if (!actual) return { ok: false, error: "No se encontró la sugerencia." };
  if (actual.status === nuevo) return { ok: true, id };

  await prisma.suggestion.update({
    where: { id },
    data: { status: nuevo, statusAt: new Date() },
  });

  revalidatePath("/sugerencias");
  revalidatePath(`/sugerencias/${id}`);
  return { ok: true, id };
}

export async function replyToSuggestion(id: string, reply: string): Promise<SuggestionResult> {
  const guard = await requireManage();
  if (!guard.ok) return { ok: false, error: guard.error };

  const texto = limpiarTexto(reply, LIMITS.reply);
  if (!texto) return { ok: false, error: "La respuesta no puede quedar vacía." };

  const sug = await prisma.suggestion.findUnique({
    where: { id },
    select: { authorId: true, title: true },
  });
  if (!sug) return { ok: false, error: "No se encontró la sugerencia." };

  await prisma.suggestion.update({
    where: { id },
    data: { reply: texto, repliedAt: new Date(), repliedByName: guard.user.name },
  });

  // Quien la mandó se entera de que le contestaron.
  try {
    await prisma.notification.create({
      data: {
        recipientId: sug.authorId,
        actorName: guard.user.name,
        type: "SUGERENCIA",
        message: `${guard.user.name} respondió tu sugerencia: ${sug.title}`,
        linkUrl: `/sugerencias/${id}`,
        pushedAt: new Date(),
      },
    });
    await sendPushToUser(sug.authorId, {
      title: "Didier Stamatti",
      body: `Te respondieron la sugerencia: ${sug.title}`,
      url: `/sugerencias/${id}`,
      tag: `sugerencia-${id}`,
    });
  } catch {
    // La respuesta ya quedó guardada y se ve al abrir la sugerencia.
  }

  revalidatePath("/sugerencias");
  revalidatePath(`/sugerencias/${id}`);
  return { ok: true, id };
}

