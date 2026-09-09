import { prismaComprobantes as db } from "@/lib/db-comprobantes";
import { resolverProveedor } from "./documentos";

// Importar el CSV de ARCA (*Mis Comprobantes → Recibidos*).
//
// **Qué resuelve.** La captura por foto cubre el 100% de lo que llega al
// depósito, pero solo lo que llega. Esto contesta la otra mitad de la pregunta:
// **qué facturas existen que nadie trajo.** El fisco ya las tiene todas.
//
// ---------------------------------------------------------------------------
//
// **Acá NO está el parser, y es a propósito.**
//
// Este archivo trabaja sobre `FilaArca`, que es lo que un comprobante necesita
// —definido por nuestro modelo, no por cómo ARCA acomode sus columnas—. La
// función que convierte el texto del CSV en `FilaArca[]` se escribe cuando haya
// un archivo real, y no antes.
//
// La razón no es prudencia abstracta: ya pasó. El QR de AFIP está documentado
// como JSON y dos de cada cinco no pasan por `JSON.parse` —ceros a la
// izquierda, CUIT con guiones, fechas al revés—. Un parser escrito contra lo
// que el archivo *debería* traer importa mal y **nadie se entera**, porque las
// filas entran y los números cierran. Es la peor clase de error para un sistema
// de plata.
//
// Todo lo que sigue —el emparejamiento, la idempotencia, las tres listas— se
// prueba entero sin el archivo.

/**
 * Una fila del CSV, ya interpretada.
 *
 * Los importes en CENTAVOS y el tipo ya traducido a nuestro vocabulario
 * (`A`, `NOTA_CREDITO_B`, …), porque eso es lo que sabe leer el resto del
 * módulo. Traducir es trabajo del parser.
 */
export type FilaArca = {
  cuitEmisor: string;
  /** El nombre del emisor tal como lo imprime ARCA. Sirve para dar de alta el
   *  proveedor con algo mejor que "CUIT 20135041379". */
  denominacion?: string;
  tipoCbte: string;
  puntoVenta: number;
  numero: number;
  fechaEmision: string; // "AAAA-MM-DD"
  importeTotal: bigint; // CENTAVOS
  neto?: bigint;
  iva?: bigint;
  percepciones?: bigint;
  moneda?: string;
  cae?: string;
};

export type ResultadoImportacion = {
  filasLeidas: number;
  /** Ya estaban y se completaron con el dato del fisco. */
  completadas: number;
  /** ARCA las conoce y nadie había traído el papel. */
  creadas: number;
  /**
   * Ya estaban cargadas y no había nada que corregir.
   *
   * **Existe para que los números cierren.** Contra el archivo real —743
   * filas— la pantalla mostraba 741 creadas y 1 completada: faltaba una y no
   * había forma de saber si se había perdido. `creadas + completadas +
   * yaEstaban` tiene que dar `filasLeidas`, siempre; si no da, algo se cayó en
   * el camino. `sinRespaldo` NO entra en esa cuenta: no cuenta filas del
   * archivo sino comprobantes nuestros que el archivo no trae.
   */
  yaEstaban: number;
  /** Tenemos el papel y ARCA no las conoce, dentro del período. */
  sinRespaldo: number;
  /** Dónde ARCA difiere de algo corregido a mano. No se pisa. */
  discrepancias: Discrepancia[];
  desde: string | null;
  hasta: string | null;
};

export type Discrepancia = {
  documentId: string;
  campo: string;
  loCargado: string | null;
  segunArca: string | null;
};

/** Los tipos que ARCA conoce. Un remito o un ticket no están en el fisco, así
 *  que su ausencia no significa nada y no se marcan. */
const FISCALES = new Set(["FACTURA", "NOTA_CREDITO", "NOTA_DEBITO"]);

/**
 * Los campos que ARCA trae y puede completar o corregir.
 *
 * `vencimiento` NO está, y no es un olvido: ARCA no lo trae. Lo único parecido
 * es la fecha de vencimiento del CAE, que **ya se confundió una vez** con la
 * fecha de pago. Son cosas distintas y acá no se cruzan.
 */
const CAMPOS = [
  "fechaEmision",
  "importeTotal",
  "neto",
  "iva",
  "percepciones",
  "moneda",
  "cae",
] as const;
type Campo = (typeof CAMPOS)[number];

/** Qué campos de este comprobante corrigió una persona a mano.
 *
 *  Sale del historial, que `completarAMano` escribe campo por campo. No hace
 *  falta una marca nueva: el rastro ya existe y esto es justamente para lo que
 *  sirve. */
async function corregidosAMano(documentId: string): Promise<Set<string>> {
  const cambios = await db.documentChange.findMany({
    where: { documentId },
    select: { field: true },
  });
  return new Set(cambios.map((c) => c.field));
}

const texto = (v: unknown): string | null =>
  v == null ? null : typeof v === "bigint" ? v.toString() : String(v);

/**
 * Cruza las filas de ARCA contra lo que hay cargado.
 *
 * **La regla cuando hay conflicto**, que es la decisión que ordena todo el
 * archivo: ARCA le gana a una lectura automática —es el registro del fisco—
 * pero **nunca a algo que una persona corrigió mirando el papel**. Esa persona
 * pudo haber visto algo que ARCA no tiene, y pisarla en silencio sería
 * destruir el único trabajo humano que hay en el dato.
 *
 * Lo que no se pisa se cuenta y se muestra. Nada se descarta callado.
 */
export async function importar(
  filas: FilaArca[],
  ctx: { entidadId: string; actor: { id: string; name: string } },
  // `aplicar: false` hace exactamente lo mismo pero **sin escribir**: es la
  // vista previa. Sale del mismo código a propósito — una previa calculada
  // aparte se desincroniza de lo que después pasa de verdad, y entonces es peor
  // que no tenerla: te deja confiar en un número equivocado.
  opciones: { aplicar?: boolean } = {},
): Promise<ResultadoImportacion> {
  const aplicar = opciones.aplicar !== false;
  const res: ResultadoImportacion = {
    filasLeidas: filas.length,
    completadas: 0,
    creadas: 0,
    yaEstaban: 0,
    sinRespaldo: 0,
    discrepancias: [],
    desde: null,
    hasta: null,
  };
  if (filas.length === 0) return res;

  // El período sale de las filas y no de lo que diga nadie: es el único dato
  // que no se puede escribir mal.
  const fechas = filas.map((f) => f.fechaEmision).filter(Boolean).sort();
  res.desde = fechas[0] ?? null;
  res.hasta = fechas[fechas.length - 1] ?? null;

  const vistos: string[] = [];

  for (const fila of filas) {
    const clave = {
      cuitEmisor: fila.cuitEmisor,
      tipoCbte: fila.tipoCbte,
      puntoVenta: fila.puntoVenta,
      numero: fila.numero,
    };
    const existente = await db.document.findUnique({
      where: { cuitEmisor_tipoCbte_puntoVenta_numero: clave },
    });

    if (!existente) {
      res.creadas += 1;
      // En la vista previa no se crea el proveedor tampoco: mirar no puede
      // dejar rastro. Un proveedor dado de alta por una previa que despues se
      // cancela queda ahi para siempre, sin una sola factura.
      if (!aplicar) continue;

      const supplierId = await resolverProveedor(fila.cuitEmisor, fila.denominacion);
      const creado = await db.document.create({
        data: {
          ...clave,
          kind: kindDe(fila.tipoCbte),
          source: "ARCA",
          entidadId: ctx.entidadId,
          supplierId,
          fechaEmision: fila.fechaEmision,
          importeTotal: fila.importeTotal,
          neto: fila.neto ?? null,
          iva: fila.iva ?? null,
          percepciones: fila.percepciones ?? null,
          moneda: fila.moneda ?? "PES",
          cae: fila.cae ?? null,
          enArca: true,
          // Los tres van en NULL: este comprobante no lo capturó nadie. Que
          // `capturedByName` esté vacío es información, no un hueco.
        },
        select: { id: true },
      });
      vistos.push(creado.id);
      continue;
    }

    vistos.push(existente.id);

    const aMano = await corregidosAMano(existente.id);
    const data: Record<string, unknown> = {};
    const cambios: { field: string; before: string | null; after: string | null }[] = [];

    for (const campo of CAMPOS) {
      const nuevo = valorDe(fila, campo);
      if (nuevo == null) continue; // ARCA no lo trae para esta fila
      const actual = (existente as unknown as Record<string, unknown>)[campo];
      if (texto(actual) === texto(nuevo)) continue; // ya coincide

      if (actual != null && aMano.has(campo)) {
        // Una persona lo corrigió. No se pisa: se cuenta.
        res.discrepancias.push({
          documentId: existente.id,
          campo,
          loCargado: texto(actual),
          segunArca: texto(nuevo),
        });
        continue;
      }

      data[campo] = nuevo;
      cambios.push({ field: campo, before: texto(actual), after: texto(nuevo) });
    }

    // `enArca` se marca aunque no cambie ningún otro campo: saber que el fisco
    // la conoce ES el resultado de la importación.
    if (cambios.length > 0) res.completadas += 1;
    else res.yaEstaban += 1;

    const yaEstaba = existente.enArca === true;
    if (aplicar && (Object.keys(data).length > 0 || !yaEstaba)) {
      await db.$transaction([
        db.document.update({
          where: { id: existente.id },
          data: { ...data, enArca: true },
        }),
        ...(cambios.length > 0
          ? [
              db.documentChange.createMany({
                data: cambios.map((c) => ({
                  documentId: existente.id,
                  actorId: ctx.actor.id,
                  actorName: `${ctx.actor.name} (importación de ARCA)`,
                  ...c,
                })),
              }),
            ]
          : []),
      ]);
    }
  }

  // Lo que tenemos y ARCA no conoce, DENTRO del período importado.
  //
  // El recorte por período no es un detalle: sin él, importar agosto marcaría
  // como "no está en ARCA" a todas las facturas de julio, que simplemente no
  // venían en ese archivo. Sería una alarma masiva y falsa.
  if (res.desde && res.hasta) {
    const alcance = {
      deletedAt: null,
      entidadId: ctx.entidadId,
      kind: { in: [...FISCALES] },
      fechaEmision: { gte: res.desde, lte: res.hasta },
      id: { notIn: vistos },
    };
    res.sinRespaldo = aplicar
      ? (await db.document.updateMany({ where: alcance, data: { enArca: false } })).count
      : await db.document.count({ where: alcance });
  }

  return res;
}

/** De qué tipo de comprobante se trata, para el `kind` de la base. */
function kindDe(tipoCbte: string): string {
  if (tipoCbte.startsWith("NOTA_CREDITO")) return "NOTA_CREDITO";
  if (tipoCbte.startsWith("NOTA_DEBITO")) return "NOTA_DEBITO";
  return "FACTURA";
}

function valorDe(fila: FilaArca, campo: Campo): string | bigint | null {
  switch (campo) {
    case "fechaEmision":
      return fila.fechaEmision || null;
    case "importeTotal":
      return fila.importeTotal;
    case "neto":
      return fila.neto ?? null;
    case "iva":
      return fila.iva ?? null;
    case "percepciones":
      return fila.percepciones ?? null;
    case "moneda":
      return fila.moneda ?? null;
    case "cae":
      return fila.cae ?? null;
  }
}
