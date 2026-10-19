"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { notifyOrderChange, type OrderChangeInput } from "@/lib/notify";
import { revalidatePath } from "next/cache";
import { canEditOrders } from "@/lib/permissions";
import { validQuantity } from "@/lib/quantity";
import { esCategoria } from "@/lib/categories";
import { saveRecoverableVersion } from "@/lib/snapshot";
import { estaTildado, hayTildados } from "@/lib/preparacion-db";
import { claveDeLinea } from "@/lib/preparacion";

export type OrderResult = { ok: boolean; error?: string; lineId?: string; count?: number };

/** Un evento que se puede tocar: ni él ni su período están en la papelera. */
const EVENTO_VIVO = { deletedAt: null, period: { deletedAt: null } } as const;

/** Cargar y modificar pedidos. El encargado de logística los mira pero no los
 *  toca; lo único que puede escribir es el responsable de la fiesta. */
async function requireEdit() {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Tenés que iniciar sesión." };
  if (!canEditOrders(user.role)) return { user: null, error: "No tenés permiso para modificar los pedidos." };
  return { user, error: null };
}

/** Fija la cantidad (y nota) de un producto del catálogo en el pedido de un evento.
 *  qty 0 = el producto no va → se borra la línea. */
export async function setLine(input: {
  eventId: string;
  productId: string;
  qty: number;
  note?: string | null;
}): Promise<OrderResult> {
  const { user, error: permiso } = await requireEdit();
  if (!user) return { ok: false, error: permiso! };

  if (!validQuantity(input.qty)) return { ok: false, error: "Ingresá una cantidad entera válida." };
  const event = await prisma.event.findFirst({ where: { id: input.eventId, deletedAt: null, period: { deletedAt: null } }, select: { id: true } });
  if (!event) return { ok: false, error: "El evento ya no está disponible." };
  const qty = input.qty;
  if (input.note != null && (typeof input.note !== "string" || input.note.length > 1000)) return { ok: false, error: "La nota puede tener hasta 1000 caracteres." };
  const note = input.note?.trim() || null;

  const mutation = await prisma.$transaction(async (tx) => {
    const existing = await tx.orderLine.findFirst({
      where: { eventId: input.eventId, productId: input.productId },
    });
    const producto = await tx.product.findUnique({
      where: { id: input.productId },
      select: { name: true, active: true },
    });
    if (!producto || (!producto.active && !existing)) return { ok: false, error: "El producto ya no está disponible." };
    const nombre = producto?.name ?? "Producto";

    // ¿El depósito ya lo tildó? Entonces este cambio obliga a rehacer algo
    // físico: va marcado, y avisa aparte y con prioridad.
    const tardio = await estaTildado(tx, input.eventId, input.productId);

    // Puede cambiar la cantidad Y la nota en el mismo guardado: se registran las
    // dos cosas, porque la nota es justo lo que le importa al del depósito.
    const cambios: OrderChangeInput[] = [];

    if (qty === 0) {
      if (existing) {
        await tx.orderLine.delete({ where: { id: existing.id } });
        cambios.push({ itemName: nombre, kind: "QUITADO", before: String(existing.qty), after: null, tardio });
      }
    } else if (existing) {
      if (existing.qty !== qty) {
        cambios.push({ itemName: nombre, kind: "CANTIDAD", before: String(existing.qty), after: String(qty), tardio });
      }
      if ((existing.note ?? null) !== note) {
        cambios.push({ itemName: nombre, kind: "NOTA", before: existing.note, after: note, tardio });
      }
      // Si no cambió ni la cantidad ni la nota, se guarda igual pero no se avisa:
      // abrir un pedido y volver a guardarlo no es una modificación.
      if (cambios.length > 0) await tx.orderLine.update({ where: { id: existing.id }, data: { qty, note } });
    } else {
      await tx.orderLine.create({
        data: { eventId: input.eventId, productId: input.productId, qty, note },
      });
      cambios.push({ itemName: nombre, kind: "AGREGADO", before: null, after: String(qty), tardio });
    }

    return cambios;
  });
  if (!Array.isArray(mutation)) return mutation;
  const cambios = mutation;

  if (cambios.length > 0) await notifyOrderChange(user, input.eventId, cambios);
  revalidatePath("/");
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
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Poné el nombre del ítem." };
  if (!esCategoria(input.category)) return { ok: false, error: "Elegí a qué sector pertenece." };
  if (!validQuantity(input.qty, 1)) return { ok: false, error: "Ingresá una cantidad entera mayor que cero." };
  const event = await prisma.event.findFirst({ where: { id: input.eventId, deletedAt: null, period: { deletedAt: null } }, select: { id: true } });
  if (!event) return { ok: false, error: "El evento ya no está disponible." };
  const qty = input.qty;

  const line = await prisma.orderLine.create({
    data: {
      eventId: input.eventId,
      customName: name,
      customCategory: input.category,
      customUnit: input.unit?.trim() || null,
      qty,
      note: input.note?.trim() || null,
    },
  });
  await notifyOrderChange(user, input.eventId, {
    itemName: name,
    kind: "AGREGADO",
    before: null,
    after: String(qty),
  });
  revalidatePath("/");
  return { ok: true, lineId: line.id };
}

/** Cambia la cantidad de un ítem fuera de catálogo. */
export async function setCustomQty(lineId: string, qty: number): Promise<OrderResult> {
  const { user, error: permiso } = await requireEdit();
  if (!user) return { ok: false, error: permiso! };
  if (!validQuantity(qty, 1)) return { ok: false, error: "Ingresá una cantidad entera mayor que cero." };
  const q = qty;
  // El renglón se busca a través de un evento vivo: antes se podía cambiar la
  // cantidad de un ítem cuyo evento ya estaba en la papelera.
  const antes = await prisma.orderLine.findFirst({
    where: { id: lineId, event: EVENTO_VIVO },
    select: { qty: true, productId: true, customName: true, product: { select: { name: true } } },
  });
  if (!antes) return { ok: false, error: "El ítem o su evento ya no está disponible." };
  const { eventId, tardio } = await prisma.$transaction(async (tx) => {
    const line = await tx.orderLine.update({ where: { id: lineId }, data: { qty: q }, select: { eventId: true } });
    // ¿El depósito ya lo tildó? Se pregunta en la misma transacción que escribe.
    const tardio = await estaTildado(tx, line.eventId, claveDeLinea({ id: lineId, productId: antes.productId }));
    return { eventId: line.eventId, tardio };
  });
  if (antes.qty !== q) {
    await notifyOrderChange(user, eventId, {
      itemName: antes.customName ?? antes.product?.name ?? "Ítem",
      kind: "CANTIDAD",
      before: String(antes.qty),
      after: String(q),
      tardio,
    });
  }
  revalidatePath("/");
  return { ok: true };
}

/** Borra una línea (se usa para los ítems fuera de catálogo). */
export async function deleteLine(lineId: string): Promise<OrderResult> {
  const { user, error: permiso } = await requireEdit();
  if (!user) return { ok: false, error: permiso! };
  const line = await prisma.orderLine.findFirst({
    where: { id: lineId, event: EVENTO_VIVO },
    select: { eventId: true, qty: true, productId: true, customName: true, product: { select: { name: true } } },
  });
  if (!line) return { ok: false, error: "El ítem o su evento ya no está disponible." };
  const tardio = await prisma.$transaction(async (tx) => {
    await tx.orderLine.deleteMany({ where: { id: lineId } });
    return estaTildado(tx, line.eventId, claveDeLinea({ id: lineId, productId: line.productId }));
  });
  await notifyOrderChange(user, line.eventId, {
    itemName: line.customName ?? line.product?.name ?? "Ítem",
    kind: "QUITADO",
    before: String(line.qty),
    after: null,
    tardio,
  });
  revalidatePath("/");
  return { ok: true };
}

/** Copia el pedido completo de otro evento a este (reemplaza lo que hubiera).
 *  Sirve para no cargar de cero un evento parecido a uno anterior. */
export async function copyOrderFromEvent(targetEventId: string, sourceEventId: string): Promise<OrderResult> {
  const { user, error: permiso } = await requireEdit();
  if (!user) return { ok: false, error: permiso! };
  if (targetEventId === sourceEventId) return { ok: false, error: "Es el mismo evento." };

  const target = await prisma.event.findFirst({ where: { id: targetEventId, ...EVENTO_VIVO } });
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
  revalidatePath("/");
  revalidatePath(`/evento/${targetEventId}`);
  return { ok: true, count: sourceLines.length };
}
