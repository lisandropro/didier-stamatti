import { test } from "node:test";
import assert from "node:assert/strict";
import { leerQr, elegirQrDeFactura, esParaNosotros } from "../lib/comprobantes/qr";
import { QR_MUESTRAS, QR_QUE_NO_SON_FACTURA } from "./fixtures/qr-muestras";

/**
 * El QR de la RG 4892. La regla que ordena esta unidad salió de mirar
 * comprobantes reales: **el emisor no siempre genera JSON válido**, así que el
 * lector extrae campo por campo en vez de parsear.
 *
 * Cada caso de acá es una factura que llegó al depósito de verdad.
 */

const porNombre = (n: string) => QR_MUESTRAS.find((m) => m.nombre === n)!.url;

test("lee un QR bien formado", () => {
  const c = leerQr(porNombre("sano"));
  assert.ok(c);
  assert.equal(c.cuitEmisor, "20999999993");
  assert.equal(c.tipoCbte, "A");
  assert.equal(c.puntoVenta, 6);
  assert.equal(c.numero, 57875);
  assert.equal(c.fechaEmision, "2026-08-27");
  assert.equal(c.importeTotal, 76410711n);
  assert.equal(c.cae, "86350106990468");
  assert.equal(c.fuente, "QR");
});

test("un CRLF al final no lo rompe", () => {
  const c = leerQr(porNombre("sanoConSaltoDeLinea"));
  assert.equal(c?.numero, 38604);
  assert.equal(c?.importeTotal, 31000001n);
});

test("lee el que tiene ceros a la izquierda, que NO es JSON válido", () => {
  const c = leerQr(porNombre("cerosALaIzquierda"));
  assert.ok(c, "este payload rompe JSON.parse: el lector no puede depender de él");
  assert.equal(c.tipoCbte, "A"); // venía "01"
  assert.equal(c.numero, 46293); // venía "00046293"
  assert.equal(c.puntoVenta, 4552);
  assert.equal(c.importeTotal, 505020217n);
});

test("lee lo que puede del que viene sin comillas y con guiones", () => {
  const c = leerQr(porNombre("sinComillasNiNumero"));
  assert.ok(c);
  assert.equal(c.cuitEmisor, "9062901503"); // venía "906-290150-3"
  assert.equal(c.fechaEmision, "2026-08-11"); // venía "11-08-2026"
  assert.equal(c.importeTotal, 38712451n);
  // No trae nroCmp: no se inventa. Sin número no hay identidad, y el
  // comprobante va a caer en el peldaño de completar a mano.
  assert.equal(c.numero, undefined);
});

test("el importe no pasa nunca por el flotante", () => {
  // "387124.5100000000000000" — 16 decimales. Multiplicar por 100 en flotante
  // es exactamente donde se pierden centavos.
  assert.equal(leerQr(porNombre("sinComillasNiNumero"))?.importeTotal, 38712451n);
});

test("de varios QR en la misma foto elige el de factura", () => {
  const enLaFoto = [...QR_QUE_NO_SON_FACTURA, porNombre("sano")];
  assert.equal(elegirQrDeFactura(enLaFoto), porNombre("sano"));
  // El de Data Fiscal es de afip.gob.ar y NO es una factura: no alcanza con
  // mirar el dominio.
  assert.equal(elegirQrDeFactura(QR_QUE_NO_SON_FACTURA), null);
});

test("no acepta cualquier cosa que traiga la cámara", () => {
  assert.equal(leerQr(""), null);
  assert.equal(leerQr("https://ejemplo.com"), null);
  assert.equal(leerQr("https://www.afip.gob.ar/fe/qr/?p=no-es-base64!!"), null);
  for (const otro of QR_QUE_NO_SON_FACTURA) assert.equal(leerQr(otro), null);
});

test("avisa cuando la factura no está a nombre de la empresa", () => {
  // Los cinco QR reales traen nroDocRec con el CUIT propio. Es un control
  // gratis contra fotografiar la factura de otro.
  assert.equal(esParaNosotros(leerQr(porNombre("sano"))!), true);
  assert.equal(esParaNosotros({ fuente: "QR", cuitReceptor: "20111111112" }), false);
  // Sin dato no se afirma nada: null no es false.
  assert.equal(esParaNosotros({ fuente: "MANUAL" }), null);
});
