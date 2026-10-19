import { test } from "node:test";
import assert from "node:assert/strict";
import { consolidarCambios, describirCambio, textoDePush, type Cambio } from "../lib/aviso-texto";

/**
 * El texto del push: lo que el depósito tiene que hacer, no cuántas veces se
 * tocó algo. Enrique ajusta y reajusta (10→12, 12→24): al depósito le importa
 * que quedó en 24.
 */

const c = (itemName: string, kind: string, before: string | null, after: string | null): Cambio => ({ itemName, kind, before, after });

test("dos cambios de cantidad del mismo ítem son uno solo, de punta a punta", () => {
  assert.deepEqual(consolidarCambios([c("Copa", "CANTIDAD", "10", "12"), c("Copa", "CANTIDAD", "12", "24")]), [
    c("Copa", "CANTIDAD", "10", "24"),
  ]);
});

test("agregar y después sacar lo mismo no deja nada", () => {
  assert.deepEqual(consolidarCambios([c("Hielo", "AGREGADO", null, "20"), c("Hielo", "QUITADO", "20", null)]), []);
});

test("subir y volver a la cantidad original no deja nada", () => {
  assert.deepEqual(consolidarCambios([c("Copa", "CANTIDAD", "10", "12"), c("Copa", "CANTIDAD", "12", "10")]), []);
});

test("sacar y volver a agregar con otra cantidad es un cambio de cantidad", () => {
  assert.deepEqual(consolidarCambios([c("Brasero", "QUITADO", "3", null), c("Brasero", "AGREGADO", null, "5")]), [
    c("Brasero", "CANTIDAD", "3", "5"),
  ]);
});

test("agregar y después cambiar la cantidad es un agregado con la cantidad final", () => {
  assert.deepEqual(consolidarCambios([c("Mantel", "AGREGADO", null, "4"), c("Mantel", "CANTIDAD", "4", "6")]), [
    c("Mantel", "AGREGADO", null, "6"),
  ]);
});

test("una nota que vuelve a ser la de antes no deja nada", () => {
  assert.deepEqual(consolidarCambios([c("Mantel", "NOTA", null, "largos"), c("Mantel", "NOTA", "largos", null)]), []);
});

test("se respeta el orden en que aparece cada ítem", () => {
  const r = consolidarCambios([c("B", "AGREGADO", null, "1"), c("A", "AGREGADO", null, "1"), c("B", "CANTIDAD", "1", "2")]);
  assert.deepEqual(r.map((x) => x.itemName), ["B", "A"]);
});

test("cómo se describe cada clase de cambio", () => {
  assert.equal(describirCambio(c("Copa de agua", "CANTIDAD", "10", "24")), "Copa de agua 10→24");
  assert.equal(describirCambio(c("Servilletas", "AGREGADO", null, "50")), "Servilletas +50");
  assert.equal(describirCambio(c("Brasero", "QUITADO", "3", null)), "Brasero quitado");
  assert.equal(describirCambio(c("Mantel", "NOTA", null, "los largos")), 'Mantel: nota "los largos"');
  assert.equal(describirCambio(c("Mantel", "NOTA", "los largos", null)), "Mantel: nota borrada");
  assert.equal(describirCambio(c("Responsable de la fiesta", "RESPONSABLE", null, "Pablo")), "Responsable: Pablo");
  assert.equal(describirCambio(c("Evento", "FECHA", "sáb 24/10", "dom 25/10")), "Fecha: dom 25/10");
});

test("el push: lugar de título, tres cambios, cuántos más y quién", () => {
  const t = textoDePush("El Carmen Center", "Enrique", [
    c("Copa de agua", "CANTIDAD", "10", "24"),
    c("Servilletas", "AGREGADO", null, "50"),
    c("Brasero", "QUITADO", "3", null),
    c("Mantel", "NOTA", "", "los largos"),
    c("Hielo", "AGREGADO", null, "20"),
  ]);
  assert.deepEqual(t, {
    title: "El Carmen Center",
    body: "Copa de agua 10→24 · Servilletas +50 · Brasero quitado · y 2 más\n— Enrique",
  });
});

test("si todo se compensó, no hay push", () => {
  assert.equal(textoDePush("X", "Enrique", [c("Hielo", "AGREGADO", null, "20"), c("Hielo", "QUITADO", "20", null)]), null);
});

test("el cuerpo nunca pasa de 500 caracteres", () => {
  const largo = "x".repeat(400);
  const t = textoDePush("X", "Enrique", [c(largo, "AGREGADO", null, "1"), c(largo + "y", "AGREGADO", null, "1")]);
  assert.ok(t && t.body.length <= 500);
});
