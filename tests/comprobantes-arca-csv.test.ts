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

test("una factura en dólares se pasa a pesos con la cotización de su fila", () => {
  // El archivo real trae tres. **Lo decidió el usuario**, sabiendo que el dato
  // es ambiguo: el nombre del archivo dice "montos expresados en pesos" y la
  // fila trae Tipo Cambio 1444,50.
  //
  // Lo que se prueba acá es que la cuenta esté bien y que la conversión NO sea
  // silenciosa: este importe no está impreso en ningún papel.
  const usd = '"2026-05-20";"1";"3";"991";"30716481168";"PROVEEDOR SA";"1444,50";"USD";"1000,00";"210,00";"1210,00";"9"';
  const { filas, salteadas, convertidas } = leerCsvDeArca(`${ENCABEZADO}\n${FILA}\n${usd}`);
  assert.equal(salteadas.length, 0);
  assert.equal(filas.length, 2, "entran las dos");

  const c = filas[1];
  // 1210,00 × 1444,50 = 1.747.845,00
  assert.equal(c.importeTotal, 174784500n);
  // El desglose también, o la cuenta del comprobante deja de cerrar.
  assert.equal(c.neto, 144450000n, "1000,00 × 1444,50");
  assert.equal(c.iva, 30334500n, "210,00 × 1444,50");
  assert.equal(c.moneda, "PES", "el número ya está en pesos: decir USD sería mentir");
  assert.equal(c.convertidaDe, "USD 1210,00 × 1444,50", "sin el original no se puede deshacer");

  assert.equal(convertidas.length, 1, "convertir en silencio es lo único que no se puede hacer");
  assert.equal(convertidas[0].linea, 3);
  assert.equal(convertidas[0].emisor, "PROVEEDOR SA");
  assert.equal(convertidas[0].resultado, 174784500n);
});

test("una fila en otra moneda SIN cotización se saltea, no se toma como 1", () => {
  // Multiplicar por uno sería inventar el importe, y quedaría 1444 veces más
  // chico sin que nadie lo note: el número se ve plausible.
  const usd = '"2026-05-20";"1";"3";"991";"30716481168";"PROVEEDOR SA";"";"USD";"1000,00";"210,00";"1210,00";"9"';
  const { filas, salteadas, convertidas } = leerCsvDeArca(`${ENCABEZADO}\n${FILA}\n${usd}`);
  assert.equal(filas.length, 1, "la de pesos tiene que entrar igual");
  assert.equal(convertidas.length, 0);
  assert.equal(salteadas.length, 1);
  assert.equal(salteadas[0].linea, 3, "sin el número de línea no se puede ir a buscarla");
  assert.match(salteadas[0].motivo, /sin cotización/);
  assert.match(salteadas[0].detalle, /PROVEEDOR SA/, "hay que poder cargarla a mano después");
});

test("el corte de fecha deja fuera lo anterior, y dice cuántas", () => {
  // ARCA no trae si una factura ya se pagó. Traer nueve meses hace que la
  // pantalla de pagos cuente como deuda pendiente lo que hace rato se pagó.
  const vieja = '"2026-01-15";"1";"6";"100";"20135041379";"VIEJA SRL";"1,00";"$";"100,00";"21,00";"121,00";"1"';
  const { filas, omitidasPorFecha } = leerCsvDeArca(`${ENCABEZADO}\n${vieja}\n${FILA}`, {
    desde: "2026-08-01",
  });
  assert.equal(filas.length, 1, "solo la del 03/09");
  assert.equal(filas[0].numero, 57875);
  assert.equal(omitidasPorFecha, 1, "sin este número, un corte mal puesto se ve como un archivo corto");
});

test("el corte incluye el día exacto, no lo deja afuera por uno", () => {
  // Un `>` en vez de un `>=` pierde un día entero de facturas y no se nota.
  const { filas } = leerCsvDeArca(`${ENCABEZADO}\n${FILA}`, { desde: "2026-09-03" });
  assert.equal(filas.length, 1);
});

test("sin corte de fecha entra el archivo entero", () => {
  const vieja = '"2026-01-15";"1";"6";"100";"20135041379";"VIEJA SRL";"1,00";"$";"100,00";"21,00";"121,00";"1"';
  const { filas, omitidasPorFecha } = leerCsvDeArca(`${ENCABEZADO}\n${vieja}\n${FILA}`);
  assert.equal(filas.length, 2);
  assert.equal(omitidasPorFecha, 0);
});

test("una fila anterior al corte NO se cuenta como convertida ni como salteada", () => {
  // No se importó: no hay nada que contar sobre ella. Si apareciera igual, la
  // pantalla pediría cargar a mano una factura de enero que nadie quiso traer.
  const usdVieja = '"2026-01-15";"1";"3";"991";"30716481168";"PROVEEDOR SA";"1444,50";"USD";"1000,00";"210,00";"1210,00";"9"';
  const { filas, salteadas, convertidas, omitidasPorFecha } = leerCsvDeArca(
    `${ENCABEZADO}\n${usdVieja}\n${FILA}`,
    { desde: "2026-08-01" },
  );
  assert.equal(filas.length, 1);
  assert.equal(convertidas.length, 0);
  assert.equal(salteadas.length, 0);
  assert.equal(omitidasPorFecha, 1);
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
