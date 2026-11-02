import { test } from "node:test";
import assert from "node:assert/strict";
import { vibrar, PATRON } from "../lib/vibrar";

/** Un toque corto al tildar, como en cualquier app: quien prepara con la caja
 *  en la otra mano sabe que el toque entró sin mirar. Donde no hay vibración (iPhone,
 *  la computadora) no hace nada y nunca rompe. */

test("vibra con el patrón pedido cuando el teléfono puede", () => {
  const llamadas: unknown[] = [];
  vibrar(PATRON.tildar, { vibrate: (p: number | number[]) => { llamadas.push(p); return true; } });
  assert.deepEqual(llamadas, [PATRON.tildar]);
});

test("sin vibración no hace nada", () => {
  assert.doesNotThrow(() => vibrar(PATRON.tildar, {}));
});

test("si vibrar falla, no rompe la pantalla", () => {
  assert.doesNotThrow(() => vibrar(PATRON.tildar, { vibrate: () => { throw new Error("no"); } }));
});

test("un patrón de varios pulsos llega entero y como copia", () => {
  const llamadas: unknown[] = [];
  vibrar(PATRON.destildar, { vibrate: (p: number | number[]) => { llamadas.push(p); return true; } });
  assert.deepEqual(llamadas, [[8, 40, 8]]);
  // Una copia y no el mismo arreglo: `PATRON` es de solo lectura y `vibrate` recibe
  // un arreglo común, que cualquiera podría modificar.
  assert.notEqual(llamadas[0], PATRON.destildar);
});
