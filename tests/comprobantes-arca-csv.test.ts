import { test } from "node:test";
import assert from "node:assert/strict";
import { leerCsvDeArca, aFechaIso, ErrorDeCsv } from "../lib/comprobantes/arca-csv";

/**
 * Leer el CSV de ARCA.
 *
 * **Este parser está escrito contra un formato NO verificado**: no había un
 * archivo real a mano. Así que lo que se prueba acá no es que lea bien un
 * archivo bueno —eso es lo fácil— sino que **la forma en que puede fallar sea
 * ruidosa y útil**:
 *
 *   - si un nombre de columna no coincide, no importa nada y el error lista las
 *     columnas que sí hay (ese mensaje es lo que destraba el archivo)
 *   - una fila que no se entiende corta todo, con su número de línea
 *
 * El único error que podría entrar sin que nadie lo note es un importe mal
 * interpretado. Por eso los importes pasan por `aCentavos`, y por eso hay
 * pruebas de fechas: un día y un mes cambiados de lugar dan una fecha válida y
 * equivocada.
 */

const ENCABEZADO =
  "Fecha;Tipo de Comprobante;Punto de Venta;Número Desde;Nro. Doc. Emisor;Denominación Emisor;Imp. Neto Gravado;IVA;Imp. Total;Moneda;Cód. Autorización";

const FILA = "03/09/2026;1 - Factura A;6;57875;20135041379;DON ANGEL SRL;631493,48;132613,63;764107,11;PES;75123456789012";

test("lee una fila y la deja lista para importar", () => {
  const filas = leerCsvDeArca(`${ENCABEZADO}\n${FILA}`);
  assert.equal(filas.length, 1);
  const f = filas[0];
  assert.equal(f.cuitEmisor, "20135041379");
  assert.equal(f.tipoCbte, "A");
  assert.equal(f.puntoVenta, 6);
  assert.equal(f.numero, 57875);
  assert.equal(f.fechaEmision, "2026-09-03");
  assert.equal(f.importeTotal, 76410711n);
  assert.equal(f.denominacion, "DON ANGEL SRL");
  assert.equal(f.cae, "75123456789012");
});

test("si falta una columna NO importa nada, y dice cuáles hay", () => {
  // Éste es el caso que importa: el formato no está verificado, así que esto es
  // lo que va a pasar si me equivoqué en un nombre. El mensaje tiene que
  // alcanzar para corregirlo sin adivinar de nuevo.
  const otroEncabezado = "Fecha;Tipo Cbte;Pto Vta;Nro;CUIT;Total";
  try {
    leerCsvDeArca(`${otroEncabezado}\n03/09/2026;1;6;1;20135041379;100,00`);
    assert.fail("importó con un encabezado que no reconoce");
  } catch (e) {
    assert.ok(e instanceof ErrorDeCsv);
    assert.match(e.message, /Tipo de Comprobante/, "no dice qué columna buscaba");
    assert.match(e.message, /"Tipo Cbte"/, "no dice qué columnas hay de verdad");
  }
});

test("una fila mala corta el archivo entero, con el número de línea", () => {
  // Lo decidió el usuario: o entra todo o no entra nada. Así siempre se sabe en
  // qué estado quedó la base.
  const malo = "03/09/2026;1 - Factura A;6;57876;123;OTRO;1,00;0,00;1,00;PES;1";
  try {
    leerCsvDeArca(`${ENCABEZADO}\n${FILA}\n${malo}`);
    assert.fail("importó un archivo con una fila rota");
  } catch (e) {
    assert.ok(e instanceof ErrorDeCsv);
    assert.match(e.message, /Línea 3/);
    assert.match(e.message, /CUIT/);
    assert.match(e.message, /No se importó nada/);
  }
});

test("un importe que no se entiende corta el archivo", () => {
  const malo = "03/09/2026;1 - Factura A;6;57876;20135041379;OTRO;1,00;0,00;NO ES UN NUMERO;PES;1";
  assert.throws(() => leerCsvDeArca(`${ENCABEZADO}\n${malo}`), /importe total/);
});

test("un importe NEGATIVO se rechaza, no se convierte en positivo", () => {
  // Comérselo convertiría -1500 en $1.500 sin que nadie lo note. El signo de un
  // comprobante lo decide su tipo, no el texto del importe.
  const malo = "03/09/2026;1 - Factura A;6;57876;20135041379;OTRO;1,00;0,00;-764107,11;PES;1";
  assert.throws(() => leerCsvDeArca(`${ENCABEZADO}\n${malo}`), /importe total/);
});

test("la denominación con punto y coma adentro no rompe la fila", () => {
  const conComillas = `03/09/2026;1 - Factura A;6;57875;20135041379;"ANGEL; HIJOS SRL";1,00;0,00;100,00;PES;1`;
  const f = leerCsvDeArca(`${ENCABEZADO}\n${conComillas}`)[0];
  assert.equal(f.denominacion, "ANGEL; HIJOS SRL");
  assert.equal(f.importeTotal, 10000n);
});

test("el BOM de Excel no rompe la primera columna", () => {
  // Se cuela en el nombre del primer encabezado y lo hace no coincidir nunca,
  // sin que se vea en pantalla.
  const filas = leerCsvDeArca(`﻿${ENCABEZADO}\n${FILA}`);
  assert.equal(filas.length, 1);
});

test("una nota de crédito se reconoce por su código", () => {
  const nc = "03/09/2026;3 - Nota de Crédito A;6;900;20135041379;OTRO;1,00;0,00;100,00;PES;1";
  assert.equal(leerCsvDeArca(`${ENCABEZADO}\n${nc}`)[0].tipoCbte, "NOTA_CREDITO_A");
});

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

test("DD/MM/AAAA se lee como día y mes, no al revés", () => {
  // `new Date("03/09/2026")` da el 9 de MARZO. Un mes y un día cambiados de
  // lugar no rompen nada visible: dan una fecha válida y equivocada.
  assert.equal(aFechaIso("03/09/2026"), "2026-09-03");
  assert.equal(aFechaIso("31/12/2026"), "2026-12-31");
  assert.equal(aFechaIso("1/2/2026"), "2026-02-01");
});

test("una fecha que no existe se rechaza en vez de correrse", () => {
  // `new Date` convierte el 31 de abril en 1 de mayo, callado.
  assert.equal(aFechaIso("31/04/2026"), null);
  assert.equal(aFechaIso("29/02/2026"), null, "2026 no es bisiesto");
  assert.equal(aFechaIso("29/02/2024"), "2024-02-29", "2024 sí es bisiesto");
  assert.equal(aFechaIso("13/13/2026"), null);
});

test("también acepta AAAA-MM-DD por si el archivo ya viene así", () => {
  assert.equal(aFechaIso("2026-09-03"), "2026-09-03");
  assert.equal(aFechaIso(""), null);
  assert.equal(aFechaIso("cualquier cosa"), null);
});
