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
// `limpiar` y `limpiarTexto` vivían acá; ahora los comparten todas las acciones.
import { esId, limpiar, limpiarTexto } from "@/lib/entrada";
import { mensajeDe } from "@/lib/mensaje-de";

export type SuggestionResult = { ok: boolean; error?: string; id?: string; duplicada?: boolean };

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
  if (eventId && !esId(eventId)) eventId = null;
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
  } catch (e) {
    // Dos envíos a la vez: el índice único frena al segundo. Se devuelve el que
    // sí entró, así quien la mandó ve un solo resultado y no un error.
    const gemela = await prisma.suggestion.findUnique({ where: { clientKey }, select: { id: true } });
    if (gemela) return { ok: true, id: gemela.id, duplicada: true };
    // No era un doble envío: es un fallo de verdad, y tiene que quedar anotado.
    console.error("[sugerencias] no se pudo guardar la sugerencia:", mensajeDe(e));
    return { ok: false, error: "No se pudo guardar la sugerencia." };
  }

  await avisarALaAdministradora(creada.id, user.name, kind, title);

  revalidatePath("/sugerencias");
  return { ok: true, id: creada.id };
}

/** Aviso dentro de la app + push. Aparte de los avisos de pedidos: no entra en
 *  el agrupamiento de dos minutos, porque una sugerencia es un hecho suelto.
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
        const aviso = await prisma.notification.create({
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
        await sendPushToUser(
          a.id,
          { title: "Didier Stamatti", body: message, url, tag: `sugerencia-${suggestionId}` },
          { kind: "SUGERENCIA", notificationId: aviso.id },
        );
      } catch (e) {
        // Si falla con una administradora, se sigue con las demás.
        console.error("[sugerencias] no se pudo avisar a una administradora de la sugerencia", suggestionId, mensajeDe(e));
      }
    }
  } catch (e) {
    // La sugerencia ya quedó guardada; eso es lo que importa. Pero que no se
    // haya podido avisar se anota: si no, nadie se entera de que existe.
    console.error("[sugerencias] no se pudo avisar de la sugerencia", suggestionId, mensajeDe(e));
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
  if (!esId(id)) return { ok: false, error: "No se encontró la sugerencia." };

  const nuevo = typeof status === "string" ? status.toUpperCase() : "";
  if (!isStatus(nuevo)) return { ok: false, error: "Ese estado no existe." };

  const actual = await prisma.suggestion.findUnique({ where: { id }, select: { status: true } });
  if (!actual) return { ok: false, error: "No se encontró la sugerencia." };
  if (actual.status === nuevo) return { ok: true, id };

  // `updateMany` y no `update`: si la sugerencia se borró entre la lectura y
  // esta escritura, no hay excepción cruda.
  const r = await prisma.suggestion.updateMany({
    where: { id },
    data: { status: nuevo, statusAt: new Date() },
  });
  if (r.count !== 1) return { ok: false, error: "No se encontró la sugerencia." };

  revalidatePath("/sugerencias");
  revalidatePath(`/sugerencias/${id}`);
  return { ok: true, id };
}

export async function replyToSuggestion(id: string, reply: string): Promise<SuggestionResult> {
  const guard = await requireManage();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!esId(id)) return { ok: false, error: "No se encontró la sugerencia." };

  const texto = limpiarTexto(reply, LIMITS.reply);
  if (!texto) return { ok: false, error: "La respuesta no puede quedar vacía." };

  const sug = await prisma.suggestion.findUnique({
    where: { id },
    select: { authorId: true, title: true },
  });
  if (!sug) return { ok: false, error: "No se encontró la sugerencia." };

  const r = await prisma.suggestion.updateMany({
    where: { id },
    data: { reply: texto, repliedAt: new Date(), repliedByName: guard.user.name },
  });
  if (r.count !== 1) return { ok: false, error: "No se encontró la sugerencia." };

  // Quien la mandó se entera de que le contestaron. Si su usuario ya no existe
  // (`authorId` nulo: la sugerencia sobrevive a quien la escribió), no hay a
  // quién avisarle; la respuesta queda guardada igual.
  const autorId = sug.authorId;
  if (autorId) {
    try {
      const aviso = await prisma.notification.create({
        data: {
          recipientId: autorId,
          actorName: guard.user.name,
          type: "SUGERENCIA",
          message: `${guard.user.name} respondió tu sugerencia: ${sug.title}`,
          linkUrl: `/sugerencias/${id}`,
          pushedAt: new Date(),
        },
      });
      await sendPushToUser(
        autorId,
        { title: "Didier Stamatti", body: `Te respondieron la sugerencia: ${sug.title}`, url: `/sugerencias/${id}`, tag: `sugerencia-${id}` },
        { kind: "SUGERENCIA", notificationId: aviso.id },
      );
    } catch (e) {
      // La respuesta ya quedó guardada y se ve al abrir la sugerencia.
      console.error("[sugerencias] se guardó la respuesta pero no se pudo avisar a quien la escribió", id, mensajeDe(e));
    }
  }

  revalidatePath("/sugerencias");
  revalidatePath(`/sugerencias/${id}`);
  return { ok: true, id };
}
