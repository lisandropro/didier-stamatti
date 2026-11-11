"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { notifyOrderChange } from "@/lib/notify";
import { canEditOrders } from "@/lib/permissions";
import { validQuantity } from "@/lib/quantity";
import { esCategoria } from "@/lib/categories";
import { saveRecoverableVersion } from "@/lib/snapshot";
import { estaTildado, hayTildados } from "@/lib/preparacion-db";
import { claveDeLinea } from "@/lib/preparacion";
import { TOPES, esId, notaOpcional, textoOpcional } from "@/lib/entrada";
import { esVistoDeLinea, resolverLinea, type VistoDeLinea } from "@/lib/linea-de-pedido";
import { revalidarPedido } from "@/lib/revalidar";

export type OrderResult = { ok: boolean; error?: string; lineId?: string; count?: number };

/** Un evento que se puede tocar: ni él ni su período están en la papelera. */
const EVENTO_VIVO = { deletedAt: null, period: { deletedAt: null } } as const;

const PEDIDO_INVALIDO = "Pedido inválido.";
const NOTA_LARGA = `La nota puede tener hasta ${TOPES.nota} caracteres.`;

/** Cargar y modificar pedidos. El encargado de logística los mira pero no los
 *  toca; lo único que puede escribir es el responsable de la fiesta. */
async function requireEdit() {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Tenés que iniciar sesión." };
  if (!canEditOrders(user.role)) return { user: null, error: "No tenés permiso para modificar los pedidos." };
  return { user, error: null };
}

/** Lo que llega es un objeto: una acción es un endpoint, y `null` o un texto en
 *  lugar del objeto no pueden terminar en un error crudo al leer un campo. */
function esObjeto(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/** Fija la cantidad (y nota) de un producto del catálogo en el pedido de un evento.
 *  qty 0 = el producto no va → se borra la línea.
 *
 *  `visto` es lo que mostraba la fila antes del cambio. Con eso se guarda solo
 *  lo que la persona tocó: cambiar la nota no pisa la cantidad que otro
 *  teléfono cargó mientras tanto, ni al revés (ver lib/linea-de-pedido.ts). */
export async function setLine(input: {
  eventId: string;
  productId: string;
  qty: number;
  note?: string | null;
  visto?: VistoDeLinea | null;
}): Promise<OrderResult> {
  const { user, error: permiso } = await requireEdit();
  if (!user) return { ok: false, error: permiso! };

  if (!esObjeto(input) || !esId(input.eventId) || !esId(input.productId)) return { ok: false, error: PEDIDO_INVALIDO };
  if (!validQuantity(input.qty)) return { ok: false, error: "Ingresá una cantidad entera válida." };
  const nota = notaOpcional(input.note, TOPES.nota);
  if (!nota.ok) return { ok: false, error: NOTA_LARGA };
  const visto = input.visto ?? null;
  if (visto !== null && !esVistoDeLinea(visto, (v) => validQuantity(v), TOPES.nota)) return { ok: false, error: PEDIDO_INVALIDO };
  const { eventId, productId, qty } = input;

  const event = await prisma.event.findFirst({ where: { id: eventId, deletedAt: null, period: { deletedAt: null } }, select: { id: true, periodId: true } });
  if (!event) return { ok: false, error: "El evento ya no está disponible." };

  const mutation = await prisma.$transaction(async (tx) => {
    const existing = await tx.orderLine.findFirst({ where: { eventId, productId } });
    const producto = await tx.product.findUnique({ where: { id: productId }, select: { name: true, active: true } });
    if (!producto || (!producto.active && !existing)) return { ok: false, error: "El producto ya no está disponible." };

    // ¿El depósito ya lo tildó? Entonces este cambio obliga a rehacer algo
    // físico: va marcado, y avisa aparte y con prioridad.
    const tardio = await estaTildado(tx, eventId, productId);

    // Puede cambiar la cantidad Y la nota en el mismo guardado: se registran las
    // dos cosas, porque la nota es justo lo que le importa al del depósito.
    const r = resolverLinea(producto.name, existing ? { qty: existing.qty, note: existing.note } : null, { qty, note: nota.valor }, visto, tardio);
    if (r.accion === "ya-no-esta") {
      return { ok: false, error: "Otra persona sacó ese producto del pedido. Actualizá la pantalla para ver cómo quedó." };
    }
    // Por id y con `Many`: si el renglón desapareció entre la lectura de arriba
    // y esta escritura, no hay excepción que vuelva atrás la transacción.
    if (r.accion === "crear") await tx.orderLine.create({ data: { eventId, productId, qty: r.qty, note: r.note } });
    if (r.accion === "actualizar") await tx.orderLine.updateMany({ where: { id: existing!.id }, data: { qty: r.qty, note: r.note } });
    if (r.accion === "borrar") await tx.orderLine.deleteMany({ where: { id: existing!.id } });
    return r.cambios;
  });
  if (!Array.isArray(mutation)) return mutation;
  const cambios = mutation;

  if (cambios.length > 0) await notifyOrderChange(user, eventId, cambios);
  revalidarPedido(eventId, event.periodId);
  return { ok: true };
}


/** Agrega un ítem fuera de catálogo (sin control de stock). Necesita categoría
 *  para poder imprimirse en el pedido del sector que corresponde. */
export async function addCustomLine(input: {
  eventId: string;
  name: string;
  category: string;
  unit?: string;
  qty: number;
  note?: string;
}): Promise<OrderResult> {
  const { user, error: permiso } = await requireEdit();
  if (!user) return { ok: false, error: permiso! };
  if (!esObjeto(input) || !esId(input.eventId)) return { ok: false, error: PEDIDO_INVALIDO };
  const nombre = textoOpcional(input.name, TOPES.nombre);
  if (!nombre.ok) return { ok: false, error: `El nombre del ítem es demasiado largo (máximo ${TOPES.nombre}).` };
  if (!nombre.valor) return { ok: false, error: "Poné el nombre del ítem." };
  if (typeof input.category !== "string" || !esCategoria(input.category)) return { ok: false, error: "Elegí a qué sector pertenece." };
  const unidad = textoOpcional(input.unit, TOPES.unidad);
  if (!unidad.ok) return { ok: false, error: `La unidad es demasiado larga (máximo ${TOPES.unidad}).` };
  const nota = notaOpcional(input.note, TOPES.nota);
  if (!nota.ok) return { ok: false, error: NOTA_LARGA };
  if (!validQuantity(input.qty, 1)) return { ok: false, error: "Ingresá una cantidad entera mayor que cero." };
  const { eventId, qty } = input;
  const name = nombre.valor;

  const event = await prisma.event.findFirst({ where: { id: eventId, deletedAt: null, period: { deletedAt: null } }, select: { id: true, periodId: true } });
  if (!event) return { ok: false, error: "El evento ya no está disponible." };

  const line = await prisma.orderLine.create({
    data: {
      eventId,
      customName: name,
      customCategory: input.category,
      customUnit: unidad.valor,
      qty,
      note: nota.valor,
    },
  });
  await notifyOrderChange(user, eventId, {
    itemName: name,
    kind: "AGREGADO",
    before: null,
    after: String(qty),
  });
  revalidarPedido(eventId, event.periodId);
  return { ok: true, lineId: line.id };
}

/** Cambia la cantidad de un ítem fuera de catálogo. */
export async function setCustomQty(lineId: string, qty: number): Promise<OrderResult> {
  const { user, error: permiso } = await requireEdit();
  if (!user) return { ok: false, error: permiso! };
  if (!esId(lineId)) return { ok: false, error: PEDIDO_INVALIDO };
  if (!validQuantity(qty, 1)) return { ok: false, error: "Ingresá una cantidad entera mayor que cero." };
  const q = qty;
  // El renglón se busca a través de un evento vivo: antes se podía cambiar la
  // cantidad de un ítem cuyo evento ya estaba en la papelera.
  //
  // Se lee y se escribe en la misma transacción, y la escritura es condicionada
  // (`updateMany` sobre el renglón de un evento vivo). Antes la lectura iba
  // afuera y después un `update` por id: si otro teléfono borraba el ítem en el
  // medio, salía una excepción cruda, y el aviso decía una cantidad "anterior"
  // que ya no era la que había.
  const renglonVivo = { id: lineId, event: EVENTO_VIVO };
  const hecho = await prisma.$transaction(async (tx) => {
    const antes = await tx.orderLine.findFirst({
      where: renglonVivo,
      select: { id: true, eventId: true, qty: true, productId: true, customName: true, product: { select: { name: true } }, event: { select: { periodId: true } } },
    });
    if (!antes) return null;
    const escrito = antes.qty === q ? { count: 1 } : await tx.orderLine.updateMany({ where: renglonVivo, data: { qty: q } });
    if (escrito.count !== 1) return null;
    // ¿El depósito ya lo tildó? Se pregunta en la misma transacción que escribe.
    const tardio = await estaTildado(tx, antes.eventId, claveDeLinea({ id: antes.id, productId: antes.productId }));
    return { antes, tardio };
  });
  if (!hecho) return { ok: false, error: "El ítem o su evento ya no está disponible." };
  const { antes, tardio } = hecho;
  if (antes.qty !== q) {
    await notifyOrderChange(user, antes.eventId, {
      itemName: antes.customName ?? antes.product?.name ?? "Ítem",
      kind: "CANTIDAD",
      before: String(antes.qty),
      after: String(q),
      tardio,
    });
  }
  revalidarPedido(antes.eventId, antes.event.periodId);
  return { ok: true };
}

/** Borra una línea (se usa para los ítems fuera de catálogo). */
export async function deleteLine(lineId: string): Promise<OrderResult> {
  const { user, error: permiso } = await requireEdit();
  if (!user) return { ok: false, error: permiso! };
  if (!esId(lineId)) return { ok: false, error: PEDIDO_INVALIDO };
  const line = await prisma.orderLine.findFirst({
    where: { id: lineId, event: EVENTO_VIVO },
    select: { id: true, eventId: true, qty: true, productId: true, customName: true, product: { select: { name: true } }, event: { select: { periodId: true } } },
  });
  if (!line) return { ok: false, error: "El ítem o su evento ya no está disponible." };
  // Se borra por el id LEÍDO de la base, no por el argumento, y quien decide si
  // el borrado fue de este aparato es la escritura (`count`): con dos teléfonos
  // sacando el mismo ítem, avisaban "se quitó" los dos.
  const { borradas, tardio } = await prisma.$transaction(async (tx) => {
    const r = await tx.orderLine.deleteMany({ where: { id: line.id } });
    return { borradas: r.count, tardio: await estaTildado(tx, line.eventId, claveDeLinea({ id: line.id, productId: line.productId })) };
  });
  if (borradas === 1) {
    await notifyOrderChange(user, line.eventId, {
      itemName: line.customName ?? line.product?.name ?? "Ítem",
      kind: "QUITADO",
      before: String(line.qty),
      after: null,
      tardio,
    });
  }
  // Si dio 0, otro aparato lo sacó en el medio y ya avisó él: quedó como se
  // quería, y acá solo se pone al día la pantalla.
  revalidarPedido(line.eventId, line.event.periodId);
  return { ok: true };
}

/** Copia el pedido completo de otro evento a este (reemplaza lo que hubiera).
 *  Sirve para no cargar de cero un evento parecido a uno anterior. */
export async function copyOrderFromEvent(targetEventId: string, sourceEventId: string): Promise<OrderResult> {
  const { user, error: permiso } = await requireEdit();
  if (!user) return { ok: false, error: permiso! };
  if (!esId(targetEventId) || !esId(sourceEventId)) return { ok: false, error: PEDIDO_INVALIDO };
  if (targetEventId === sourceEventId) return { ok: false, error: "Es el mismo evento." };

  const target = await prisma.event.findFirst({ where: { id: targetEventId, ...EVENTO_VIVO }, select: { id: true, periodId: true } });
  if (!target) return { ok: false, error: "No se encontró el evento." };

  // El origen también tiene que estar vivo: copiar de algo que está en la
  // papelera es copiar de algo que la pantalla ya no muestra.
  const source = await prisma.event.findFirst({ where: { id: sourceEventId, ...EVENTO_VIVO }, select: { lugar: true } });
  if (!source) return { ok: false, error: "El evento del que querés copiar ya no está disponible." };
  const sourceLines = await prisma.orderLine.findMany({ where: { eventId: sourceEventId } });
  if (sourceLines.length === 0) return { ok: false, error: "Ese evento no tiene pedido para copiar." };
  const habia = await prisma.orderLine.count({ where: { eventId: targetEventId } });

  // Copiar REEMPLAZA el pedido. La regla de `lib/snapshot.ts` es que todo lo que
  // pisa pedidos guarda antes una copia recuperable; esta acción no lo hacía, y
  // un toque en el evento equivocado borraba un pedido sin vuelta atrás.
  if (habia > 0) await saveRecoverableVersion(target.periodId, "PRE_COPIA", user);

  const tardio = await prisma.$transaction(async (tx) => {
    // Si algo de este pedido ya estaba preparado, copiar encima lo cambia todo.
    const tardio = await hayTildados(tx, targetEventId);
    await tx.orderLine.deleteMany({ where: { eventId: targetEventId } });
    await tx.orderLine.createMany({
      data: sourceLines.map((l) => ({
        eventId: targetEventId,
        productId: l.productId,
        customName: l.customName,
        customCategory: l.customCategory,
        customUnit: l.customUnit,
        qty: l.qty,
        note: l.note,
      })),
    });
    return tardio;
  });

  await notifyOrderChange(user, targetEventId, {
    itemName: "Todo el pedido",
    kind: "COPIADO",
    before: habia > 0 ? `${habia} ${habia === 1 ? "producto" : "productos"}` : "pedido vacío",
    after: `${sourceLines.length} ${sourceLines.length === 1 ? "producto" : "productos"} copiados de ${source.lugar}`,
    tardio,
  });
  revalidarPedido(targetEventId, target.periodId);
  return { ok: true, count: sourceLines.length };
}
