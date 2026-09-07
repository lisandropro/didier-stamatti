import { test } from "node:test";
import assert from "node:assert/strict";
import { armarDatos } from "../lib/comprobantes/documento";

/**
 * El documento reconstruido: mismos datos, formato uniforme.
 *
 * Lo que se protege acá es que **no se disfrace del original**. Un PDF prolijo
 * se ve más confiable que una foto borrosa, y contiene lo que la máquina leyó.
 * Si además pareciera un comprobante autorizado, un error de lectura quedaría
 * lavado dentro de algo con aspecto oficial — y quien lo mire va a creerle al
 * documento antes que al papel arrugado del que salió.
 */

const DOC = {
  id: "d1",
  kind: "FACTURA",
  source: "LECTURA",
  cuitEmisor: "30718089413",
  tipoCbte: "A",
  puntoVenta: 2,
  numero: 28897,
  fechaEmision: "2026-07-28",
  importeTotal: 77286775n,
  neto: 63873368n,
  iva: 13413407n,
  percepciones: 0n,
  cae: "86305704041463",
  caeVence: "2026-08-07",
  vencimiento: "2026-08-04",
  createdAt: new Date("2026-09-01T12:00:00"),
  destino: "DEPOSITO",
  destinoNota: null,
  conforme: true,
  faltantesNota: null,
  capturedByName: "Pablo",
  supplier: { name: "DINAMARK SRL" },
};

// Dos renglones que SUMAN el neto. No es un detalle del fixture: la
// verificación de renglones compara la suma contra el neto impreso, así que un
// fixture con un renglón suelto de una factura de siete daría "no cierra" y
// estaría bien que lo diera.
const RENGLONES = [
  {
    orden: 1,
    codigo: "1096",
    descripcion: "QUESO HOLANDA HORMA TREGAR",
    cantidad: 4400n, // 4,400 KG
    unidad: "KG",
    precioUnitario: 13607240n, // MILÉSIMAS: $13.607,240
    subtotal: 5987186n, // CENTAVOS: $59.871,86
  },
  {
    orden: 2,
    codigo: "1102",
    descripcion: "QUESO CREMOSO BARRA",
    cantidad: 42500n, // 42,500 KG
    unidad: "KG",
    precioUnitario: 13620278n, // MILÉSIMAS: $13.620,278
    subtotal: 57886182n, // CENTAVOS: $578.861,82
  },
];

test("arma el encabezado con la identidad fiscal completa", () => {
  const d = armarDatos(DOC, RENGLONES);
  assert.equal(d.encabezado.proveedor, "DINAMARK SRL");
  assert.equal(d.encabezado.cuit, "30-71808941-3"); // con guiones, para leerlo
  assert.equal(d.encabezado.comprobante, "FACTURA A 0002-00028897");
  assert.equal(d.encabezado.fecha, "28/07/2026");
  assert.equal(d.encabezado.vencimiento, "04/08/2026");
});

test("los importes salen formateados, nunca en centavos crudos", () => {
  const d = armarDatos(DOC, RENGLONES);
  assert.equal(d.renglones[0].cantidad, "4,400 KG");
  assert.equal(d.renglones[0].precioUnitario, "$ 13.607,240");
  assert.equal(d.renglones[0].subtotal, "$ 59.871,86");
  assert.equal(d.totales.total, "$ 772.867,75");
  assert.equal(d.totales.neto, "$ 638.733,68");
  assert.equal(d.totales.iva, "$ 134.134,07");
});

test("dice que es una reconstrucción y de dónde salió", () => {
  const d = armarDatos(DOC, RENGLONES);
  assert.match(d.procedencia.leyenda, /reconstru/i);
  assert.match(d.procedencia.leyenda, /no es el comprobante/i);
  assert.equal(d.procedencia.origen, "leído de la foto");
  assert.equal(d.procedencia.fecha, "01/09/2026");
});

test("no lleva nada que lo haga pasar por el comprobante autorizado", () => {
  const d = armarDatos(DOC, RENGLONES);
  // Se revisa SOLO el texto que escribe el sistema. El nombre del proveedor es
  // un dato del papel, no una decisión nuestra: un proveedor llamado
  // "LA MARCA SRL" contiene "arca" y no tiene nada que ver.
  const nuestro = [
    d.procedencia.leyenda,
    d.procedencia.origen,
    d.procedencia.advertencia ?? "",
    d.encabezado.comprobante,
    d.titulo,
  ]
    .join(" ")
    .toLowerCase();
  for (const prohibido of ["arca", "afip", "comprobante autorizado", "código de barras"]) {
    assert.ok(!nuestro.includes(prohibido), `no debería aparecer "${prohibido}"`);
  }
  // El CAE sí va: es un dato de la factura y sirve para buscarla. Lo que no va
  // es la presentación que lo hace parecer autorizado.
  assert.equal(d.totales.cae, "86305704041463");
});

test("el vencimiento del CAE no se imprime nunca", () => {
  // Ya se confundió una vez con el vencimiento del pago (Bitácora del 03/08).
  // En un documento que alguien usa para decidir cuándo transferir, dos fechas
  // parecidas al lado son una invitación al error.
  const d = armarDatos(DOC, RENGLONES);
  assert.ok(!JSON.stringify(d).includes("2026-08-07"));
  assert.ok(!JSON.stringify(d).includes("07/08/2026"));
});

// ---------------------------------------------------------------------------
// Las verificaciones se RECALCULAN, no se guardan
// ---------------------------------------------------------------------------

test("cuando la aritmética cierra, el documento lo dice", () => {
  const d = armarDatos(DOC, RENGLONES);
  assert.equal(d.procedencia.verificado, true);
  assert.equal(d.procedencia.advertencia, undefined);
});

test("cuando la aritmética NO cierra, el documento avisa", () => {
  // 638.733,68 + 134.134,07 = 772.867,75. Se cambia el total por un peso.
  const d = armarDatos({ ...DOC, importeTotal: 77286875n }, RENGLONES);
  assert.equal(d.procedencia.verificado, false);
  assert.match(d.procedencia.advertencia ?? "", /no cierra/i);
});

test("un CUIT que no valida se avisa", () => {
  const d = armarDatos({ ...DOC, cuitEmisor: "30718089410" }, RENGLONES);
  assert.equal(d.procedencia.verificado, false);
  assert.match(d.procedencia.advertencia ?? "", /cuit/i);
});

test("cuando no se pudo verificar, no afirma que esté bien", () => {
  // `null` no es `false` ni `true`: sin desglose no se puede decir nada, y
  // decir "verificado" sería mentir en un documento que alguien va a usar para
  // pagar.
  const d = armarDatos({ ...DOC, neto: null, iva: null, cuitEmisor: null }, []);
  assert.equal(d.procedencia.verificado, false);
  // Va como NOTA, no como advertencia: no se pudo verificar y no es lo mismo
  // que estar mal. Si fuera advertencia, todo remito saldría con un recuadro
  // rojo, y una alarma que suena siempre deja de ser una alarma.
  assert.equal(d.procedencia.advertencia, undefined);
  assert.match(d.procedencia.nota ?? "", /verificar/i);
});

test("los renglones que no suman el neto se avisan", () => {
  const d = armarDatos(DOC, [RENGLONES[0], { ...RENGLONES[1], subtotal: 100n }]);
  assert.equal(d.procedencia.verificado, false);
  assert.match(d.procedencia.advertencia ?? "", /renglones/i);
});

// ---------------------------------------------------------------------------
// Los casos que no son una factura A perfecta
// ---------------------------------------------------------------------------

test("un comprobante sin renglones sale igual, con la tabla vacía", () => {
  // Un ticket o un remito cargado a mano no tiene detalle, y el documento tiene
  // que salir lo mismo: es lo que Aldana abre para ver qué está por pagar.
  const d = armarDatos(DOC, []);
  assert.deepEqual(d.renglones, []);
  assert.equal(d.totales.total, "$ 772.867,75");
});

test("un remito sin identidad fiscal sale sin inventar números", () => {
  const remito = {
    ...DOC,
    kind: "REMITO",
    source: "MANUAL",
    cuitEmisor: null,
    tipoCbte: null,
    puntoVenta: null,
    numero: null,
    importeTotal: null,
    neto: null,
    iva: null,
    percepciones: null,
    cae: null,
    vencimiento: null,
  };
  const d = armarDatos(remito, []);
  assert.equal(d.encabezado.comprobante, "REMITO");
  assert.equal(d.encabezado.cuit, "");
  assert.equal(d.encabezado.vencimiento, "");
  assert.equal(d.totales.total, "");
  assert.equal(d.totales.cae, "");
  assert.equal(d.procedencia.origen, "cargado a mano");
});

test("una nota de crédito se anuncia como lo que es", () => {
  // El signo lo decide el tipo, y el documento tiene que decirlo: un PDF que
  // dice "$ 30.000" sin aclarar que RESTA se paga por error.
  const d = armarDatos({ ...DOC, kind: "NOTA_CREDITO", importeTotal: 3000000n }, []);
  assert.equal(d.encabezado.comprobante, "NOTA DE CRÉDITO A 0002-00028897");
  assert.match(d.titulo, /cr[eé]dito/i);
  assert.match(d.totales.leyendaTotal ?? "", /resta|descuenta|a favor/i);
});

test("una cantidad sin unidad no imprime un espacio suelto", () => {
  const d = armarDatos(DOC, [{ ...RENGLONES[0], unidad: null }]);
  assert.equal(d.renglones[0].cantidad, "4,400");
});

test("un renglón sin números no rompe el documento", () => {
  const d = armarDatos(DOC, [
    { orden: 1, codigo: null, descripcion: "FLETE", cantidad: null, unidad: null, precioUnitario: null, subtotal: null },
  ]);
  assert.equal(d.renglones[0].descripcion, "FLETE");
  assert.equal(d.renglones[0].cantidad, "");
  assert.equal(d.renglones[0].precioUnitario, "");
});

test("el origen distingue el QR de la lectura y de la carga a mano", () => {
  assert.equal(armarDatos({ ...DOC, source: "QR" }, []).procedencia.origen, "leído del QR");
  assert.equal(armarDatos({ ...DOC, source: "ARCA" }, []).procedencia.origen, "importado de ARCA");
  assert.equal(armarDatos({ ...DOC, source: "MANUAL" }, []).procedencia.origen, "cargado a mano");
});

// ---------------------------------------------------------------------------
// Lo que anotó quien recibió la mercadería
// ---------------------------------------------------------------------------
//
// Hasta ahora el depósito lo cargaba y **no lo veía nadie más**: ni `destino`,
// ni `conforme`, ni `faltantesNota` aparecían en ninguna pantalla fuera de la
// propia captura. Quien paga transfería el total sin enterarse de que en el
// depósito habían marcado que faltaban cosas.

test("el documento cuenta cómo se recibió la mercadería", () => {
  const d = armarDatos(DOC, RENGLONES);
  assert.ok(d.recepcion);
  assert.match(d.recepcion.linea, /dep[oó]sito/i);
  assert.match(d.recepcion.linea, /Pablo/);
  assert.equal(d.recepcion.alerta, undefined);
});

test("si en el depósito faltaban cosas, el documento lo grita", () => {
  // Es la única razón del sistema para no transferir el total impreso.
  const d = armarDatos(
    { ...DOC, conforme: false, faltantesNota: "faltaron 2 hormas de brie" },
    RENGLONES,
  );
  assert.match(d.recepcion?.alerta ?? "", /faltab/i);
  assert.match(d.recepcion?.alerta ?? "", /brie/i);
});

test("faltantes sin nota igual avisa", () => {
  const d = armarDatos({ ...DOC, conforme: false, faltantesNota: null }, RENGLONES);
  assert.match(d.recepcion?.alerta ?? "", /faltab/i);
});

test("cuando nadie anotó nada, no se inventa una línea vacía", () => {
  // "Destino: no se sabe" ocupa lugar y no aporta.
  const d = armarDatos(
    { ...DOC, destino: null, destinoNota: null, conforme: null, faltantesNota: null, capturedByName: null },
    RENGLONES,
  );
  assert.equal(d.recepcion, null);
});
