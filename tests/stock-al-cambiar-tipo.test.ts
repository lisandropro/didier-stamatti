import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { stockAlPasarAReutilizable } from "../lib/stock-al-cambiar-tipo";

/**
 * Un consumible que pasa a reutilizable no puede llegar diciendo "hay cero".
 *
 * Los consumibles se guardan con stock 0 porque no se cuentan: se compran para
 * cada evento. Al pasar a reutilizable ese 0 seguía ahí, y la app lo leía como
 * un recuento: "piden 40, hay 0, faltan 40". Desde la etapa 3 eso además manda
 * un aviso urgente a todos. Lo cierto es que nadie lo contó: tiene que quedar
 * SIN CONTAR, que pide un recuento en vez de inventar un faltante.
 *
 * La regla es la de la migración del 19/08: un número es un dato solo si hay
 * una huella de que alguien lo puso a propósito — un movimiento de stock, o
 * haber sido reutilizable antes (un alta con cero explícito no deja movimiento).
 */

test("un consumible de nacimiento, nunca contado, pasa a SIN CONTAR", () => {
  assert.equal(stockAlPasarAReutilizable({ stock: 0, tieneMovimientos: false, fueReutilizable: false }), null);
});

test("si alguna vez se contó, el número se conserva aunque sea cero", () => {
  assert.equal(stockAlPasarAReutilizable({ stock: 0, tieneMovimientos: true, fueReutilizable: false }), 0);
  assert.equal(stockAlPasarAReutilizable({ stock: 12, tieneMovimientos: true, fueReutilizable: true }), 12);
});

test("si ya fue reutilizable, su cero es el del alta y se conserva", () => {
  assert.equal(stockAlPasarAReutilizable({ stock: 0, tieneMovimientos: false, fueReutilizable: true }), 0);
});

test("lo que ya estaba sin contar sigue sin contar", () => {
  assert.equal(stockAlPasarAReutilizable({ stock: null, tieneMovimientos: false, fueReutilizable: true }), null);
});

test("un número distinto de cero nunca se borra", () => {
  assert.equal(stockAlPasarAReutilizable({ stock: 7, tieneMovimientos: false, fueReutilizable: false }), 7);
});

// La acción no corre fuera de Next (lee la sesión de las cookies): como en
// `order-actions.test.ts`, se exige sobre el texto que la use y que no escriba
// el stock leído, que pisaría un recuento guardado en el medio.
test("updateProduct aplica la regla y solo escribe el stock cuando cambia", () => {
  const texto = fs.readFileSync(path.join(process.cwd(), "app/actions/products.ts"), "utf8");
  const desde = texto.indexOf("export async function updateProduct");
  const cuerpo = texto.slice(desde, texto.indexOf("export async function", desde + 1));
  assert.ok(cuerpo.includes("stockAlPasarAReutilizable("), "updateProduct no aplica la regla");
  assert.ok(cuerpo.includes('before: "REUTILIZABLE"'), "no mira si ya fue reutilizable");
  assert.ok(!/stock: p\.stock\s*[,}]/.test(cuerpo.replace(/stockAlPasarAReutilizable\(\{[^}]*\}\)/, "")), "escribe el stock leído");
});
