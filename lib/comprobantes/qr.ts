import { aCentavos } from "@/lib/money";
import type { Cabecera } from "./tipos";

// El QR de la RG 4892/2020: una URL de AFIP con un JSON en base64.
//
// **No se usa `JSON.parse`, y no es por gusto.** De cinco QR sacados de
// comprobantes reales, dos no son JSON válido: uno trae ceros a la izquierda
// (`"tipoCmp":01`) y otro viene sin comillas, con el CUIT separado por guiones
// y la fecha al revés. Un lector estricto los descarta a los dos, y son casi la
// mitad de los que llegan.
//
// Por eso se extrae campo por campo, tolerando lo que el emisor haya impreso.
// Los casos están en `tests/fixtures/qr-muestras.ts`, anonimizados pero con las
// patologías exactas.

/** El CUIT de la empresa. Aparece como `nroDocRec` en todas las facturas que le
 *  emiten, y con eso se puede avisar si alguien fotografió la de otro. */
export const CUIT_PROPIO = "30717737489";

const TIPOS: Record<number, string> = {
  1: "A",
  2: "NOTA_DEBITO_A",
  3: "NOTA_CREDITO_A",
  6: "B",
  7: "NOTA_DEBITO_B",
  8: "NOTA_CREDITO_B",
  11: "C",
  12: "NOTA_DEBITO_C",
  13: "NOTA_CREDITO_C",
  51: "M",
  201: "A",
  206: "B",
  211: "C",
};

/**
 * De todos los QR que la cámara vio en una foto, cuál es el de la factura.
 *
 * Una foto trae varios: el de AFIP, uno de marketing del proveedor, y a veces
 * el de Data Fiscal —que también es de `afip.gob.ar` pero NO identifica un
 * comprobante—. No alcanza con mirar el dominio.
 */
export function elegirQrDeFactura(textos: string[]): string | null {
  return textos.find((t) => payloadDe(t) !== null) ?? null;
}

export function leerQr(texto: string): Cabecera | null {
  const payload = payloadDe(texto);
  if (payload === null) return null;

  let crudo: string;
  try {
    // `atob` y no `Buffer`: así este módulo también corre en el navegador, y la
    // pantalla de captura puede descartar los QR que no son de factura sin ir
    // al servidor. El payload es ASCII —números y códigos—, así que no hace
    // falta decodificar UTF-8.
    crudo = atob(payload).trim();
  } catch {
    return null;
  }
  if (!crudo.includes("cuit")) return null;

  const cuit = soloDigitos(campo(crudo, "cuit"));
  const ptoVta = aEntero(campo(crudo, "ptoVta"));
  const tipoCmp = aEntero(campo(crudo, "tipoCmp"));
  // Hay QR reales SIN nroCmp. No se inventa: sin número no hay identidad y el
  // comprobante cae en el peldaño de completar a mano.
  const nroCmp = aEntero(campo(crudo, "nroCmp"));
  const fecha = aFechaIso(campo(crudo, "fecha"));

  if (!cuit || ptoVta === null || tipoCmp === null) return null;

  return {
    fuente: "QR",
    cuitEmisor: cuit,
    cuitReceptor: soloDigitos(campo(crudo, "nroDocRec")) || undefined,
    tipoCbte: TIPOS[tipoCmp] ?? String(tipoCmp),
    puntoVenta: ptoVta,
    numero: nroCmp ?? undefined,
    fechaEmision: fecha ?? undefined,
    // El payload es de máquina: acá el punto SIEMPRE es decimal.
    importeTotal: aCentavos(campo(crudo, "importe") ?? "", { puntoEsDecimal: true }) ?? undefined,
    cae: soloDigitos(campo(crudo, "codAut")) || undefined,
  };
}

/** `true` si la factura está a nombre de la empresa, `false` si es de otra,
 *  `null` si el comprobante no lo dice. Null no es false: no saber y saber que
 *  no, son cosas distintas. */
export function esParaNosotros(c: Cabecera): boolean | null {
  if (!c.cuitReceptor) return null;
  return c.cuitReceptor === CUIT_PROPIO;
}

// --- ayudas privadas -------------------------------------------------------

/** El parámetro `p` de una URL de QR **de factura**. El de Data Fiscal usa otro
 *  host y otro parámetro, así que queda descartado acá mismo. */
function payloadDe(texto: string): string | null {
  if (typeof texto !== "string" || !texto) return null;
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }
  if (url.hostname !== "www.afip.gob.ar" && url.hostname !== "afip.gob.ar") return null;
  if (!url.pathname.startsWith("/fe/qr")) return null;
  const p = url.searchParams.get("p");
  if (!p || !/^[A-Za-z0-9+/=_-]+$/.test(p)) return null;
  return p.replace(/-/g, "+").replace(/_/g, "/");
}

/**
 * El valor crudo de un campo, del TEXTO y no de un objeto parseado.
 *
 * Sirve igual para `"cuit":30597532381`, `"cuit":906-290150-3` y
 * `"moneda":"PES"`. Y el importe sale de acá sin pasar por un flotante, que es
 * donde se pierden los centavos.
 */
function campo(json: string, nombre: string): string | null {
  const m = new RegExp(`"${nombre}"\\s*:\\s*"?([^",}\\s]*)"?`).exec(json);
  return m ? m[1] : null;
}

function soloDigitos(v: string | null): string {
  return v ? v.replace(/\D/g, "") : "";
}

function aEntero(v: string | null): number | null {
  const d = soloDigitos(v);
  return d === "" ? null : Number(d);
}

/** Acepta `"2026-08-27"` y también `11-08-2026`, que es como lo imprime al
 *  menos un emisor. Devuelve siempre `AAAA-MM-DD`. */
function aFechaIso(v: string | null): string | null {
  if (!v) return null;
  let a: string, m: string, d: string;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const criollo = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v);
  if (iso) [, a, m, d] = iso;
  else if (criollo) [, d, m, a] = criollo;
  else return null;

  const f = new Date(Date.UTC(+a, +m - 1, +d));
  if (f.getUTCFullYear() !== +a || f.getUTCMonth() !== +m - 1 || f.getUTCDate() !== +d) return null;
  return `${a}-${m}-${d}`;
}
