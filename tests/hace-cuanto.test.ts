import { test } from "node:test";
import assert from "node:assert/strict";
import { haceCuanto, instanteDe } from "../lib/dates";

/**
 * "Hace cuánto" se cambió un pedido, como lo dice la tarjeta de Preparar. Se
 * calcula en el servidor, así que los días son los argentinos, no los del
 * reloj del servidor (que está en UTC).
 */

const ahora = instanteDe("2026-10-20", "10:00");
const antes = (min: number) => new Date(ahora.getTime() - min * 60_000);

test("menos de un minuto es recién", () => {
  assert.equal(haceCuanto(antes(0), ahora), "recién");
  assert.equal(haceCuanto(new Date(ahora.getTime() - 59_000), ahora), "recién");
});

test("minutos y horas", () => {
  assert.equal(haceCuanto(antes(1), ahora), "hace 1 min");
  assert.equal(haceCuanto(antes(59), ahora), "hace 59 min");
  assert.equal(haceCuanto(antes(60), ahora), "hace 1 h");
  assert.equal(haceCuanto(antes(9 * 60 + 59), ahora), "hace 9 h");
});

test("ayer es el día argentino anterior, aunque hayan pasado menos de 24 horas", () => {
  // 20/10 a las 10:00; el cambio fue el 19/10 a las 23:00 argentinas (02:00 UTC del 20).
  assert.equal(haceCuanto(instanteDe("2026-10-19", "23:00"), ahora), "ayer");
});

test("días y, pasada una semana, la fecha", () => {
  assert.equal(haceCuanto(instanteDe("2026-10-17", "10:00"), ahora), "hace 3 días");
  assert.equal(haceCuanto(instanteDe("2026-10-10", "10:00"), ahora), "Sáb 10/10");
});

test("un instante en el futuro (relojes desfasados) no dice algo raro", () => {
  assert.equal(haceCuanto(new Date(ahora.getTime() + 120_000), ahora), "recién");
});
