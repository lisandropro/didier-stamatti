import { aCentavos } from "@/lib/money";
import type { FilaArca } from "./arca";

// Leer el CSV de *Mis Comprobantes → Recibidos*.
//
// **Este archivo está escrito CONTRA UN FORMATO NO VERIFICADO.** Al momento de
// escribirlo no había un CSV real de ARCA a mano. Por eso está construido para
// que la forma en que puede equivocarse sea **ruidosa y útil**, no silenciosa:
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
 * Cómo se llama cada cosa en el archivo.
 *
 * **Sin verificar contra un archivo real.** Si alguno no coincide, el error lo
 * dice con los nombres verdaderos al lado y corregir esta tabla es todo el
 * trabajo que queda.
 */
const COLUMNAS = {
  fecha: "Fecha",
  tipo: "Tipo de Comprobante",
  puntoVenta: "Punto de Venta",
  numero: "Número Desde",
  cuitEmisor: "Nro. Doc. Emisor",
  denominacion: "Denominación Emisor",
  importeTotal: "Imp. Total",
  neto: "Imp. Neto Gravado",
  iva: "IVA",
  moneda: "Moneda",
  cae: "Cód. Autorización",
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

/** Los códigos de comprobante de AFIP. Mismo vocabulario que el lector de QR. */
const TIPOS: Record<number, string> = {
  1: "A", 2: "NOTA_DEBITO_A", 3: "NOTA_CREDITO_A",
  6: "B", 7: "NOTA_DEBITO_B", 8: "NOTA_CREDITO_B",
  11: "C", 12: "NOTA_DEBITO_C", 13: "NOTA_CREDITO_C",
  51: "M", 201: "A", 206: "B", 211: "C",
};

export class ErrorDeCsv extends Error {}

/**
 * Convierte el texto del CSV en filas.
 *
 * Tira `ErrorDeCsv` con un mensaje que se pueda leer sin abrir el código: es lo
 * único que va a ver quien suba un archivo que no se entiende.
 */
export function leerCsvDeArca(texto: string): FilaArca[] {
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

  const filas: FilaArca[] = [];
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

    // `aCentavos` resuelve el separador decimal y rechaza los negativos. Un
    // importe que no se entiende corta el archivo: es el dato por el que existe
    // todo esto.
    const importeTotal = aCentavos(dato(celdas, "importeTotal"));
    if (importeTotal == null) throw mal(`el importe total no se entiende ("${dato(celdas, "importeTotal")}")`);

    filas.push({
      cuitEmisor,
      denominacion: dato(celdas, "denominacion") || undefined,
      tipoCbte,
      puntoVenta,
      numero,
      fechaEmision,
      importeTotal,
      neto: aCentavos(dato(celdas, "neto")) ?? undefined,
      iva: aCentavos(dato(celdas, "iva")) ?? undefined,
      moneda: dato(celdas, "moneda") || undefined,
      cae: dato(celdas, "cae").replace(/\D/g, "") || undefined,
    });
  }

  return filas;
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
