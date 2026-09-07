import { test } from "node:test";
import assert from "node:assert/strict";
import { revisar, aRenglones, interpretar } from "../lib/comprobantes/lectura";
import { cuitValido } from "../lib/comprobantes/cuit";

/**
 * Los tres controles que hacen que una lectura probabilística pueda tocar plata
 * sin que alguien revise campo por campo.
 *
 * La idea es simple: un dígito mal leído casi nunca deja la cuenta cuadrada, ni
 * los renglones cerrando, ni el CUIT validando. Cuando los tres dan verde,
 * confirmar es un toque; cuando alguno da rojo, ese campo se mira.
 *
 * Es la misma disciplina que el control de saldos del extracto bancario:
 * **sobredeterminar el documento**, y dejar que un error rompa alguna de las
 * cuentas. Un documento que solo dice su total no se puede verificar contra
 * nada.
 *
 * La llamada al modelo NO se prueba acá: cada corrida costaría plata y fallaría
 * sin red. Se prueba a mano contra fotos reales, una vez.
 */

test("el CUIT valida por dígito verificador", () => {
  assert.equal(cuitValido("30717737489"), true); // el de la empresa
  assert.equal(cuitValido("20135041379"), true); // DON ANGEL, de una factura real
  assert.equal(cuitValido("30712345678"), false); // un dígito cambiado
  assert.equal(cuitValido("123"), false);
  assert.equal(cuitValido(""), false);
  assert.equal(cuitValido("abcdefghijk"), false);
});

test("el CUIT acepta los guiones con que se imprime", () => {
  // En el papel casi siempre está como 30-71773748-9.
  assert.equal(cuitValido("30-71773748-9"), true);
});

test("la cuenta cierra cuando subtotal + IVA + percepciones dan el total", () => {
  const c = revisar({ subtotal: 63873368n, iva: 13413407n, percepciones: 0n, total: 77286775n });
  assert.equal(c.cierraLaCuenta, true);
});

test("un dígito mal leído en el total rompe la cuenta y se avisa", () => {
  const c = revisar({ subtotal: 63873368n, iva: 13413407n, percepciones: 0n, total: 77286875n });
  assert.equal(c.cierraLaCuenta, false);
});

test("sin los sumandos no se afirma nada", () => {
  // `null` no es `false`: no poder verificar y verificar que está mal son cosas
  // distintas, y mostrarlas igual sería mentirle a quien paga.
  assert.equal(revisar({ total: 77286775n }).cierraLaCuenta, null);
  assert.equal(revisar({}).cuitValido, null);
  assert.equal(revisar({}).cierranLosRenglones, null);
});

test("las percepciones pueden faltar y la cuenta cierra igual", () => {
  const c = revisar({ subtotal: 100000n, iva: 21000n, total: 121000n });
  assert.equal(c.cierraLaCuenta, true);
});

// ---------------------------------------------------------------------------
// Los renglones: la segunda cuenta que tiene que cerrar
// ---------------------------------------------------------------------------

test("los renglones cierran cuando cantidad x precio da el subtotal de cada uno", () => {
  const c = revisar({
    subtotal: 150000n, // $1.500,00
    renglones: [
      { descripcion: "Lomo", cantidad: "10", precioUnitario: "100,00", subtotal: "1000,00" },
      { descripcion: "Pollo", cantidad: "5", precioUnitario: "100,00", subtotal: "500,00" },
    ],
  });
  assert.equal(c.cierranLosRenglones, true);
});

test("una cantidad con decimales también cierra", () => {
  // 2,5 kg a $400,00 = $1.000,00. Los kilos con coma son lo normal en carnicería.
  const c = revisar({
    subtotal: 100000n,
    renglones: [{ descripcion: "Peceto", cantidad: "2,5", precioUnitario: "400,00", subtotal: "1000,00" }],
  });
  assert.equal(c.cierranLosRenglones, true);
});

test("un renglón mal leído rompe la cuenta de los renglones", () => {
  const c = revisar({
    subtotal: 150000n,
    renglones: [
      { descripcion: "Lomo", cantidad: "10", precioUnitario: "100,00", subtotal: "1000,00" },
      { descripcion: "Pollo", cantidad: "5", precioUnitario: "100,00", subtotal: "900,00" },
    ],
  });
  assert.equal(c.cierranLosRenglones, false);
});

test("los renglones que suman distinto al subtotal general no cierran", () => {
  // Cada renglón cierra solo, pero la suma no da el subtotal impreso: falta un
  // renglón, que es justamente lo que ninguna otra comprobación detecta.
  const c = revisar({
    subtotal: 200000n,
    renglones: [
      { descripcion: "Lomo", cantidad: "10", precioUnitario: "100,00", subtotal: "1000,00" },
      { descripcion: "Pollo", cantidad: "5", precioUnitario: "100,00", subtotal: "500,00" },
    ],
  });
  assert.equal(c.cierranLosRenglones, false);
});

test("un centavo de redondeo por renglón se tolera", () => {
  // 3 unidades a $33,33 dan $99,99, y muchos emisores imprimen $100,00.
  // Rechazar eso convertiría el control en ruido y dejaría de mirarse.
  const c = revisar({
    subtotal: 10000n,
    renglones: [{ descripcion: "Cosa", cantidad: "3", precioUnitario: "33,33", subtotal: "100,00" }],
  });
  assert.equal(c.cierranLosRenglones, true);
});

test("sin los números de los renglones no se afirma nada", () => {
  const c = revisar({
    subtotal: 150000n,
    renglones: [{ descripcion: "Algo sin cantidad ni precio" }],
  });
  assert.equal(c.cierranLosRenglones, null);
});

test("con renglones pero sin subtotal general tampoco se afirma", () => {
  const c = revisar({
    renglones: [{ descripcion: "Lomo", cantidad: "10", precioUnitario: "100,00", subtotal: "1000,00" }],
  });
  assert.equal(c.cierranLosRenglones, null);
});

// ---------------------------------------------------------------------------
// De lo que devuelve el modelo a lo que entiende el sistema
// ---------------------------------------------------------------------------

test("los renglones llegan como texto y se convierten con el parser de siempre", () => {
  const r = aRenglones([
    { descripcion: "Lomo", cantidad: "2,5", unidad: "KG", precioUnitario: "1.234,56", subtotal: "3.086,40" },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].precioUnitario, "1.234,56");
  assert.equal(r[0].descripcion, "Lomo");
});

test("un renglón sin descripción se descarta", () => {
  // Sin descripción no es un renglón: es ruido de la lectura, y sumarlo a la
  // pantalla obliga a alguien a borrarlo a mano.
  assert.equal(aRenglones([{ cantidad: "1" }, { descripcion: "  " }]).length, 0);
});

test("lo que no es una lista de renglones no rompe nada", () => {
  assert.deepEqual(aRenglones(undefined), []);
  assert.deepEqual(aRenglones("una factura" as unknown as unknown[]), []);
});

// ---------------------------------------------------------------------------
// La respuesta del modelo, tal como llega
// ---------------------------------------------------------------------------
//
// `interpretar` es la frontera: de acá para adentro son centavos enteros y
// fechas válidas. Probarla con respuestas realistas cuesta cero y cubre lo que
// la llamada real no puede cubrir en cada corrida.

test("una respuesta completa se interpreta entera y los tres controles dan verde", () => {
  const { campos, controles } = interpretar({
    nombreProveedor: "DON ANGEL S.R.L.",
    cuitEmisor: "20-13504137-9",
    fechaEmision: "2026-08-27",
    vencimiento: "2026-09-11",
    subtotal: "631.493,48",
    iva: "132.613,63",
    percepciones: "0",
    total: "764.107,11",
    renglones: [
      { descripcion: "Lomo", cantidad: "10", precioUnitario: "31.574,674", subtotal: "315.746,74" },
      { descripcion: "Peceto", cantidad: "10", precioUnitario: "31.574,674", subtotal: "315.746,74" },
    ],
  });

  assert.equal(campos.total, 76410711n);
  assert.equal(campos.cuitEmisor, "20135041379"); // los guiones se van
  assert.equal(campos.vencimiento, "2026-09-11");
  assert.equal(controles.cierraLaCuenta, true);
  assert.equal(controles.cuitValido, true);
});

test("un campo omitido queda vacío y no en cero", () => {
  // El modelo tiene instrucción de omitir lo que no lee. Un cero acá entraría en
  // una suma de deuda sin que nadie lo vea.
  const { campos, controles } = interpretar({ nombreProveedor: "Kiosco", total: "1500,00" });
  assert.equal(campos.iva, undefined);
  assert.equal(campos.subtotal, undefined);
  assert.equal(controles.cierraLaCuenta, null);
  assert.equal(controles.cuitValido, null);
});

test("una fecha inventada por el modelo se descarta", () => {
  // El 30 de febrero tiene la forma correcta. `new Date` lo corre al 2 de marzo.
  assert.equal(interpretar({ vencimiento: "2026-02-30" }).campos.vencimiento, undefined);
  assert.equal(interpretar({ fechaEmision: "27/08/2026" }).campos.fechaEmision, undefined);
});

test("un importe que el modelo devuelve mal formado no entra", () => {
  assert.equal(interpretar({ total: "aproximadamente 1500" }).campos.total, undefined);
  // Y un negativo tampoco: el signo lo decide el tipo de comprobante.
  assert.equal(interpretar({ total: "-1500,00" }).campos.total, undefined);
});

test("un CUIT mal leído se guarda igual pero el control avisa", () => {
  // No se descarta: el campo leído es la mejor pista de cuál es el proveedor, y
  // borrarlo dejaría a quien completa sin nada. Lo que NO se hace es callarlo.
  const { campos, controles } = interpretar({ cuitEmisor: "20135041370" });
  assert.equal(campos.cuitEmisor, "20135041370");
  assert.equal(controles.cuitValido, false);
});

test("una respuesta vacía no rompe nada", () => {
  const { campos, controles } = interpretar({});
  assert.deepEqual(campos.renglones, []);
  assert.equal(controles.cierraLaCuenta, null);
});

test("basura en los renglones no rompe la interpretación", () => {
  const { campos } = interpretar({ renglones: "no es una lista" });
  assert.deepEqual(campos.renglones, []);
});

test("un precio unitario de tres decimales cierra: es la forma real", () => {
  // De la factura de DON ANGEL del 27/08. El kilo va a "31.574,674" porque el
  // precio se multiplica antes de redondear. Con la regla de dos decimales de
  // los importes, este renglón no se podía verificar — y es la forma más común.
  const c = revisar({
    subtotal: 63149348n,
    renglones: [
      { descripcion: "Lomo", cantidad: "10", precioUnitario: "31.574,674", subtotal: "315.746,74" },
      { descripcion: "Peceto", cantidad: "10", precioUnitario: "31.574,674", subtotal: "315.746,74" },
    ],
  });
  assert.equal(c.cierranLosRenglones, true);
});

test("y un precio de tres decimales mal leído igual se detecta", () => {
  const c = revisar({
    subtotal: 31574674n,
    renglones: [
      { descripcion: "Lomo", cantidad: "10", precioUnitario: "31.574,674", subtotal: "415.746,74" },
    ],
  });
  assert.equal(c.cierranLosRenglones, false);
});
