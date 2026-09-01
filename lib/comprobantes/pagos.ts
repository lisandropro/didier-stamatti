import { prismaComprobantes as db } from "@/lib/db-comprobantes";
import { diasEntre, sumarDias } from "@/lib/dates";

// Lo que ve y hace quien paga.
//
// El pago se hace de las dos formas: a veces una factura suelta, a veces varias
// del mismo proveedor en una sola transferencia. Por eso no hay conciliación de
// pagos contra comprobantes: alcanza con que el sistema sume por proveedor y
// con poder marcar varias de una vez.

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Los tipos que RESTAN del saldo en vez de sumar. El importe se guarda
 *  siempre positivo y el signo lo decide el tipo: guardar negativos invita a
 *  cargar una factura común en negativo y descuadrar sin que nadie lo note. */
const RESTAN = new Set(["NOTA_CREDITO"]);

/** Los tipos que NO se pagan. Un remito es constancia de que la mercadería
 *  entró, no una deuda; si sumara, el saldo del proveedor saldría al doble. */
const NO_SE_PAGAN = new Set(["REMITO"]);

export type DeudaProveedor = {
  supplierId: string | null;
  nombre: string;
  total: bigint;
  cantidad: number;
};

export type DocumentoAPagar = {
  id: string;
  nombre: string;
  importeTotal: bigint | null;
  vencimiento: string | null;
  kind: string;
};

/**
 * El vencimiento que el sistema SUGIERE, sin guardarlo.
 *
 * Hay facturas que no traen fecha: la de Dinamark dice "7 DIAS", que es una
 * condición de pago y no un dato. La precedencia es siempre la misma:
 *
 *   1. La fecha que dice el papel, si dice una.
 *   2. Si no, emisión + `diasPago` del proveedor, marcado como propuesto.
 *   3. Si el proveedor no tiene `diasPago`, queda vacío y cae en la bandeja.
 *
 * Nunca se escribe solo: proponer es ayudar a quien paga, no decidir por ella.
 */
export function proponerVencimiento(
  fechaEmision: string | null,
  diasPago: number | null,
): string | null {
  if (!fechaEmision || diasPago == null) return null;
  return sumarDias(fechaEmision, diasPago);
}

/** Cuánto se le debe a cada proveedor, y en cuántos comprobantes. Es la
 *  pantalla desde la que se transfiere. */
export async function porProveedor(): Promise<DeudaProveedor[]> {
  const docs = await db.document.findMany({
    where: { deletedAt: null, pagadoAt: null, kind: { notIn: [...NO_SE_PAGAN] } },
    include: { supplier: true },
  });

  const acumulado = new Map<string, DeudaProveedor>();
  for (const d of docs) {
    const clave = d.supplierId ?? "";
    const fila = acumulado.get(clave) ?? {
      supplierId: d.supplierId,
      nombre: d.supplier?.name ?? "Sin proveedor",
      total: 0n,
      cantidad: 0,
    };
    const monto = d.importeTotal ?? 0n;
    fila.total += RESTAN.has(d.kind) ? -monto : monto;
    fila.cantidad += 1;
    acumulado.set(clave, fila);
  }

  return [...acumulado.values()].sort((a, b) => (b.total > a.total ? 1 : -1));
}

/** Qué vence entre dos días, de lo que todavía no se pagó. */
export async function queVence(desde: string, hasta: string): Promise<DocumentoAPagar[]> {
  if (!DIA.test(desde) || !DIA.test(hasta)) throw new Error("Las fechas van en AAAA-MM-DD.");

  const docs = await db.document.findMany({
    where: {
      deletedAt: null,
      pagadoAt: null,
      kind: { notIn: [...NO_SE_PAGAN] },
      vencimiento: { gte: desde, lte: hasta },
    },
    include: { supplier: true },
    orderBy: { vencimiento: "asc" },
  });

  return docs.map((d) => ({
    id: d.id,
    nombre: d.supplier?.name ?? "Sin proveedor",
    importeTotal: d.importeTotal,
    vencimiento: d.vencimiento,
    kind: d.kind,
  }));
}

/** Marca varios como pagados de una vez y devuelve cuántos cambió. Es como se
 *  paga de verdad: una transferencia que cancela varias facturas. */
export async function marcarPagados(
  ids: string[],
  cuando: Date,
  actor: { id: string; name: string },
): Promise<number> {
  if (ids.length === 0) return 0;

  const antes = await db.document.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, pagadoAt: true },
  });

  const r = await db.document.updateMany({
    where: { id: { in: antes.map((d) => d.id) } },
    data: { pagadoAt: cuando },
  });

  await db.documentChange.createMany({
    data: antes.map((d) => ({
      documentId: d.id,
      actorId: actor.id,
      actorName: actor.name,
      field: "pagadoAt",
      before: d.pagadoAt?.toISOString() ?? null,
      after: cuando.toISOString(),
    })),
  });

  return r.count;
}

/**
 * Carga el vencimiento del pago, que sale del "Vto:" del papel.
 *
 * NUNCA se autocompleta desde `cae` ni `caeVence`: son fechas distintas y ya se
 * confundieron una vez, cargando el vencimiento del CAE (06/09) como si fuera
 * la fecha de pago (11/09). Por eso este campo solo se escribe acá, a mano y
 * mirando la foto.
 */
export async function ponerVencimiento(
  id: string,
  vencimiento: string,
  actor: { id: string; name: string },
): Promise<void> {
  if (!DIA.test(vencimiento) || !esDiaReal(vencimiento)) {
    throw new Error("El vencimiento va en AAAA-MM-DD y tiene que ser un día real.");
  }

  const antes = await db.document.findUniqueOrThrow({
    where: { id },
    select: { vencimiento: true },
  });
  await db.document.update({ where: { id }, data: { vencimiento } });
  await db.documentChange.create({
    data: {
      documentId: id,
      actorId: actor.id,
      actorName: actor.name,
      field: "vencimiento",
      before: antes.vencimiento,
      after: vencimiento,
    },
  });
}

/**
 * Cuánto falta por resolver, contado con consultas sobre NULLs.
 *
 * No hay columna de estado a propósito: un estado miente apenas alguien edita
 * un campo y se olvida de moverlo. Preguntando por los nulos, la bandeja no
 * puede desincronizarse de la realidad porque no hay nada que mantener.
 */
export async function bandejas(): Promise<{
  sinProveedor: number;
  sinRevisar: number;
  sinVencimiento: number;
}> {
  const vivos = { deletedAt: null };
  const [sinProveedor, sinRevisar, sinVencimiento] = await Promise.all([
    db.document.count({ where: { ...vivos, supplierId: null } }),
    db.document.count({ where: { ...vivos, conforme: null } }),
    db.document.count({ where: { ...vivos, pagadoAt: null, vencimiento: null } }),
  ]);
  return { sinProveedor, sinRevisar, sinVencimiento };
}

// --- Pagar dos veces lo mismo -------------------------------------------------

/** Cuántos días de diferencia todavía hacen sospechar que es el mismo pago. */
const DIAS_DE_SOSPECHA = 10;

export type PosibleDuplicado = {
  supplierId: string | null;
  nombre: string;
  importe: bigint;
  documentIds: string[];
};

/**
 * Comprobantes que parecen ser el mismo pago cargado dos veces.
 *
 * El índice único ya impide cargar dos veces la misma **factura electrónica**.
 * Lo que no impide es **pagar dos veces la misma deuda**: un ticket o un remito
 * cargados a mano dos veces no tienen identidad fiscal que los delate, y ahí se
 * va plata de verdad.
 *
 * La regla es a propósito angosta —mismo proveedor, mismo importe al centavo,
 * menos de diez días de diferencia, ninguno pagado— porque **una alarma que
 * suena de más se deja de mirar**. Los que ya tienen número de comprobante
 * propio quedan afuera: son distintos por construcción y avisar sería ruido.
 */
export async function posiblesDuplicados(): Promise<PosibleDuplicado[]> {
  const docs = await db.document.findMany({
    where: {
      deletedAt: null,
      pagadoAt: null,
      numero: null, // los que tienen número propio no son ambiguos
      importeTotal: { not: null },
      supplierId: { not: null },
    },
    include: { supplier: true },
    orderBy: { fechaEmision: "asc" },
  });

  const porClave = new Map<string, typeof docs>();
  for (const d of docs) {
    const clave = `${d.supplierId}|${d.importeTotal}`;
    porClave.set(clave, [...(porClave.get(clave) ?? []), d]);
  }

  const avisos: PosibleDuplicado[] = [];
  for (const grupo of porClave.values()) {
    if (grupo.length < 2) continue;
    const cerca = grupo.filter((d) => d.fechaEmision != null);
    if (cerca.length < 2) continue;

    const primero = cerca[0].fechaEmision!;
    const juntos = cerca.filter(
      (d) => Math.abs(diasEntre(primero, d.fechaEmision!)) <= DIAS_DE_SOSPECHA,
    );
    if (juntos.length < 2) continue;

    avisos.push({
      supplierId: juntos[0].supplierId,
      nombre: juntos[0].supplier?.name ?? "Sin proveedor",
      importe: juntos[0].importeTotal!,
      documentIds: juntos.map((d) => d.id),
    });
  }
  return avisos;
}

function esDiaReal(dia: string): boolean {
  const [a, m, d] = dia.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}
