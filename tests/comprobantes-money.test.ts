import { test } from "node:test";
import assert from "node:assert/strict";
import { aCentavos, formatear, aTextoPlano, sumar } from "../lib/money";

/**
 * La plata se guarda en centavos enteros porque el punto flotante no suma
 * plata. Lo que se protege acá es que el número que dice el papel sea
 * exactamente el número que queda en la base, venga en el formato que venga:
 * los importes conviven en varios formatos, con coma o punto decimal y con o
 * sin separador de miles.
 */

test("lee el formato argentino con separador de miles", () => {
  assert.equal(aCentavos("2.231.811,45"), 223181145n);
  assert.equal(aCentavos("$ 2.231.811,45"), 223181145n);
  assert.equal(aCentavos("764.107,11"), 76410711n);
});

test("lee el formato con punto decimal, que es como viene el QR", () => {
  assert.equal(aCentavos("2231811.45"), 223181145n);
  assert.equal(aCentavos("77736.15"), 7773615n);
});

test("completa los centavos que falten", () => {
  assert.equal(aCentavos("1500"), 150000n);
  assert.equal(aCentavos("1500,5"), 150050n);
});

test("no confunde el separador de miles con el decimal", () => {
  // "1.500" en Argentina es mil quinientos, no uno con medio.
  assert.equal(aCentavos("1.500"), 150000n);
  assert.equal(aCentavos("1500.25"), 150025n);
});

test("aguanta los decimales de relleno que mete un emisor real", () => {
  // Un QR real trae "387124.5100000000000000": 16 decimales, y los 14 últimos
  // son ceros. Es plata legítima con relleno, no una lectura mala.
  assert.equal(aCentavos("387124.5100000000000000"), 38712451n);
});

test("el punto con tres dígitos atrás es ambiguo, y lo desempata quien llama", () => {
  // "1500.000" escrito por una persona en Argentina es un millón y medio.
  assert.equal(aCentavos("1500.000"), 150000000n);
  // El mismo texto dentro de un QR o un CSV de ARCA es mil quinientos: ahí el
  // punto SIEMPRE es decimal. La cadena sola no alcanza para decidir; el que
  // sabe de dónde vino el dato, sí.
  assert.equal(aCentavos("1500.000", { puntoEsDecimal: true }), 150000n);
  assert.equal(aCentavos("2231811.45", { puntoEsDecimal: true }), 223181145n);
});

test("no adivina: lo que no entiende devuelve null", () => {
  assert.equal(aCentavos(""), null);
  assert.equal(aCentavos("  "), null);
  assert.equal(aCentavos("s/d"), null);
  assert.equal(aCentavos("abc"), null);
  // La coma siempre es decimal, así que tres dígitos detrás no es plata: es un
  // error de lectura y hay que avisar.
  assert.equal(aCentavos("1500,123"), null);
});

test("no pierde precisión con importes grandes", () => {
  // Arriba del techo de un entero de 32 bits ($21.474.836,47), que es la razón
  // de que la columna sea BigInt y no Int.
  assert.equal(aCentavos("999.999.999,99"), 99999999999n);
});

test("formatea para pantalla en formato argentino", () => {
  assert.equal(formatear(223181145n), "$ 2.231.811,45");
  assert.equal(formatear(0n), "$ 0,00");
  assert.equal(formatear(5n), "$ 0,05");
});

test("aTextoPlano deja el BigInt cruzar a JSON", () => {
  // BigInt no serializa a JSON: `JSON.stringify` tira. Toda server action que
  // devuelva un importe pasa por acá.
  assert.equal(aTextoPlano(223181145n), "223181145");
  assert.doesNotThrow(() => JSON.stringify({ importe: aTextoPlano(223181145n) }));
});

test("suma sin perder un centavo", () => {
  assert.equal(sumar([76410711n, 7773615n]), 84184326n);
  assert.equal(sumar([]), 0n);
});
