import { prismaComprobantes as db } from "@/lib/db-comprobantes";
import type { Cabecera, Destino, Kind } from "./tipos";

export type DatosAdjunto = {
  s3Key: string;
  mimeType: string;
  sizeBytes: number;
  /** ORIGINAL = la foto cruda. ESCANEADA = recortada y enderezada. Las dos
   *  variantes de una misma hoja comparten `pagina`. */
  variante?: "ORIGINAL" | "ESCANEADA";
  /** Qué hoja del comprobante es. Sin esto, todo va a la primera. */
  pagina?: number;
};

export type EntradaCaptura = {
  /** Se genera al abrir la cámara. Es lo que hace que un doble toque —o un
   *  reintento al volver la señal— no cree dos comprobantes. */
  clientKey: string;
  kind: Kind;
  cabecera: Cabecera;
  destino?: Destino;
  destinoNota?: string;
  conforme?: boolean;
  actor: { id: string; name: string };
  adjuntos: DatosAdjunto[];
};

export type ResultadoCaptura = {
  documentId: string;
  /** La captura se sumó a un comprobante que ya existía por su identidad
   *  fiscal: otra persona lo había fotografiado, o ya vino de ARCA. */
  fusionado: boolean;
  /** Es exactamente la misma captura, repetida. Doble toque o reintento. */
  yaExistia: boolean;
};

/**
 * Guarda una captura.
 *
 * La regla que manda: **la foto queda pase lo que pase**. Que el QR no se lea,
 * que el proveedor no exista todavía, que no se sepa el destino — nada de eso
 * puede impedir que el comprobante entre. Un papel fotografiado y sin
 * identificar ya es mejor que un papel sobre un escritorio.
 */
export async function guardarCaptura(input: EntradaCaptura): Promise<ResultadoCaptura> {
  const { cabecera: c } = input;

  // 1. ¿Es la misma captura otra vez? (doble toque, reintento de red)
  const repetida = await db.document.findUnique({ where: { clientKey: input.clientKey } });
  if (repetida) return { documentId: repetida.id, fusionado: false, yaExistia: true };

  // 2. ¿Ya existe este comprobante por su identidad fiscal?
  //    Solo se busca si la identidad está COMPLETA. Hay QR reales que vienen
  //    sin `nroCmp`, y buscar por identidad parcial fusionaría facturas
  //    distintas del mismo proveedor y el mismo día.
  const existente = tieneIdentidad(c)
    ? await db.document.findFirst({
        where: {
          cuitEmisor: c.cuitEmisor,
          tipoCbte: c.tipoCbte,
          puntoVenta: c.puntoVenta,
          numero: c.numero,
          deletedAt: null,
        },
      })
    : null;

  if (existente) return fusionar(existente.id, input);

  const creado = await db.document.create({
    data: {
      kind: input.kind,
      source: c.fuente,
      cuitEmisor: c.cuitEmisor ?? null,
      tipoCbte: c.tipoCbte ?? null,
      puntoVenta: c.puntoVenta ?? null,
      numero: c.numero ?? null,
      fechaEmision: c.fechaEmision ?? null,
      importeTotal: c.importeTotal ?? null,
      cae: c.cae ?? null,
      caeVence: c.caeVence ?? null,
      destino: input.destino ?? null,
      destinoNota: input.destinoNota ?? null,
      // `undefined` deja el campo en NULL, que significa "nadie revisó".
      // `false` significa "revisó y faltaban cosas". No son lo mismo.
      conforme: input.conforme ?? null,
      capturedById: input.actor.id,
      capturedByName: input.actor.name,
      clientKey: input.clientKey,
      attachments: { create: aFilasDeAdjunto(input.adjuntos, input.actor.id, 0) },
      changes: {
        create: {
          actorId: input.actor.id,
          actorName: input.actor.name,
          field: "alta",
          before: null,
          after: c.fuente,
        },
      },
    },
  });

  return { documentId: creado.id, fusionado: false, yaExistia: false };
}

/**
 * Suma una captura a un comprobante que ya existe.
 *
 * No es un error: en un depósito dos personas van a fotografiar la misma
 * factura, y el mismo comprobante puede llegar por foto y por ARCA. Tratar eso
 * como error es la forma más rápida de que la gente deje de usar la app.
 *
 * Lo que ya está cargado no se pisa. Lo que estaba vacío se completa.
 */
async function fusionar(documentId: string, input: EntradaCaptura): Promise<ResultadoCaptura> {
  const ultima = await db.attachment.findFirst({
    where: { documentId },
    orderBy: { page: "desc" },
  });
  const corrimiento = ultima?.page ?? 0;

  await db.attachment.createMany({
    data: aFilasDeAdjunto(input.adjuntos, input.actor.id, corrimiento).map((a) => ({
      ...a,
      documentId,
    })),
  });

  await db.document.update({
    where: { id: documentId },
    data: {
      destino: input.destino ?? undefined,
      destinoNota: input.destinoNota ?? undefined,
      conforme: input.conforme ?? undefined,
    },
  });

  await db.documentChange.create({
    data: {
      documentId,
      actorId: input.actor.id,
      actorName: input.actor.name,
      field: "adjunto",
      before: null,
      after: `${input.adjuntos.length} foto(s)`,
    },
  });

  return { documentId, fusionado: true, yaExistia: false };
}

/**
 * De los datos que manda la captura a las filas de la tabla.
 *
 * La página **no** se numera por orden de llegada: las dos variantes de una
 * misma hoja —la original y la escaneada— comparten página, así que numerarlas
 * secuencialmente convertiría una factura de una hoja en una de dos.
 */
function aFilasDeAdjunto(adjuntos: DatosAdjunto[], uploadedById: string, corrimiento: number) {
  return adjuntos.map((a) => ({
    s3Key: a.s3Key,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    variante: a.variante ?? "ORIGINAL",
    page: (a.pagina ?? 1) + corrimiento,
    uploadedById,
  }));
}

/** Los cuatro campos que identifican una factura electrónica argentina. Con
 *  uno solo que falte no identifican nada. */
function tieneIdentidad(c: Cabecera): boolean {
  return c.cuitEmisor != null && c.tipoCbte != null && c.puntoVenta != null && c.numero != null;
}
