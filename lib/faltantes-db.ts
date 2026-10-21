// El barrido de faltantes: cada minuto, para cada período vivo que no terminó,
// compara lo que falta ahora con lo último que se avisó y avisa lo nuevo.
//
// La regla de faltante es la de siempre (`periodShortages` → `computeShortage`):
// el aviso no puede decir algo distinto de lo que muestra la pantalla.

import { prisma } from "@/lib/db";
import { diaDe } from "@/lib/dates";
import { nombreDe } from "@/lib/period-fit";
import { periodShortages } from "@/lib/shortages";
import { decidirFaltantes, type Faltante } from "@/lib/faltantes";
import { resumenDeFaltantes, textoDeFaltantes, type FaltanteConCausa } from "@/lib/aviso-texto";
import { sendPushToUser } from "@/lib/push";
import { ROLES, canVerStock, sortByNotificationPriority } from "@/lib/permissions";
import { QUIET_MINUTES } from "@/lib/notify";

/** Un cambio de pedido más viejo que esto ya no explica un faltante: si nada
 *  se movió en la última hora, lo que cambió fue el stock. */
export const CAUSA_RECIENTE_MIN = 60;

const mensajeDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// Un barrido a la vez, como el de los avisos de pedidos: si uno se demora (el
// servicio de push lento), el siguiente no puede leer lo mismo y avisar dos veces.
let barriendo = false;

type Periodo = { id: string; label: string | null; startDay: string; endDay: string; faltantesDesde: Date | null };

/** Por qué falta cada producto: el lugar del último cambio de pedido del
 *  período sobre ese producto en la última hora, o el de un "Todo el pedido"
 *  (copiar o restaurar), o nada. Devuelve también el evento de esa causa. */
async function causas(periodId: string, faltantes: Faltante[], ahora: Date) {
  const cambios = await prisma.orderChange.findMany({
    where: { event: { periodId }, createdAt: { gte: new Date(ahora.getTime() - CAUSA_RECIENTE_MIN * 60_000) } },
    orderBy: { createdAt: "desc" },
    select: { itemName: true, event: { select: { id: true, lugar: true } } },
  });
  const out = new Map<string, { lugar: string; eventId: string } | null>();
  for (const f of faltantes) {
    const c = cambios.find((x) => x.itemName === f.name) ?? cambios.find((x) => x.itemName === "Todo el pedido");
    out.set(f.productId, c ? { lugar: c.event.lugar, eventId: c.event.id } : null);
  }
  return out;
}

/** Crea el aviso de cada persona y manda los push. Devuelve cuántos avisos se crearon. */
async function avisar(p: Periodo, aAvisar: Faltante[], guardar: { productId: string; missing: number }[], borrar: string[], ahora: Date) {
  const porProducto = await causas(p.id, aAvisar, ahora);
  const items: FaltanteConCausa[] = aAvisar.map((f) => ({ ...f, causa: porProducto.get(f.productId)?.lugar ?? null }));
  const nombre = nombreDe(p);
  const texto = textoDeFaltantes(nombre, items);
  if (!texto) return 0;

  // El depósito va a los faltantes del período en Preparar: el evento de la
  // primera causa, o si no hay, el primer evento vivo del período.
  const deCausa = aAvisar.map((f) => porProducto.get(f.productId)?.eventId).find(Boolean);
  const evento =
    deCausa ??
    (await prisma.event.findFirst({ where: { periodId: p.id, deletedAt: null }, orderBy: { date: "asc" }, select: { id: true } }))?.id ??
    null;

  // Un faltante no tiene autor: le llega a todos, prioritarios primero.
  const personas = sortByNotificationPriority(
    await prisma.user.findMany({ where: { role: { in: [...ROLES] } }, select: { id: true, role: true } }),
  );
  const linkDe = (role: string) => (canVerStock(role) || !evento ? `/?w=${p.id}` : `/preparar/${evento}#faltantes`);
  const mensaje = resumenDeFaltantes(nombre, items);

  // Las filas y los avisos de la app van juntos: si algo falla, no queda una
  // fila que diga "avisado" sin el aviso, ni un aviso que se repita.
  const creados = await prisma.$transaction(async (tx) => {
    for (const g of guardar) {
      await tx.faltanteAvisado.upsert({
        where: { periodId_productId: { periodId: p.id, productId: g.productId } },
        update: { missing: g.missing, at: ahora },
        create: { periodId: p.id, productId: g.productId, missing: g.missing, at: ahora },
      });
    }
    if (borrar.length > 0) await tx.faltanteAvisado.deleteMany({ where: { periodId: p.id, productId: { in: borrar } } });
    const out: { id: string; userId: string; link: string }[] = [];
    for (const u of personas) {
      const link = linkDe(u.role);
      const n = await tx.notification.create({
        data: {
          recipientId: u.id,
          actorName: "Sistema",
          type: "FALTANTE",
          message: mensaje,
          eventId: evento,
          linkUrl: link,
          // El push sale acá mismo: queda marcado como enviado, como el aviso
          // de pedido vacío. Si un envío falla, lo reintenta `reintentarFallidos`.
          pushedAt: ahora,
        },
      });
      out.push({ id: n.id, userId: u.id, link });
    }
    return out;
  });

  for (const c of creados) {
    await sendPushToUser(
      c.userId,
      { title: texto.title, body: texto.body, url: c.link, tag: `faltante-${p.id}` },
      { kind: "FALTANTE", notificationId: c.id },
      { urgency: "high" },
    );
  }
  return creados.length;
}

/**
 * Barre los faltantes de los períodos vivos que no terminaron. Corre cada un
 * minuto desde `instrumentation.ts`. Nunca lanza: un período que falla se
 * anota y el resto sigue.
 */
export async function barrerFaltantes(ahora: Date = new Date()): Promise<{ periodos: number; avisos: number; registrados: number }> {
  if (barriendo) return { periodos: 0, avisos: 0, registrados: 0 };
  barriendo = true;
  let periodos = 0;
  let avisos = 0;
  let registrados = 0;
  try {
    const vivos = await prisma.operationalPeriod.findMany({
      where: { deletedAt: null, endDay: { gte: diaDe(ahora) } },
      select: { id: true, label: true, startDay: true, endDay: true, faltantesDesde: true },
    });
    for (const p of vivos) {
      try {
        // Quietud: mientras alguien sigue cambiando pedidos del período, se
        // espera. El aviso sale cuando terminó de editar, con el número final.
        const ultimo = await prisma.orderChange.findFirst({
          where: { event: { periodId: p.id } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
        if (ultimo && ahora.getTime() - ultimo.createdAt.getTime() < QUIET_MINUTES * 60_000) continue;
        periodos++;

        const actuales: Faltante[] = (await periodShortages(p.id)).map((r) => ({
          productId: r.productId,
          name: r.name,
          totalRequested: r.totalRequested,
          stock: r.stock,
          missing: r.missing,
        }));
        const avisados = await prisma.faltanteAvisado.findMany({
          where: { periodId: p.id },
          select: { productId: true, missing: true },
        });
        const primeraVez = p.faltantesDesde === null;
        const d = decidirFaltantes(actuales, avisados, primeraVez);

        if (primeraVez || d.avisar.length === 0) {
          // Sin aviso: solo se acomodan las filas (y se marca la primera corrida).
          await prisma.$transaction([
            ...d.guardar.map((g) =>
              prisma.faltanteAvisado.upsert({
                where: { periodId_productId: { periodId: p.id, productId: g.productId } },
                update: { missing: g.missing, at: ahora },
                create: { periodId: p.id, productId: g.productId, missing: g.missing, at: ahora },
              }),
            ),
            prisma.faltanteAvisado.deleteMany({ where: { periodId: p.id, productId: { in: d.borrar } } }),
            ...(primeraVez ? [prisma.operationalPeriod.update({ where: { id: p.id }, data: { faltantesDesde: ahora } })] : []),
          ]);
          if (primeraVez) registrados += d.guardar.length;
          continue;
        }

        avisos += await avisar(p, d.avisar, d.guardar, d.borrar, ahora);
      } catch (e) {
        console.error("[faltantes] no se pudo barrer el período, se reintenta en el próximo barrido", p.id, mensajeDe(e));
      }
    }
    return { periodos, avisos, registrados };
  } catch (e) {
    console.error("[faltantes] falló el barrido", mensajeDe(e));
    return { periodos, avisos, registrados };
  } finally {
    barriendo = false;
  }
}
