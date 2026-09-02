import { formatear } from "@/lib/money";
import { cuitValido } from "./cuit";
import { renglonesCierran } from "./renglones";

// El documento reconstruido: los mismos datos, con el mismo formato siempre.
//
// **Qué es.** Un PDF limpio armado con los datos guardados —no con la foto—:
// emisor, identidad fiscal, la tabla de renglones, los totales, el vencimiento.
// Todos los comprobantes salen igual, así que se leen de un vistazo sin
// reorientarse con cada proveedor.
//
// **Se genera en el momento, no se guarda congelado.** Si mañana alguien corrige
// un importe, el documento sale corregido. Un PDF archivado de hace tres meses
// mostraría el dato viejo y nadie se enteraría — es la misma razón por la que en
// este módulo no hay columna de estado.
//
// **Lo que el documento NO hace:** no lleva el logo del organismo fiscal, ni la
// leyenda de comprobante autorizado, ni el código de barras. Lleva impreso que
// es una reconstrucción, de dónde salió y qué verificaciones cerraron. Es un
// documento de trabajo; el comprobante válido ante terceros **sigue siendo la
// foto del original**, que está a un toque.
//
// La razón no es legal, es práctica: un PDF prolijo se ve más confiable que una
// foto borrosa, y contiene lo que la máquina leyó. Si además pareciera oficial,
// un error de lectura quedaría lavado dentro de algo con aspecto de comprobante
// fiscal, y quien lo mire le va a creer al documento antes que al papel.

/** Lo que este módulo necesita de un comprobante. No es el modelo entero a
 *  propósito: así se puede armar el documento en una prueba sin base. */
export type ComprobanteParaDocumento = {
  kind: string;
  source: string;
  cuitEmisor: string | null;
  tipoCbte: string | null;
  puntoVenta: number | null;
  numero: number | null;
  fechaEmision: string | null;
  vencimiento: string | null;
  importeTotal: bigint | null;
  neto: bigint | null;
  iva: bigint | null;
  percepciones: bigint | null;
  cae: string | null;
  createdAt: Date;
  supplier: { name: string } | null;
  // Lo que anotó quien recibió la mercadería. Hasta ahora lo capturaba el
  // depósito y **no lo veía nadie más**: ni `destino`, ni `faltantesNota`, ni
  // `conforme` aparecían en ninguna pantalla fuera de la propia captura. Si en
  // el depósito marcaron que faltaban cosas, quien paga tiene que saberlo antes
  // de transferir el total.
  destino: string | null;
  destinoNota: string | null;
  conforme: boolean | null;
  faltantesNota: string | null;
  capturedByName: string | null;
};

export type RenglonParaDocumento = {
  orden: number;
  codigo: string | null;
  descripcion: string;
  cantidad: bigint | null; // MILÉSIMAS
  unidad: string | null;
  precioUnitario: bigint | null; // MILÉSIMAS de peso
  subtotal: bigint | null; // CENTAVOS
};

export type DatosDocumento = {
  /** Lo que va arriba de todo, en grande. Dice qué es esto antes que nada. */
  titulo: string;
  encabezado: {
    proveedor: string;
    cuit: string;
    comprobante: string;
    fecha: string;
    vencimiento: string;
  };
  renglones: {
    codigo: string;
    descripcion: string;
    cantidad: string;
    precioUnitario: string;
    subtotal: string;
  }[];
  totales: {
    neto: string;
    iva: string;
    percepciones: string;
    total: string;
    cae: string;
    /** Solo cuando el signo del comprobante no es el obvio. */
    leyendaTotal?: string;
  };
  procedencia: {
    leyenda: string;
    origen: string;
    fecha: string;
    verificado: boolean;
    /** Algo FALLÓ. Va en rojo y arriba de todo. */
    advertencia?: string;
    /** No se pudo verificar, que no es lo mismo. Va en gris, en el pie.
     *
     *  Están separadas porque pintarlas igual sería el mismo error que este
     *  módulo evita en todas partes: `null` no es `false`. Un remito no tiene
     *  aritmética que comprobar, así que TODO remito saldría con un recuadro
     *  rojo — y una alarma que suena siempre deja de ser una alarma. */
    nota?: string;
  };
  /** Lo que pasó cuando llegó la mercadería. `null` si nadie anotó nada. */
  recepcion: {
    linea: string;
    /** Va en rojo y arriba: es un motivo para no transferir el total. */
    alerta?: string;
  } | null;
};

/**
 * De los datos guardados al documento que se imprime.
 *
 * Todo lo que sale de acá es texto ya formateado: el componente de PDF no decide
 * nada, solo dibuja. Así las reglas —qué se muestra, cómo se dice lo que no se
 * verificó— viven en un solo lugar y se prueban sin renderizar nada.
 *
 * **Las verificaciones se recalculan acá, no se leen de ninguna columna.** El
 * plan las recibía como parámetro; guardarlas las dejaría envejecer respecto de
 * los datos, y un documento que dice "verificado" sobre un importe corregido
 * después es peor que uno que no dice nada. Es la misma razón por la que en este
 * módulo no hay columna de estado.
 */
export function armarDatos(
  doc: ComprobanteParaDocumento,
  lines: RenglonParaDocumento[],
): DatosDocumento {
  const controles = verificar(doc, lines);

  return {
    titulo: TITULOS[doc.kind] ?? "COMPROBANTE",
    encabezado: {
      proveedor: doc.supplier?.name ?? "Sin proveedor",
      cuit: conGuiones(doc.cuitEmisor),
      comprobante: numeroCompleto(doc),
      fecha: aDiaLegible(doc.fechaEmision),
      vencimiento: aDiaLegible(doc.vencimiento),
    },
    renglones: [...lines]
      .sort((a, b) => a.orden - b.orden)
      .map((l) => ({
        codigo: l.codigo ?? "",
        descripcion: l.descripcion,
        cantidad: cantidadConUnidad(l.cantidad, l.unidad),
        precioUnitario: l.precioUnitario == null ? "" : conTresDecimales(l.precioUnitario),
        subtotal: l.subtotal == null ? "" : formatear(l.subtotal),
      })),
    totales: {
      neto: opcional(doc.neto),
      iva: opcional(doc.iva),
      percepciones: opcional(doc.percepciones),
      total: opcional(doc.importeTotal),
      cae: doc.cae ?? "",
      leyendaTotal: RESTAN.has(doc.kind)
        ? "Este comprobante RESTA de la deuda con el proveedor."
        : undefined,
    },
    procedencia: procedencia(doc, controles),
    recepcion: recepcion(doc),
  };
}

const DESTINOS: Record<string, string> = {
  COCINA: "Entró a cocina",
  DEPOSITO: "Entró a depósito",
  OTRO: "Otro destino",
};

/**
 * Lo que anotó quien recibió la mercadería.
 *
 * Devuelve `null` cuando no hay nada que contar: una línea que dice "no se sabe"
 * ocupa lugar y no aporta.
 *
 * **`conforme === false` es una alerta, no un dato de color.** Quiere decir que
 * en el depósito faltaba algo de lo que la factura cobra, y es la única razón
 * del sistema para no transferir el total tal como está impreso.
 */
function recepcion(doc: ComprobanteParaDocumento): DatosDocumento["recepcion"] {
  const partes: string[] = [];
  if (doc.destino) partes.push(DESTINOS[doc.destino] ?? doc.destino);
  if (doc.destinoNota) partes.push(doc.destinoNota);
  if (doc.capturedByName) partes.push(`Recibió ${doc.capturedByName}`);
  if (doc.conforme === true) partes.push("Llegó completo");

  const alerta =
    doc.conforme === false
      ? doc.faltantesNota
        ? `En el depósito faltaban cosas: ${doc.faltantesNota}`
        : "En el depósito marcaron que faltaban cosas."
      : undefined;

  if (partes.length === 0 && !alerta) return null;
  return { linea: partes.join(" · "), alerta };
}

// ---------------------------------------------------------------------------
// Las verificaciones
// ---------------------------------------------------------------------------

type Controles = {
  cierraLaCuenta: boolean | null;
  cierranLosRenglones: boolean | null;
  cuitValido: boolean | null;
};

/**
 * Las mismas tres cuentas que hace el lector, ahora sobre lo guardado.
 *
 * Se recalculan cada vez que se abre el documento: si alguien corrigió el total
 * a mano y ya no cierra con el desglose, el documento lo va a decir — que es
 * exactamente lo que hay que saber antes de transferir.
 */
export function verificar(
  doc: ComprobanteParaDocumento,
  lines: RenglonParaDocumento[],
): Controles {
  const { neto, iva, percepciones, importeTotal } = doc;

  const cierraLaCuenta =
    neto != null && iva != null && importeTotal != null
      ? neto + iva + (percepciones ?? 0n) === importeTotal
      : null;

  return {
    cierraLaCuenta,
    cierranLosRenglones: renglonesCierran(neto, lines),
    cuitValido: doc.cuitEmisor ? cuitValido(doc.cuitEmisor) : null,
  };
}

/**
 * El pie que impide que esto se confunda con el original.
 *
 * Va siempre, incluso cuando todo verificó. Un documento que a veces avisa y a
 * veces no enseña a no mirar el aviso.
 */
function procedencia(
  doc: ComprobanteParaDocumento,
  c: Controles,
): DatosDocumento["procedencia"] {
  const fallo: string[] = [];
  if (c.cierraLaCuenta === false) fallo.push("el total no cierra con el desglose");
  if (c.cierranLosRenglones === false) fallo.push("los renglones no suman el neto");
  if (c.cuitValido === false) fallo.push("el CUIT no valida");

  const algoVerificado =
    c.cierraLaCuenta === true || c.cierranLosRenglones === true || c.cuitValido === true;

  return {
    leyenda:
      "Documento reconstruido por el sistema a partir de los datos del comprobante. " +
      "No es el comprobante original ni lo reemplaza.",
    origen: ORIGENES[doc.source] ?? "cargado a mano",
    fecha: aDiaLegible(diaLocal(doc.createdAt)),
    verificado: fallo.length === 0 && algoVerificado,
    advertencia:
      fallo.length > 0
        ? `Atención: ${fallo.join(", ")}. Revisar contra la foto del original.`
        : undefined,
    nota:
      fallo.length === 0 && !algoVerificado
        ? "Sin datos para verificar la aritmética de este comprobante."
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

const TITULOS: Record<string, string> = {
  FACTURA: "DETALLE DE FACTURA",
  REMITO: "DETALLE DE REMITO",
  TICKET: "DETALLE DE TICKET",
  NOTA_CREDITO: "DETALLE DE NOTA DE CRÉDITO",
  NOTA_DEBITO: "DETALLE DE NOTA DE DÉBITO",
  OTRO: "DETALLE DE COMPROBANTE",
};

const ETIQUETAS: Record<string, string> = {
  FACTURA: "FACTURA",
  REMITO: "REMITO",
  TICKET: "TICKET",
  NOTA_CREDITO: "NOTA DE CRÉDITO",
  NOTA_DEBITO: "NOTA DE DÉBITO",
  OTRO: "COMPROBANTE",
};

/** Los tipos cuyo importe RESTA de la deuda. */
const RESTAN = new Set(["NOTA_CREDITO"]);

/** Cómo se resolvió la cabecera. Decirlo es lo contrario de disfrazarse: nombrar
 *  al organismo como PROCEDENCIA es divulgación, no impersonación. */
const ORIGENES: Record<string, string> = {
  ARCA: "importado de ARCA",
  QR: "leído del QR",
  EMPAREJADO: "emparejado con ARCA",
  LECTURA: "leído de la foto",
  MANUAL: "cargado a mano",
};

/** `FACTURA A 0002-00028897`, o solo `REMITO` cuando no hay identidad fiscal. */
function numeroCompleto(doc: ComprobanteParaDocumento): string {
  const etiqueta = ETIQUETAS[doc.kind] ?? "COMPROBANTE";
  if (doc.puntoVenta == null || doc.numero == null) {
    return [etiqueta, doc.tipoCbte].filter(Boolean).join(" ");
  }
  const numero = `${String(doc.puntoVenta).padStart(4, "0")}-${String(doc.numero).padStart(8, "0")}`;
  return [etiqueta, doc.tipoCbte, numero].filter(Boolean).join(" ");
}

function opcional(v: bigint | null): string {
  return v == null ? "" : formatear(v);
}

/** `30718089413` -> `30-71808941-3`. Un CUIT corrido se lee mucho peor. */
function conGuiones(cuit: string | null): string {
  if (!cuit || cuit.length !== 11) return cuit ?? "";
  return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
}

/** `"2026-07-28"` -> `"28/07/2026"`. Solo para mostrar: guardado sigue en ISO. */
function aDiaLegible(dia: string | null): string {
  if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return "";
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}

/** `4400` milésimas + `"KG"` -> `"4,400 KG"`. Sin unidad, sin espacio suelto. */
function cantidadConUnidad(cantidad: bigint | null, unidad: string | null): string {
  if (cantidad == null) return "";
  const n = conTresDecimalesPelado(cantidad);
  return unidad ? `${n} ${unidad}` : n;
}

/** Milésimas a `$ 13.607,240`. Tres decimales porque un precio unitario no es
 *  un importe: se imprime con la precisión con la que se multiplica. */
function conTresDecimales(milesimas: bigint): string {
  return `$ ${conTresDecimalesPelado(milesimas)}`;
}

function conTresDecimalesPelado(milesimas: bigint): string {
  const negativo = milesimas < 0n;
  const abs = negativo ? -milesimas : milesimas;
  const entero = abs / 1000n;
  const resto = (abs % 1000n).toString().padStart(3, "0");
  const conMiles = entero.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}${conMiles},${resto}`;
}

/** El día calendario de una fecha, en la zona de quien la mira. `toISOString`
 *  daría UTC y en Argentina eso corre el día para todo lo de después de las 21. */
function diaLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

