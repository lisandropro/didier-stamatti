import { aCentavos, aEscala } from "@/lib/money";
import type { FilaArca } from "./arca";

// Leer el CSV de *Mis Comprobantes → Recibidos*.
//
// **Verificado contra un archivo real** de *Mis Comprobantes → Recibidos*:
// 746 comprobantes de enero a septiembre de 2026. Antes estaba escrito contra
// suposiciones, y de once nombres de columna tres estaban mal —incluida una
// obligatoria— más la codificación. El fallo ruidoso hizo su trabajo: habría
// dicho exactamente qué columnas existían.
//
// Se conserva construido para que la forma en que puede equivocarse sea
// **ruidosa y útil**, no silenciosa:
//
//   - Los nombres de columna se buscan EXACTOS. Si falta uno, no importa nada y
//     el error **lista las columnas que sí encontró**. Ese mensaje es
//     literalmente lo que hace falta para terminar este archivo.
//   - Una fila que no se entiende corta el archivo entero con su número de
//     línea. Nunca se importa a medias: así siempre se sabe en qué estado quedó
//     la base — o entró todo o no entró nada.
//
// Lo que NO se adivina es lo peligroso: los importes pasan por `aCentavos`,
// que ya resuelve la ambigüedad del separador decimal en un solo lugar y
// **rechaza los negativos en vez de comérselos**. Un importe mal interpretado
// es el único error de este archivo que podría entrar sin que nadie lo note.

/** El separador del CSV de ARCA. Es punto y coma, no coma. */
const SEP = ";";

/**
 * Cómo se llama cada cosa en el archivo. Tomados de un export real.
 *
 * Si alguno dejara de coincidir, el error lo dice con los nombres verdaderos al
 * lado y corregir esta tabla es todo el trabajo.
 */
const COLUMNAS = {
  fecha: "Fecha de Emisión",
  tipo: "Tipo de Comprobante",
  puntoVenta: "Punto de Venta",
  numero: "Número Desde",
  cuitEmisor: "Nro. Doc. Emisor",
  denominacion: "Denominación Emisor",
  importeTotal: "Imp. Total",
  neto: "Imp. Neto Gravado Total",
  iva: "Total IVA",
  moneda: "Moneda",
  cae: "Cód. Autorización",
  otrosTributos: "Otros Tributos",
  /** La cotización de la fila. Vale 1,00 en las de pesos y es lo único con lo
   *  que se puede convertir una que no lo esté. */
  tipoCambio: "Tipo Cambio",
} as const;

/** Las que no pueden faltar: sin una de éstas, la fila no identifica un
 *  comprobante ni dice cuánto es. Las demás se completan si están. */
const OBLIGATORIAS = [
  "fecha",
  "tipo",
  "puntoVenta",
  "numero",
  "cuitEmisor",
  "importeTotal",
] as const;

/**
 * Los códigos de comprobante de AFIP.
 *
 * **`63` y `81` faltaban, y esas diez filas abortaban las 746.** En el archivo
 * real aparecen liquidaciones del banco (63) y tiques factura de proveedores de
 * combustible (81): compras y cargos de verdad, no rarezas. Un código
 * desconocido corta el archivo entero, así que la tabla vale la pena completa.
 *
 * Lo que importa de cada entrada no es la etiqueta sino si empieza con
 * `NOTA_CREDITO`: de eso depende que el importe RESTE del saldo.
 */
const TIPOS: Record<number, string> = {
  1: "A", 2: "NOTA_DEBITO_A", 3: "NOTA_CREDITO_A",
  6: "B", 7: "NOTA_DEBITO_B", 8: "NOTA_CREDITO_B",
  11: "C", 12: "NOTA_DEBITO_C", 13: "NOTA_CREDITO_C",
  51: "M", 52: "NOTA_DEBITO_M", 53: "NOTA_CREDITO_M",
  // Liquidaciones: el banco las emite por sus comisiones.
  63: "LIQUIDACION_A", 64: "LIQUIDACION_B",
  // Tique factura: controlador fiscal. Combustible, peajes.
  81: "TIQUE_A", 82: "TIQUE_B", 83: "TIQUE",
  // Factura de crédito electrónica MiPyME.
  201: "A", 202: "NOTA_DEBITO_A", 203: "NOTA_CREDITO_A",
  206: "B", 207: "NOTA_DEBITO_B", 208: "NOTA_CREDITO_B",
  211: "C", 212: "NOTA_DEBITO_C", 213: "NOTA_CREDITO_C",
};

/** La moneda que el sistema acepta. En el archivo real vienen como `$`. */
const PESOS = new Set(["$", "PES", "ARS", ""]);

export class ErrorDeCsv extends Error {}

/**
 * Convierte el texto del CSV en filas.
 *
 * Tira `ErrorDeCsv` con un mensaje que se pueda leer sin abrir el código: es lo
 * único que va a ver quien suba un archivo que no se entiende.
 */
/** Una fila que se entiende pero que NO entra, con el motivo. */
export type Salteada = { linea: number; motivo: string; detalle: string };

/** Una fila que venía en otra moneda y se pasó a pesos con la cotización que
 *  trae el propio archivo. Se informa entera: es el único importe del sistema
 *  que no está impreso en ningún papel. */
export type Convertida = {
  linea: number;
  emisor: string;
  fecha: string;
  original: string;
  cotizacion: string;
  /** Ya en centavos de peso. */
  resultado: bigint;
};

export type LecturaDeCsv = {
  filas: FilaArca[];
  salteadas: Salteada[];
  convertidas: Convertida[];
  /** Cuántas filas quedaron fuera por el corte de fecha. Se informa: si no, un
   *  corte mal puesto se ve igual que un archivo corto. */
  omitidasPorFecha: number;
};

/**
 * Convierte el texto del CSV en filas.
 *
 * Tira `ErrorDeCsv` con un mensaje que se pueda leer sin abrir el código: es lo
 * único que va a ver quien suba un archivo que no se entiende.
 *
 * **Saltear no es lo mismo que fallar.** Una fila que no se ENTIENDE corta el
 * archivo entero, como se decidió: o entra todo o no entra nada, así siempre se
 * sabe en qué estado quedó la base. Una fila que se entiende perfectamente pero
 * que el sistema no acepta —una factura en dólares— es otra cosa: se saltea,
 * se informa, y las demás entran.
 */
export function leerCsvDeArca(
  texto: string,
  // **El corte de fecha existe por una razón concreta.** ARCA no dice si una
  // factura ya se pagó, así que traer nueve meses hace que la pantalla de
  // pagos cuente como deuda pendiente lo que hace rato se pagó. Cortar por
  // fecha de emisión deja entrar lo que de verdad está en juego.
  //
  // Se filtra ACÁ y no después a propósito: una fila anterior al corte no
  // tiene que aparecer tampoco como salteada ni como convertida — no se
  // importó, no hay nada que contar sobre ella.
  opciones: { desde?: string | null } = {},
): LecturaDeCsv {
  // El BOM que mete Excel se cuela en el nombre de la primera columna y la hace
  // no coincidir nunca, sin que se vea en pantalla.
  const limpio = texto.replace(/^﻿/, "");
  const lineas = limpio.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lineas.length === 0) throw new ErrorDeCsv("El archivo está vacío.");

  const encabezados = partir(lineas[0]);
  const indice = new Map(encabezados.map((h, i) => [h.trim(), i]));

  const faltan = OBLIGATORIAS.filter((k) => !indice.has(COLUMNAS[k]));
  if (faltan.length > 0) {
    // **Este mensaje es el que destraba el archivo.** Dice qué se buscaba y qué
    // hay de verdad, así corregir la tabla de columnas es inmediato.
    throw new ErrorDeCsv(
      `No encontré ${faltan.length === 1 ? "la columna" : "las columnas"} ` +
        `${faltan.map((k) => `"${COLUMNAS[k]}"`).join(", ")}. ` +
        `El archivo tiene estas: ${encabezados.map((h) => `"${h.trim()}"`).join(", ")}.`,
    );
  }

  const dato = (celdas: string[], k: keyof typeof COLUMNAS): string => {
    const i = indice.get(COLUMNAS[k]);
    return i === undefined ? "" : (celdas[i] ?? "").trim();
  };

  const desde = opciones.desde || null;
  const filas: FilaArca[] = [];
  const salteadas: Salteada[] = [];
  const convertidas: Convertida[] = [];
  let omitidasPorFecha = 0;
  for (let n = 1; n < lineas.length; n++) {
    // El número que se muestra es el de la línea del archivo, contando el
    // encabezado: es lo que se ve al abrirlo en el Bloc de notas.
    const linea = n + 1;
    const celdas = partir(lineas[n]);
    const mal = (que: string) => new ErrorDeCsv(`Línea ${linea}: ${que}. No se importó nada.`);

    const cuitEmisor = dato(celdas, "cuitEmisor").replace(/\D/g, "");
    if (cuitEmisor.length !== 11) throw mal(`el CUIT del emisor no tiene 11 dígitos ("${dato(celdas, "cuitEmisor")}")`);

    const codigo = Number(dato(celdas, "tipo").match(/\d+/)?.[0]);
    const tipoCbte = TIPOS[codigo];
    if (!tipoCbte) throw mal(`no reconozco el tipo de comprobante ("${dato(celdas, "tipo")}")`);

    const puntoVenta = Number(dato(celdas, "puntoVenta").replace(/\D/g, ""));
    const numero = Number(dato(celdas, "numero").replace(/\D/g, ""));
    if (!Number.isFinite(puntoVenta) || !Number.isFinite(numero) || numero === 0) {
      throw mal("el punto de venta o el número no son válidos");
    }

    const fechaEmision = aFechaIso(dato(celdas, "fecha"));
    if (!fechaEmision) throw mal(`la fecha no se entiende ("${dato(celdas, "fecha")}")`);

    // Las dos fechas son "AAAA-MM-DD", así que comparar como texto es comparar
    // como fecha. No hay `Date` de por medio y por lo tanto no hay zona horaria
    // que corra un comprobante un día.
    if (desde && fechaEmision < desde) {
      omitidasPorFecha += 1;
      continue;
    }

    // `aCentavos` resuelve el separador decimal y rechaza los negativos. Un
    // importe que no se entiende corta el archivo: es el dato por el que existe
    // todo esto.
    const importeTotal = aCentavos(dato(celdas, "importeTotal"));
    if (importeTotal == null) throw mal(`el importe total no se entiende ("${dato(celdas, "importeTotal")}")`);

    let neto = aCentavos(dato(celdas, "neto")) ?? undefined;
    let iva = aCentavos(dato(celdas, "iva")) ?? undefined;
    let total = importeTotal;
    let convertidaDe: string | undefined;

    // **Una factura en otra moneda se pasa a pesos con la cotización de su
    // propia fila, y se informa.**
    //
    // El archivo real trae tres en dólares con `Tipo Cambio` 1444,50, mientras
    // las de pesos traen 1,00. El dato es ambiguo: el nombre del archivo dice
    // "montos expresados en pesos" y la fila dice lo contrario, y entre las dos
    // lecturas hay un factor de 1444. **Lo decidió el usuario**, sabiendo eso.
    //
    // Lo que no se hace es convertir en silencio. El importe resultante es el
    // único de todo el sistema que no está impreso en ningún papel, así que
    // sale listado en pantalla con el original al lado y queda anotado en el
    // historial del comprobante. Si la lectura era la otra, se puede encontrar
    // y deshacer.
    const moneda = dato(celdas, "moneda");
    if (!PESOS.has(moneda.toUpperCase())) {
      // Diezmilésimas: una cotización se imprime con cuatro decimales y
      // redondearla antes de multiplicar mueve el importe.
      const cotizacion = aEscala(dato(celdas, "tipoCambio"), 4, { puntoEsDecimal: true });
      if (cotizacion == null || cotizacion <= 0n) {
        // Sin cotización no hay conversión posible, y multiplicar por 1 sería
        // inventar. Ésta sí se saltea.
        salteadas.push({
          linea,
          motivo: `en ${moneda}, sin cotización`,
          detalle: `${dato(celdas, "denominacion")} · ${fechaEmision} · ${dato(celdas, "importeTotal")} ${moneda}`,
        });
        continue;
      }
      const aPesos = (v: bigint) => (v * cotizacion + 5000n) / 10000n;
      convertidaDe = `${moneda} ${dato(celdas, "importeTotal")} × ${dato(celdas, "tipoCambio")}`;
      total = aPesos(importeTotal);
      if (neto != null) neto = aPesos(neto);
      if (iva != null) iva = aPesos(iva);
      convertidas.push({
        linea,
        emisor: dato(celdas, "denominacion"),
        fecha: fechaEmision,
        original: `${dato(celdas, "importeTotal")} ${moneda}`,
        cotizacion: dato(celdas, "tipoCambio"),
        resultado: total,
      });
    }

    filas.push({
      cuitEmisor,
      denominacion: dato(celdas, "denominacion") || undefined,
      tipoCbte,
      puntoVenta,
      numero,
      fechaEmision,
      importeTotal: total,
      neto,
      iva,
      // Ya está en pesos: guardar la moneda original diría que el número es una
      // cosa que no es. El origen vive en `convertidaDe`, que es texto para
      // leer y no se confunde con un importe.
      moneda: "PES",
      cae: dato(celdas, "cae").replace(/\D/g, "") || undefined,
      convertidaDe,
    });
  }

  return { filas, salteadas, convertidas, omitidasPorFecha };
}

/** Parte una línea por `;`, respetando las comillas: la denominación de un
 *  emisor puede traer punto y coma adentro. */
function partir(linea: string): string[] {
  const celdas: string[] = [];
  let actual = "";
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      // Dos comillas seguidas adentro de un campo son una comilla literal.
      if (entreComillas && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else {
        entreComillas = !entreComillas;
      }
    } else if (c === SEP && !entreComillas) {
      celdas.push(actual);
      actual = "";
    } else {
      actual += c;
    }
  }
  celdas.push(actual);
  return celdas;
}

/**
 * `DD/MM/AAAA` o `AAAA-MM-DD` a `AAAA-MM-DD`.
 *
 * **No usa `new Date()`**, y eso es deliberado: `new Date("03/09/2026")` lo
 * interpreta como el 9 de marzo, no el 3 de septiembre. Un mes y un día
 * cambiados de lugar no rompen nada visible — dan una fecha válida y
 * equivocada, que es la peor forma de estar mal.
 */
export function aFechaIso(texto: string): string | null {
  const t = (texto ?? "").trim();

  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return valida(+iso[1], +iso[2], +iso[3]) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;

  const dmy = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [d, m, a] = [+dmy[1], +dmy[2], +dmy[3]];
    if (!valida(a, m, d)) return null;
    return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  return null;
}

function valida(a: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Un 31 de abril no existe, y `new Date` lo convertiría en 1 de mayo en
  // silencio. Acá se rechaza.
  const dias = [31, bisiesto(a) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= dias[m - 1];
}

const bisiesto = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
