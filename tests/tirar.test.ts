import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoDelTiron, pantallaConTiron, UMBRAL, MAXIMO } from "../lib/tirar";

test("tirar para actualizar existe en Período, Preparar y Avisos", () => {
  for (const p of ["/", "/preparar", "/preparar/abc123", "/notificaciones"]) assert.equal(pantallaConTiron(p), true, p);
});

test("no existe en el editor del pedido ni en las demás pantallas", () => {
  for (const p of ["/evento/abc", "/evento/abc/pdf", "/inventario", "/cuenta", "/historial"]) assert.equal(pantallaConTiron(p), false, p);
});

test("un movimiento de costado o hacia arriba no es un tirón", () => {
  assert.equal(estadoDelTiron(30, 60).visible, false);
  assert.equal(estadoDelTiron(-40, 0).visible, false);
});

test("un temblor no muestra nada", () => {
  assert.equal(estadoDelTiron(8, 0).visible, false);
});

test("el indicador baja a la mitad de lo que baja el dedo, con un tope", () => {
  assert.equal(estadoDelTiron(60, 0).y, 30);
  assert.equal(estadoDelTiron(1000, 0).y, MAXIMO);
});

test("está listo para soltar recién pasado el umbral", () => {
  assert.equal(estadoDelTiron(UMBRAL * 2 - 2, 0).listo, false);
  assert.equal(estadoDelTiron(UMBRAL * 2 + 2, 0).listo, true);
});
