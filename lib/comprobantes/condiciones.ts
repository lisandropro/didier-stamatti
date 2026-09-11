import { prismaComprobantes as db } from "@/lib/db-comprobantes";
import { aporteAlSaldo, NO_SE_PAGAN } from "./politica";
import { esCategoria } from "./categorias";

// La condición de pago de cada proveedor.
//
// **Es un acuerdo, no un dato que se copia de un papel.** Lo pactó una persona
// con el proveedor, y dentro de seis meses alguien va a preguntar "¿desde
// cuándo le pagamos a 30 días?". Por eso se guarda con quién lo cargó y cuándo,
// y por eso esto no es una columna más del alta de proveedor.
//
// **Para qué sirve, que es lo que le da sentido.** La mayoría de las facturas
// no traen fecha de vencimiento: son cuenta corriente. Con la condición
// cargada, el sistema puede PROPONER la fecha de pago de cada factura —emisión
// más los días pactados— en vez de pedir que alguien tipee 145 fechas a mano.
// Es la regla del proyecto: ningún número que se pueda calcular se escribe.
//
// Lo que NO hace es decidir. La fecha propuesta se muestra como propuesta; si
// el papel trae una fecha, gana el papel.

/**
 * Los tres estados de un proveedor, sin columna de estado.
 *
 * Salen de las dos columnas juntas, que es como el resto del módulo distingue
 * "no se sabe" de "se sabe que no":
 *
 *   - `sin-cargar`  — nadie contestó todavía. Es el hueco, y es la razón de ser
 *                     de la pantalla.
 *   - `dias`        — a N días de la emisión. `0` es contado.
 *   - `sin-plazo`   — se preguntó y la respuesta es que no hay plazo fijo: se
 *                     paga cuando se puede. **No es lo mismo que no saber**, y
 *                     mezclarlos haría que la pantalla nunca se vacíe.
 *   - `debito`      — la plata sale sola de la cuenta. No es un plazo: es otra
 *                     forma de pagar, y nadie decide nada. Sus comprobantes no
 *                     van a la lista de "qué pagar".
 */
export type Condicion = { estado: "sin-cargar" } | CondicionPactada;

/** Lo que se puede acordar. `sin-cargar` no está: no es una respuesta. */
export type CondicionPactada =
  | { estado: "dias"; dias: number }
  | { estado: "sin-plazo" }
  | { estado: "debito" };

export function condicionDe(p: {
  diasPago: number | null;
  debitoAutomatico: boolean;
  condicionAcordadaAt: Date | null;
}): Condicion {
  if (p.condicionAcordadaAt == null) return { estado: "sin-cargar" };
  if (p.debitoAutomatico) return { estado: "debito" };
  if (p.diasPago == null) return { estado: "sin-plazo" };
  return { estado: "dias", dias: p.diasPago };
}

/** Un proveedor con lo que hace falta para decidir su condición: cuánto se le
 *  debe —que es lo que ordena la lista— y qué se acordó, si se acordó. */
export type ProveedorConCondicion = {
  id: string;
  nombre: string;
  cuit: string | null;
  condicion: Condicion;
  /** El rubro. Decide si lo que se le compra entra en el costo de los eventos.
   *  NULL = sin clasificar, y entonces queda afuera del costo. */
  categoria: string | null;
  acordadaPor: string | null;
  acordadaAt: string | null;
  /** Deuda viva, en centavos. Positiva o negativa: una nota de crédito resta. */
  deuda: bigint;
  comprobantes: number;
  /**
   * Cuántos de esos comprobantes NO tienen importe cargado.
   *
   * **Un comprobante sin importe no es un importe de cero.** Contarlo como cero
   * da una deuda más chica que la real y se lee como "no debe nada", que es
   * tranquilidad falsa. La pantalla de pagos ya había aprendido esto y tiene su
   * propio `sinImporte`; esta consulta lo había perdido de nuevo.
   */
  sinImporte: number;
  /** La factura sin pagar más vieja. Es el otro dato con el que se decide, y el
   *  único que sirve para ordenar a los que NO tienen plazo fijo. */
  masVieja: string | null;
};

/**
 * Todos los proveedores, con su deuda y su condición.
 *
 * **Ordenados por deuda y no alfabéticamente**, a propósito: son 104 y trece
 * concentran el 80% de la plata. Una lista alfabética obliga a recorrerla
 * entera para encontrar los que importan; ésta pone el trabajo que rinde
 * arriba de todo.
 *
 * Los que no tienen deuda viva van igual, al final: un proveedor al que hoy no
 * se le debe nada puede facturar mañana, y tener su condición ya cargada es
 * justamente el objetivo.
 */
export async function conCondicion(entidadId?: string | null): Promise<ProveedorConCondicion[]> {
  const [proveedores, docs] = await Promise.all([
    db.supplier.findMany({ where: { deletedAt: null, active: true }, orderBy: { name: "asc" } }),
    db.document.findMany({
      where: {
        deletedAt: null,
        pagadoAt: null,
        kind: { notIn: [...NO_SE_PAGAN] },
        ...(entidadId === undefined ? {} : { entidadId }),
      },
      select: { supplierId: true, importeTotal: true, kind: true, fechaEmision: true },
    }),
  ]);

  const porProveedor = new Map<
    string,
    { deuda: bigint; n: number; sinImporte: number; masVieja: string | null }
  >();
  for (const d of docs) {
    if (!d.supplierId) continue;
    const acc = porProveedor.get(d.supplierId) ?? { deuda: 0n, n: 0, sinImporte: 0, masVieja: null };
    if (d.importeTotal == null) acc.sinImporte += 1;
    else acc.deuda += aporteAlSaldo(d.kind, d.importeTotal);
    acc.n += 1;
    // La más vieja de las que siguen sin pagarse. Un comprobante sin fecha no
    // puede competir por "más vieja": no se sabe cuándo es.
    if (d.fechaEmision && (acc.masVieja === null || d.fechaEmision < acc.masVieja)) {
      acc.masVieja = d.fechaEmision;
    }
    porProveedor.set(d.supplierId, acc);
  }

  const filas = proveedores.map((p) => {
    const acc = porProveedor.get(p.id);
    return {
      id: p.id,
      nombre: p.name,
      cuit: p.cuit,
      condicion: condicionDe(p),
      categoria: p.categoria,
      acordadaPor: p.condicionAcordadaPorName,
      acordadaAt: p.condicionAcordadaAt ? p.condicionAcordadaAt.toISOString().slice(0, 10) : null,
      deuda: acc?.deuda ?? 0n,
      comprobantes: acc?.n ?? 0,
      sinImporte: acc?.sinImporte ?? 0,
      masVieja: acc?.masVieja ?? null,
    };
  });

  // El orden es el trabajo: primero lo que falta, después lo hecho, al final lo
  // que hoy no urge. Dentro de cada grupo, la deuda más grande arriba — con
  // trece proveedores se cubre el 80% de la plata, así que las primeras filas
  // son las que rinden.
  //
  // Comparador estable: devolver siempre 1 o -1 hace que dos deudas iguales se
  // ordenen distinto entre corridas, y ésta es una pantalla que se recarga
  // después de cada guardado.
  return filas.sort((a, b) => {
    const grupo = (f: ProveedorConCondicion) =>
      f.comprobantes === 0 ? 2 : f.condicion.estado === "sin-cargar" ? 0 : 1;
    const ga = grupo(a);
    const gb = grupo(b);
    if (ga !== gb) return ga - gb;
    if (a.deuda !== b.deuda) return b.deuda > a.deuda ? 1 : -1;
    return a.nombre.localeCompare(b.nombre);
  });
}

/**
 * Registra la condición pactada con un proveedor.
 *
 * `dias === null` significa **se acordó que no hay plazo fijo**, que es una
 * respuesta y no un vacío: por eso escribe `condicionAcordadaAt` igual. Volver
 * al estado "sin cargar" no es una operación de esta función — para eso está
 * `olvidar`, que es explícita.
 */
export async function acordar(
  supplierId: string,
  c: CondicionPactada,
  actor: { id: string; name: string },
): Promise<void> {
  if (c.estado === "dias" && (!Number.isInteger(c.dias) || c.dias < 0 || c.dias > 365)) {
    // 365 es un tope de sanidad, no una regla del negocio: atrapa el dedo que
    // escribe 3000 y deja pasar cualquier plazo real.
    throw new Error("Los días de pago van de 0 a 365.");
  }
  await db.supplier.update({
    where: { id: supplierId },
    data: {
      diasPago: c.estado === "dias" ? c.dias : null,
      debitoAutomatico: c.estado === "debito",
      condicionAcordadaAt: new Date(),
      condicionAcordadaPorId: actor.id,
      condicionAcordadaPorName: actor.name,
    },
  });
}

/**
 * Pone el rubro de un proveedor.
 *
 * Va aparte de `acordar` porque son dos hechos distintos: el rubro es lo que el
 * proveedor vende y la condición es lo que se pactó con él. Mezclarlos obligaría
 * a contestar los dos para guardar cualquiera.
 */
export async function clasificar(supplierId: string, categoria: string | null): Promise<void> {
  if (categoria != null && !esCategoria(categoria)) {
    throw new Error(`No conozco el rubro "${categoria}".`);
  }
  await db.supplier.update({ where: { id: supplierId }, data: { categoria } });
}

/** Deshace el registro: el proveedor vuelve a "sin cargar".
 *
 *  Existe porque cargar mal es fácil y quedarse con un dato inventado es peor
 *  que no tenerlo — si nadie puede volver atrás, la respuesta a la duda es
 *  dejar cualquier cosa. */
export async function olvidar(supplierId: string): Promise<void> {
  await db.supplier.update({
    where: { id: supplierId },
    data: {
      diasPago: null,
      debitoAutomatico: false,
      condicionAcordadaAt: null,
      condicionAcordadaPorId: null,
      condicionAcordadaPorName: null,
    },
  });
}

/** Cuántos proveedores CON deuda viva siguen sin condición cargada.
 *
 *  Se cuentan sólo los que deben plata: es una bandeja, y una bandeja que
 *  incluye proveedores a los que no se les debe nada no puede llegar a cero.
 *  Una bandeja que no se vacía se deja de mirar en dos semanas. */
export async function sinCondicion(entidadId?: string | null): Promise<number> {
  const filas = await conCondicion(entidadId);
  return filas.filter((f) => f.condicion.estado === "sin-cargar" && f.comprobantes > 0).length;
}
