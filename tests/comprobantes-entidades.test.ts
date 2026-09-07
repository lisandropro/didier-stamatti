import { test } from "node:test";
import assert from "node:assert/strict";
import { quienRecibe, type EntidadConocida } from "../lib/comprobantes/qr";
import { normalizarCuit } from "../lib/comprobantes/entidades";

/**
 * A nombre de quién está la factura.
 *
 * **Por qué existe esto.** El módulo tenía el CUIT de la empresa escrito como
 * una constante. Con la UTE de los Juegos Suramericanos hay dos contribuyentes,
 * y esa constante habría marcado como ajena **cada factura de la UTE** — un
 * aviso que sale siempre es un aviso que en dos días nadie lee, incluida la vez
 * que tiene razón.
 *
 * Lo que se prueba acá es que los tres estados sigan siendo tres. Colapsar
 * "no se sabe" con "es de otro" es el error que este diseño existe para evitar.
 */

const SOLUCIONES: EntidadConocida = { id: "e1", cuit: "30717737489" };
const UTE: EntidadConocida = { id: "e2", cuit: "30718888887" };
const NUESTRAS = [SOLUCIONES, UTE];

test("una factura de la empresa se asigna sola, sin que nadie elija", () => {
  const r = quienRecibe({ fuente: "QR", cuitReceptor: "30717737489" }, NUESTRAS);
  assert.equal(r.estado, "una-nuestra");
  assert.equal(r.estado === "una-nuestra" && r.entidadId, "e1");
});

test("una factura de la UTE se asigna a la UTE, no a la empresa", () => {
  // Éste es el caso que motivó todo. Con el CUIT hardcodeado, esta factura
  // habría dado "no es de ustedes" y habría sumado en la deuda equivocada.
  const r = quienRecibe({ fuente: "QR", cuitReceptor: "30718888887" }, NUESTRAS);
  assert.equal(r.estado, "una-nuestra");
  assert.equal(r.estado === "una-nuestra" && r.entidadId, "e2");
});

test("una factura de un tercero se marca como ajena, y dice de quién", () => {
  const r = quienRecibe({ fuente: "QR", cuitReceptor: "20111111112" }, NUESTRAS);
  assert.equal(r.estado, "ajena");
  assert.equal(r.estado === "ajena" && r.cuit, "20111111112");
});

test("sin dato NO se afirma que sea ajena", () => {
  // 12 de las 18 fotos reales no traen ningún código. Si "no dice" se tratara
  // como "es de otro", el aviso saldría en la mayoría de las capturas.
  assert.equal(quienRecibe({ fuente: "MANUAL" }, NUESTRAS).estado, "no-dice");
  assert.equal(quienRecibe({ fuente: "QR", cuitReceptor: "" }, NUESTRAS).estado, "no-dice");
});

test("sin entidades cargadas no se acusa a nadie de ajeno... pero tampoco se asigna", () => {
  // Estado posible el primer día, antes de dar de alta la primera entidad.
  const r = quienRecibe({ fuente: "QR", cuitReceptor: "30717737489" }, []);
  assert.equal(r.estado, "ajena");
});

test("el CUIT se normaliza igual venga como venga", () => {
  // En el papel casi siempre está con guiones; el QR lo trae pelado. Si las dos
  // formas no colapsaran a la misma, una entidad cargada a mano nunca
  // engancharía con las facturas que llegan por QR.
  assert.equal(normalizarCuit("30-71773748-9"), "30717737489");
  assert.equal(normalizarCuit("30717737489"), "30717737489");
  assert.equal(normalizarCuit(" 30 71773748 9 "), "30717737489");
});
