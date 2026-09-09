import { test } from "node:test";
import assert from "node:assert/strict";
import { leerCsvDeArca, aFechaIso, ErrorDeCsv } from "../lib/comprobantes/arca-csv";

/**
 * Leer el CSV de ARCA.
 *
 * **Ahora está verificado contra un archivo real** —746 comprobantes recibidos,
 * enero a septiembre de 2026—, y esa verificación encontró cuatro cosas que
 * estaban mal: tres nombres de columna (uno obligatorio), la codificación, dos
 * códigos de comprobante faltantes y filas en dólares. Por eso las de acá abajo
 * ya no son suposiciones: el encabezado, el formato de las celdas y los casos
 * raros salieron del archivo.
 *
 * Lo que se prueba no es que lea bien un archivo bueno —eso es lo fácil— sino
 * que **la forma en que puede fallar sea ruidosa y útil**:
 *
 *   - si un nombre de columna no coincide, no importa nada y el error lista las
 *     columnas que sí hay (ese mensaje es lo que destrabó este archivo)
 *   - una fila que no se entiende corta todo, con su número de línea
 *   - una fila que se entiende pero no entra —otra moneda— se saltea y se
 *     informa, sin arrastrar a las demás
 *
 * El único error que podría entrar sin que nadie lo note es un importe mal
 * interpretado. Por eso los importes pasan por `aCentavos`, y por eso hay
 * pruebas de fechas: un día y un mes cambiados de lugar dan una fecha válida y
 * equivocada.
 */

// Los nombres SON los del export real de ARCA. Antes eran suposiciones y tres
// estaban mal, una de ellas obligatoria.
const ENCABEZADO =
  '"Fecha de Emisión";"Tipo de Comprobante";"Punto de Venta";"Número Desde";"Nro. Doc. Emisor";"Denominación Emisor";"Tipo Cambio";"Moneda";"Imp. Neto Gravado Total";"Total IVA";"Imp. Total";"Cód. Autorización"';

// Y el tipo viene como número pelado, no como "1 - Factura A": otra suposición
// que el archivo real corrigió.
const FILA =
  '"2026-09-03";"1";"6";"57875";"20135041379";"DON ANGEL SRL";"1,00";"$";"631493,48";"132613,63";"764107,11";"75123456789012"';

test("lee una fila y la deja lista para importar", () => {
  const { filas } = leerCsvDeArca(`${ENCABEZADO}\n${FILA}`);
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
  // **Este mensaje es el que destrabó el archivo de verdad.** Tres nombres
  // estaban mal y el error los listó al lado de los verdaderos; corregir la
  // tabla fue todo el trabajo. Si ARCA cambia el export, tiene que volver a
  // alcanzar para eso sin adivinar de nuevo.
  const otroEncabezado = "Fecha;Tipo Cbte;Pto Vta;Nro;CUIT;Total";
  try {
    leerCsvDeArca(`${otroEncabezado}\n03/09/2026;1;6;1;20135041379;100,00`);
    assert.fail("importó con un encabezado que no reconoce");
  } catch (e) {
    assert.ok(e instanceof ErrorDeCsv);
    assert.match(e.message, /Fecha de Emisión/, "no dice qué columna buscaba");
    assert.match(e.message, /"Tipo Cbte"/, "no dice qué columnas hay de verdad");
  }
});

test("una fila mala corta el archivo entero, con el número de línea", () => {
  // Lo decidió el usuario: o entra todo o no entra nada. Así siempre se sabe en
  // qué estado quedó la base.
  const malo = '"2026-09-03";"1";"6";"57876";"123";"OTRO";"1,00";"$";"1,00";"0,00";"1,00";"1"';
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
  const malo = '"2026-09-03";"1";"6";"57876";"20135041379";"OTRO";"1,00";"$";"1,00";"0,00";"NO ES UN NUMERO";"1"';
  assert.throws(() => leerCsvDeArca(`${ENCABEZADO}\n${malo}`), /importe total/);
});

test("un importe NEGATIVO se rechaza, no se convierte en positivo", () => {
  // Comérselo convertiría -1500 en $1.500 sin que nadie lo note. El signo de un
  // comprobante lo decide su tipo, no el texto del importe.
  const malo = '"2026-09-03";"1";"6";"57876";"20135041379";"OTRO";"1,00";"$";"1,00";"0,00";"-764107,11";"1"';
  assert.throws(() => leerCsvDeArca(`${ENCABEZADO}\n${malo}`), /importe total/);
});

test("la denominación con punto y coma adentro no rompe la fila", () => {
  const conComillas = '"2026-09-03";"1";"6";"57875";"20135041379";"ANGEL; HIJOS SRL";"1,00";"$";"1,00";"0,00";"100,00";"1"';
  const f = leerCsvDeArca(`${ENCABEZADO}\n${conComillas}`).filas[0];
  assert.equal(f.denominacion, "ANGEL; HIJOS SRL");
  assert.equal(f.importeTotal, 10000n);
});

test("el BOM de Excel no rompe la primera columna", () => {
  // Se cuela en el nombre del primer encabezado y lo hace no coincidir nunca,
  // sin que se vea en pantalla.
  const { filas } = leerCsvDeArca(`﻿${ENCABEZADO}\n${FILA}`);
  assert.equal(filas.length, 1);
});

test("una nota de crédito se reconoce por su código", () => {
  const nc = '"2026-09-03";"3";"6";"900";"20135041379";"OTRO";"1,00";"$";"1,00";"0,00";"100,00";"1"';
  assert.equal(leerCsvDeArca(`${ENCABEZADO}\n${nc}`).filas[0].tipoCbte, "NOTA_CREDITO_A");
});

// ---------------------------------------------------------------------------
// Lo que apareció en el archivo real
// ---------------------------------------------------------------------------

test("los tipos 63 y 81 entran, no abortan el archivo", () => {
  // Estos dos faltaban en la tabla. En el archivo real son diez filas
  // —liquidaciones del banco y tiques de combustible— y un tipo desconocido
  // corta todo: esas diez impedían importar las 746.
  const liq = '"2026-03-11";"63";"0";"1";"30500010912";"BANCO";"1,00";"$";"100,00";"21,00";"121,00";"1"';
  const tique = '"2026-03-11";"81";"1";"2";"30678155469";"ESTACION";"1,00";"$";"100,00";"21,00";"121,00";"2"';
  const { filas } = leerCsvDeArca(`${ENCABEZADO}\n${liq}\n${tique}`);
  assert.equal(filas.length, 2);
  assert.equal(filas[0].tipoCbte, "LIQUIDACION_A");
  assert.equal(filas[1].tipoCbte, "TIQUE_A");
});

test("una factura en dólares se saltea y se informa; las de pesos entran igual", () => {
  // El archivo real trae tres. No se convierten: el nombre del archivo dice
  // "montos expresados en pesos" y la fila trae Tipo Cambio 1444,50, así que
  // entre las dos lecturas hay un factor de 1444. Meterla como pesos la deja
  // 1444 veces más chica y nadie lo nota.
  const usd = '"2026-05-20";"1";"3";"991";"30716481168";"PROVEEDOR SA";"1444,50";"USD";"1000,00";"210,00";"1210,00";"9"';
  const { filas, salteadas } = leerCsvDeArca(`${ENCABEZADO}\n${FILA}\n${usd}`);
  assert.equal(filas.length, 1, "la de pesos tiene que entrar igual");
  assert.equal(salteadas.length, 1);
  assert.equal(salteadas[0].linea, 3, "sin el número de línea no se puede ir a buscarla");
  assert.match(salteadas[0].motivo, /USD/);
  assert.match(salteadas[0].detalle, /PROVEEDOR SA/, "hay que poder cargarla a mano después");
});

test("la moneda guardada es siempre PES, venga como venga en el archivo", () => {
  // En el export real la columna dice `$`, no `PES`. Lo que se guarda es lo
  // segundo, porque es lo que espera el resto del sistema.
  const { filas } = leerCsvDeArca(`${ENCABEZADO}\n${FILA}`);
  assert.equal(filas[0].moneda, "PES");
});

test("el neto y el IVA entran como centavos, no como texto", () => {
  const { filas } = leerCsvDeArca(`${ENCABEZADO}\n${FILA}`);
  assert.equal(filas[0].neto, 63149348n);
  assert.equal(filas[0].iva, 13261363n);
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
