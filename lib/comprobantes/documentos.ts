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
  /** Campos donde la nueva lectura contradijo a la guardada. No se pisan —la
   *  primera pudo haber sido revisada a mano— pero la discrepancia queda en el
   *  historial y se informa: dos lecturas que no coinciden es justo la señal
   *  que dice si el peldaño automático sirve. */
  discrepancias?: string[];
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
  //    Se miran los dos lados: el documento que ESA captura creó, y las llaves
  //    de las capturas que se fusionaron contra un documento que ya existía.
  const repetida = await db.document.findUnique({ where: { clientKey: input.clientKey } });
  if (repetida) {
    return { documentId: repetida.id, fusionado: false, yaExistia: true, anulado: !!repetida.deletedAt };
  }
  const yaFusionada = await db.capturaVista.findUnique({
    where: { clientKey: input.clientKey },
    include: { document: { select: { deletedAt: true } } },
  });
  if (yaFusionada) {
    return {
      documentId: yaFusionada.documentId,
      fusionado: false,
      yaExistia: true,
      anulado: !!yaFusionada.document.deletedAt,
    };
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

  // El proveedor sale del CUIT del comprobante, en el alta. Es lo que hace que
  // la deuda se pueda agrupar y que la alarma de duplicados pueda disparar.
  const supplierId = await resolverProveedor(c.cuitEmisor);

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
        supplierId,
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

  // Solo se escribe lo que estaba vacío. Lo que contradice a lo guardado NO se
  // pisa, pero tampoco se tira: se registra.
  const completados: { campo: string; valor: string }[] = [];
  const conflictos: { campo: string; antes: string; nuevo: string }[] = [];
  const datos: Record<string, unknown> = {};
  for (const campo of COMPLETABLES) {
    const nuevo = input.cabecera[campo];
    if (nuevo == null) continue;
    if (antes[campo] == null) {
      datos[campo] = nuevo;
      completados.push({ campo, valor: String(nuevo) });
    } else if (String(antes[campo]) !== String(nuevo)) {
      conflictos.push({ campo, antes: String(antes[campo]), nuevo: String(nuevo) });
    }
  }
  // Estos tres también se registran: `conforme` es la constancia de que alguien
  // revisó que la mercadería entró completa, y aparecía en el comprobante sin
  // que quedara quién lo puso.
  if (input.destino != null && antes.destino == null) {
    datos.destino = input.destino;
    completados.push({ campo: "destino", valor: input.destino });
  }
  if (input.destinoNota != null && antes.destinoNota == null) {
    datos.destinoNota = input.destinoNota;
    completados.push({ campo: "destinoNota", valor: input.destinoNota });
  }
  if (input.conforme != null && antes.conforme == null) {
    datos.conforme = input.conforme;
    completados.push({ campo: "conforme", valor: String(input.conforme) });
  }

  const actor = { actorId: input.actor.id, actorName: input.actor.name };
  await db.$transaction([
    db.attachment.createMany({
      data: aFilasDeAdjunto(input.adjuntos, input.actor.id, corrimiento).map((a) => ({
        ...a,
        documentId,
      })),
    }),
    // La llave de ESTA captura queda anotada: sin esto, un reintento con la
    // misma llave volvía a adjuntar las mismas fotos, porque `clientKey` en el
    // documento es el de la captura que lo creó y no el de las que se fusionan.
    db.capturaVista.create({ data: { clientKey: input.clientKey, documentId } }),
    ...(Object.keys(datos).length > 0
      ? [db.document.update({ where: { id: documentId }, data: datos })]
      : []),
    db.documentChange.createMany({
      data: [
        { documentId, ...actor, field: "adjunto", before: null, after: `${input.adjuntos.length} foto(s)` },
        // Un dato que aparece sin rastro es un dato del que después nadie sabe
        // de dónde salió.
        ...completados.map((c) => ({ documentId, ...actor, field: c.campo, before: null, after: c.valor })),
        // Y una discrepancia sin rastro es peor: es la evidencia de que dos
        // lecturas del mismo papel no coincidieron.
        ...conflictos.map((c) => ({
          documentId,
          ...actor,
          field: `${c.campo}.conflicto`,
          before: c.antes,
          after: c.nuevo,
        })),
      ],
    }),
  ]);

  return {
    documentId,
    fusionado: true,
    yaExistia: false,
    anulado: !!antes.deletedAt,
    discrepancias: conflictos.length > 0 ? conflictos.map((c) => c.campo) : undefined,
  };
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

export type CapturaDelDia = {
  id: string;
  kind: string;
  proveedor: string | null;
  destino: string | null;
  conforme: boolean | null;
  identificado: boolean;
  hora: string;
};

/**
 * Lo que una persona cargó hoy.
 *
 * **Sin un solo importe**: esto lo mira quien recibe la mercadería, y su rol no
 * puede ver plata. La lista sirve para lo único que necesita — chequear de un
 * vistazo que no se le quedó ningún papel sin sacar.
 */
export async function capturasDelDia(actorId: string, desde: Date): Promise<CapturaDelDia[]> {
  const docs = await db.document.findMany({
    where: { capturedById: actorId, createdAt: { gte: desde }, deletedAt: null },
    include: { supplier: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return docs.map((d) => ({
    id: d.id,
    kind: d.kind,
    proveedor: d.supplier?.name ?? null,
    destino: d.destino,
    conforme: d.conforme,
    // Lo que le importa a quien capturó: si el papel quedó identificado o si
    // alguien va a tener que resolverlo después.
    identificado: d.cuitEmisor != null && d.numero != null,
    hora: d.createdAt.toISOString(),
  }));
}

/**
 * Encuentra o crea el proveedor a partir del CUIT del comprobante.
 *
 * **Esta función faltaba, y sin ella el módulo no funcionaba de punta a punta.**
 * Nada escribía `supplierId`: la pantalla de deuda mostraba una sola fila
 * llamada "Sin proveedor" con todo adentro, y la alarma de pago duplicado
 * —que filtra por proveedor— no podía dispararse nunca. Las pruebas no lo
 * detectaban porque sembraban el proveedor a mano.
 *
 * El CUIT es la identidad: el nombre del papel varía ("DON ANGEL", "Don Angel
 * SRL") y no sirve para identificar. Sin CUIT no se inventa nada — el
 * comprobante queda sin proveedor y cae en la bandeja, que es lo correcto.
 */
export async function resolverProveedor(
  cuit: string | undefined,
  nombreSugerido?: string,
): Promise<string | null> {
  if (!cuit || !/^\d{11}$/.test(cuit)) return null;

  // `upsert` y no buscar-después-crear: dos capturas simultáneas del mismo
  // proveedor chocaban contra el índice único del CUIT y la segunda reventaba.
  // El nombre se corrige después; el CUIT no cambia. Nacer con un nombre
  // provisorio es mejor que no existir, porque sin proveedor no hay deuda.
  const proveedor = await db.supplier.upsert({
    where: { cuit },
    update: {},
    create: { name: nombreSugerido?.trim() || `CUIT ${cuit}`, cuit },
  });
  return proveedor.id;
}

/**
 * Asigna o corrige el proveedor de un comprobante, con rastro.
 */
export async function asignarProveedor(
  documentId: string,
  supplierId: string,
  actor: { id: string; name: string },
): Promise<void> {
  const antes = await db.document.findUniqueOrThrow({
    where: { id: documentId },
    select: { supplierId: true },
  });
  if (antes.supplierId === supplierId) return;

  await db.$transaction([
    db.document.update({ where: { id: documentId }, data: { supplierId } }),
    db.documentChange.create({
      data: {
        documentId,
        actorId: actor.id,
        actorName: actor.name,
        field: "supplierId",
        before: antes.supplierId,
        after: supplierId,
      },
    }),
  ]);
}
