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
  /** Se fusionó contra un comprobante ANULADO. La foto quedó guardada, pero
   *  quien capturó tiene que enterarse en vez de creer que cargó algo vivo. */
  anulado: boolean;
};

/** Los campos de cabecera que una captura posterior puede COMPLETAR. La
 *  identidad fiscal no está: si difiere, no son el mismo comprobante y no se
 *  habría fusionado. */
const COMPLETABLES = ["fechaEmision", "importeTotal", "cae", "caeVence"] as const;

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

  // El importe se guarda SIEMPRE positivo: el signo lo decide `kind`. Un
  // negativo que entre acá descuadra el saldo del proveedor y no lo nota nadie,
  // porque una resta de más se ve igual que una factura chica.
  if (c.importeTotal != null && c.importeTotal < 0n) {
    throw new Error("El importe tiene que ser positivo; el signo lo decide el tipo de comprobante.");
  }

  // 1. ¿Es la misma captura otra vez? (doble toque, reintento de red)
  const repetida = await db.document.findUnique({ where: { clientKey: input.clientKey } });
  if (repetida) {
    return { documentId: repetida.id, fusionado: false, yaExistia: true, anulado: !!repetida.deletedAt };
  }

  // 2. ¿Ya existe este comprobante por su identidad fiscal?
  //    Solo se busca si la identidad está COMPLETA. Hay QR reales que vienen
  //    sin `nroCmp`, y buscar por identidad parcial fusionaría facturas
  //    distintas del mismo proveedor y el mismo día.
  //
  //    **Sin filtrar por `deletedAt`**: el índice único tampoco lo filtra. Un
  //    comprobante anulado sigue ocupando su identidad, y buscarlo solo entre
  //    los vivos haría que el alta reventara contra el índice.
  const existente = tieneIdentidad(c) ? await db.document.findFirst({ where: identidadDe(c) }) : null;
  if (existente) return fusionar(existente.id, input);

  try {
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
    return { documentId: creado.id, fusionado: false, yaExistia: false, anulado: false };
  } catch (e) {
    // Dos personas fotografiaron la misma factura al mismo tiempo: las dos
    // pasaron el punto 2 sin encontrarse y las dos intentaron insertar. La
    // segunda choca contra el índice único, que es justo lo que tiene que
    // pasar — la base es la que garantiza que no haya duplicados, no el orden
    // en que corrieron las consultas. Acá se recoge y se fusiona.
    if (!esViolacionDeUnico(e) || !tieneIdentidad(c)) throw e;
    const ganador = await db.document.findFirst({ where: identidadDe(c) });
    if (!ganador) throw e;
    return fusionar(ganador.id, input);
  }
}

/**
 * Suma una captura a un comprobante que ya existe.
 *
 * No es un error: en un depósito dos personas van a fotografiar la misma
 * factura, y el mismo comprobante puede llegar por foto y por ARCA. Tratar eso
 * como error es la forma más rápida de que la gente deje de usar la app.
 *
 * **Lo que ya está cargado no se pisa; lo que estaba vacío se completa.** La
 * primera lectura gana porque es la que alguien ya pudo haber revisado, y
 * pisarla convertiría una corrección hecha a mano en algo que se deshace solo.
 */
async function fusionar(documentId: string, input: EntradaCaptura): Promise<ResultadoCaptura> {
  const antes = await db.document.findUniqueOrThrow({ where: { id: documentId } });

  const ultima = await db.attachment.findFirst({ where: { documentId }, orderBy: { page: "desc" } });
  const corrimiento = ultima?.page ?? 0;

  await db.attachment.createMany({
    data: aFilasDeAdjunto(input.adjuntos, input.actor.id, corrimiento).map((a) => ({
      ...a,
      documentId,
    })),
  });

  // Solo se escribe lo que estaba vacío.
  const completados: { campo: string; valor: string }[] = [];
  const datos: Record<string, unknown> = {};
  for (const campo of COMPLETABLES) {
    const nuevo = input.cabecera[campo];
    if (nuevo != null && antes[campo] == null) {
      datos[campo] = nuevo;
      completados.push({ campo, valor: String(nuevo) });
    }
  }
  if (input.destino != null && antes.destino == null) datos.destino = input.destino;
  if (input.destinoNota != null && antes.destinoNota == null) datos.destinoNota = input.destinoNota;
  if (input.conforme != null && antes.conforme == null) datos.conforme = input.conforme;

  if (Object.keys(datos).length > 0) {
    await db.document.update({ where: { id: documentId }, data: datos });
  }

  await db.documentChange.createMany({
    data: [
      {
        documentId,
        actorId: input.actor.id,
        actorName: input.actor.name,
        field: "adjunto",
        before: null,
        after: `${input.adjuntos.length} foto(s)`,
      },
      // Un dato que aparece sin rastro es un dato del que después nadie sabe de
      // dónde salió.
      ...completados.map((c) => ({
        documentId,
        actorId: input.actor.id,
        actorName: input.actor.name,
        field: c.campo,
        before: null,
        after: c.valor,
      })),
    ],
  });

  return { documentId, fusionado: true, yaExistia: false, anulado: !!antes.deletedAt };
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

function identidadDe(c: Cabecera) {
  return {
    cuitEmisor: c.cuitEmisor,
    tipoCbte: c.tipoCbte,
    puntoVenta: c.puntoVenta,
    numero: c.numero,
  };
}

/** El error de Prisma cuando choca un índice único. Se mira el código y no el
 *  texto: el texto cambia entre versiones, el código no. */
function esViolacionDeUnico(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}
