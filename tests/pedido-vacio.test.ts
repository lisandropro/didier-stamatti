import { test } from "node:test";
import assert from "node:assert/strict";
import { avisosQueTocan, textoDelAviso, type EventoVacio } from "../lib/pedido-vacio";

/**
 * A quién y cuándo se le avisa que un evento no tiene pedido.
 *
 * El control ya existía y ya se disparaba —"Puerto Arriba" estuvo vacío hasta
 * el día anterior— pero solo lo veía la administradora. Quien puede armarlo no
 * se enteraba.
 *
 * Lo que se cuida acá es el equilibrio: que el aviso llegue a tiempo y que no
 * llegue todos los días. Un aviso diario enseña a ignorarlo, y un aviso que se
 * ignora es peor que ninguno, porque da la sensación de que el sistema avisa.
 */

const HOY = "2026-08-19"; // miércoles
const ev = (id: string, dia: string): EventoVacio => ({ id, lugar: "Evento " + id, dia });

test("un evento a tres días entra en el aviso", () => {
  const a = avisosQueTocan([ev("a", "2026-08-22")], HOY);
  assert.equal(a.length, 1);
  assert.equal(a[0].faltan, 3);
});

test("a dos días no vuelve a avisar: misma etiqueta que a tres", () => {
  // Es lo que evita el aviso diario. La etiqueta no cambia, así que el segundo
  // día el barrido lo encuentra ya avisado y se calla.
  const tres = avisosQueTocan([ev("a", "2026-08-22")], HOY)[0];
  const dos = avisosQueTocan([ev("a", "2026-08-21")], HOY)[0];
  assert.equal(tres.umbral, dos.umbral, "tres y dos días comparten etiqueta");
});

test("el día anterior sí vuelve a avisar: cambia la etiqueta", () => {
  const tres = avisosQueTocan([ev("a", "2026-08-22")], HOY)[0];
  const uno = avisosQueTocan([ev("a", "2026-08-20")], HOY)[0];
  assert.notEqual(tres.umbral, uno.umbral, "el último llamado tiene que sonar de nuevo");
  assert.equal(uno.umbral, 1);
});

test("el mismo día también avisa, con la etiqueta del último llamado", () => {
  const hoyMismo = avisosQueTocan([ev("a", HOY)], HOY);
  assert.equal(hoyMismo.length, 1);
  assert.equal(hoyMismo[0].faltan, 0);
  assert.equal(hoyMismo[0].umbral, 1, "no puede sonar una tercera vez");
});

test("cada evento avisa dos veces y nunca más", () => {
  // Se recorre la vida entera del evento, día por día, y se cuentan las
  // etiquetas distintas: son los avisos que va a recibir una persona.
  const dias = ["2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16",
                "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"];
  const etiquetas = new Set<number>();
  for (const d of dias) for (const a of avisosQueTocan([ev("a", "2026-08-20")], d)) etiquetas.add(a.umbral);
  assert.deepEqual([...etiquetas].sort(), [1, 3]);
});

test("un evento lejano no molesta", () => {
  assert.deepEqual(avisosQueTocan([ev("a", "2026-09-30")], HOY), []);
  assert.deepEqual(avisosQueTocan([ev("a", "2026-08-23")], HOY), [], "cuatro días todavía no");
});

test("un evento que ya pasó no avisa: llegar tarde no sirve", () => {
  assert.deepEqual(avisosQueTocan([ev("a", "2026-08-18")], HOY), []);
  assert.deepEqual(avisosQueTocan([ev("a", "2026-01-01")], HOY), []);
});

test("varios eventos vacíos avisan cada uno por su cuenta", () => {
  const a = avisosQueTocan([ev("a", "2026-08-20"), ev("b", "2026-08-22"), ev("c", "2026-09-01")], HOY);
  assert.deepEqual(a.map((x) => x.id), ["a", "b"]);
  assert.deepEqual(a.map((x) => x.umbral), [1, 3]);
});

test("sin eventos vacíos no hay nada que avisar", () => {
  assert.deepEqual(avisosQueTocan([], HOY), []);
});

test("el texto dice cuándo es, sin obligar a hacer la cuenta", () => {
  const de = (dia: string) => textoDelAviso(avisosQueTocan([ev("a", dia)], HOY)[0]);
  assert.match(de(HOY), /es hoy/);
  assert.match(de("2026-08-20"), /es mañana/);
  assert.match(de("2026-08-22"), /es el .*22/);
  assert.match(de(HOY), /su pedido está vacío/);
});
