import { prismaComprobantes as db } from "@/lib/db-comprobantes";

// Lo que se le cobra al cliente por un evento: el otro lado del margen.
//
// **El margen es ingreso menos costo, y hasta acá el ingreso no existía.** Se
// podía costear un evento a la perfección y seguir sin poder calcular si dejó
// plata. `Event` tiene lugar, fecha, invitados y responsable — ningún precio.
//
// El ingreso es **lo pactado en el presupuesto**, no lo cobrado. Es lo que
// contesta si el evento fue buen negocio; si el cliente pagó o no es otra
// pregunta, y mezclarlas haría que un evento excelente todavía impago diera
// margen negativo.

/** La alícuota del servicio de catering, confirmada por el usuario. */
export const IVA_POR_CIENTO = 21n;

/**
 * Lo pactado, en sus tres formas.
 *
 * **El neto es el único que se puede comparar contra el costo.** ARCA entrega
 * el costo con neto e IVA separados; si el ingreso se comparara con el IVA
 * adentro, el margen saldría inflado un 21% — y un margen inflado es peor que
 * ningún margen, porque se usa para decidir precios.
 */
export type Pactado = {
  /** Tal como se acordó con el cliente, con o sin IVA según el caso. */
  bruto: bigint;
  /** Sin IVA. El que entra en el margen. */
  neto: bigint;
  iva: bigint;
};

/** División de enteros redondeando al más cercano, mitad para arriba.
 *
 *  Sin esto, `a / b` en BigInt trunca, y truncar centavos hacia abajo en cada
 *  evento va dejando una diferencia que después nadie puede explicar. */
function dividir(a: bigint, b: bigint): bigint {
  return (a * 2n + b) / (b * 2n);
}

/**
 * Cuánto se pactó por este evento.
 *
 * Devuelve `null` cuando falta el precio o los comensales, **no cero**: un
 * evento sin precio cargado no vale cero pesos, no se sabe cuánto vale. Cero
 * se leería como "no dejó nada" y arruinaría cualquier promedio.
 */
export function calcularPactado(p: {
  precioPorPersona: bigint | null;
  comensales: number | null;
  extras: bigint[];
  conIva: boolean | null;
}): Pactado | null {
  if (p.precioPorPersona == null || p.comensales == null) return null;
  if (p.comensales < 0 || p.precioPorPersona < 0n) return null;

  const cubiertos = p.precioPorPersona * BigInt(p.comensales);
  const extras = p.extras.reduce((a, e) => a + e, 0n);
  const bruto = cubiertos + extras;

  // `conIva` en NULL es "no se sabe", y sin saberlo no se puede sacar el neto.
  // Se trata como el caso más conservador —que el precio ya lo incluya— para
  // no inflar el margen mientras el dato falta. La pantalla lo muestra como
  // pendiente de responder.
  const incluye = p.conIva !== false;
  if (incluye) {
    const neto = dividir(bruto * 100n, 100n + IVA_POR_CIENTO);
    return { bruto, neto, iva: bruto - neto };
  }
  const iva = dividir(bruto * IVA_POR_CIENTO, 100n);
  return { bruto, neto: bruto, iva };
}

/** Un evento con lo que se le cobra, listo para la pantalla. */
export type IngresoDeEvento = {
  eventoId: string;
  lugar: string;
  fecha: string;
  precioPorPersona: bigint | null;
  comensales: number | null;
  conIva: boolean | null;
  extras: { id: string; descripcion: string; importe: bigint }[];
  pactado: Pactado | null;
  cargadoPor: string | null;
};

function armar(r: {
  eventoId: string;
  lugar: string;
  fecha: string;
  precioPorPersona: bigint | null;
  comensales: number | null;
  conIva: boolean | null;
  cargadoPorName: string | null;
  extras: { id: string; descripcion: string; importe: bigint }[];
}): IngresoDeEvento {
  return {
    eventoId: r.eventoId,
    lugar: r.lugar,
    fecha: r.fecha,
    precioPorPersona: r.precioPorPersona,
    comensales: r.comensales,
    conIva: r.conIva,
    extras: r.extras,
    pactado: calcularPactado({
      precioPorPersona: r.precioPorPersona,
      comensales: r.comensales,
      extras: r.extras.map((e) => e.importe),
      conIva: r.conIva,
    }),
    cargadoPor: r.cargadoPorName,
  };
}

/** Los ingresos ya cargados, por id de evento. */
export async function porEvento(eventoIds: string[]): Promise<Map<string, IngresoDeEvento>> {
  if (eventoIds.length === 0) return new Map();
  const filas = await db.eventoIngreso.findMany({
    where: { eventoId: { in: eventoIds } },
    include: { extras: { orderBy: { orden: "asc" } } },
  });
  return new Map(filas.map((f) => [f.eventoId, armar(f)]));
}

/** Lo que se pactó en un evento. `null` si nadie lo cargó. */
export async function deUnEvento(eventoId: string): Promise<IngresoDeEvento | null> {
  const f = await db.eventoIngreso.findUnique({
    where: { eventoId },
    include: { extras: { orderBy: { orden: "asc" } } },
  });
  return f ? armar(f) : null;
}

export type DatosDelEvento = { eventoId: string; lugar: string; fecha: string };

export type LoPactado = {
  precioPorPersona: bigint | null;
  comensales: number | null;
  conIva: boolean | null;
  extras: { descripcion: string; importe: bigint }[];
};

/**
 * Guarda lo pactado de un evento.
 *
 * Los extras se reemplazan enteros en vez de intentar casarlos uno por uno: son
 * dos o tres por evento, y un reemplazo completo no puede dejar a medias una
 * lista que alguien acaba de editar.
 */
export async function guardar(
  evento: DatosDelEvento,
  p: LoPactado,
  entidadId: string | null,
  actor: { id: string; name: string },
): Promise<void> {
  if (p.comensales != null && (!Number.isInteger(p.comensales) || p.comensales < 0)) {
    throw new Error("Los comensales tienen que ser un número entero y positivo.");
  }
  if (p.precioPorPersona != null && p.precioPorPersona < 0n) {
    throw new Error("El precio por persona no puede ser negativo.");
  }
  for (const e of p.extras) {
    if (!e.descripcion.trim()) throw new Error("Cada extra necesita un nombre.");
    if (e.importe < 0n) throw new Error("El importe de un extra no puede ser negativo.");
  }

  const datos = {
    lugar: evento.lugar,
    fecha: evento.fecha,
    entidadId,
    precioPorPersona: p.precioPorPersona,
    comensales: p.comensales,
    conIva: p.conIva,
    cargadoPorId: actor.id,
    cargadoPorName: actor.name,
  };

  await db.$transaction(async (tx) => {
    const fila = await tx.eventoIngreso.upsert({
      where: { eventoId: evento.eventoId },
      create: { eventoId: evento.eventoId, ...datos },
      update: datos,
      select: { id: true },
    });
    await tx.eventoExtra.deleteMany({ where: { ingresoId: fila.id } });
    if (p.extras.length > 0) {
      await tx.eventoExtra.createMany({
        data: p.extras.map((e, i) => ({
          ingresoId: fila.id,
          descripcion: e.descripcion.trim(),
          importe: e.importe,
          orden: i,
        })),
      });
    }
  });
}

/** Borra lo cargado de un evento: vuelve a "sin precio".
 *
 *  Existe por lo mismo que `olvidar` en las condiciones de pago: si cargar mal
 *  no se pudiera deshacer, la respuesta a la duda sería dejar cualquier cosa. */
export async function borrar(eventoId: string): Promise<void> {
  await db.eventoIngreso.deleteMany({ where: { eventoId } });
}
