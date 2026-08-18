import { test } from "node:test";
import assert from "node:assert/strict";
import { separarPorFecha } from "../lib/period-fit";
import { instanteDe } from "../lib/dates";

/**
 * Qué eventos quedan a la vista y cuáles se pliegan.
 *
 * Un período puede durar varios días, y mientras está abierto mezclaba los
 * eventos ya hechos con los que faltan. Quien entra a ver qué tiene por delante
 * tenía que leer fechas una por una.
 *
 * La regla es por jornada, no por reloj: en el depósito se trabaja el día
 * entero, así que un evento de hoy sigue pendiente aunque su hora ya haya
 * pasado.
 */

const HOY = "2026-08-18";
const ev = (dia: string, hora = "12:00") => ({ id: dia + hora, date: instanteDe(dia, hora) });

test("lo de ayer se pliega y lo de mañana queda a la vista", () => {
  const ayer = ev("2026-08-17");
  const manana = ev("2026-08-19");
  const { porHacer, pasados } = separarPorFecha([ayer, manana], HOY);
  assert.deepEqual(porHacer, [manana]);
  assert.deepEqual(pasados, [ayer]);
});

test("un evento de hoy sigue pendiente aunque su hora ya haya pasado", () => {
  const tempranito = ev(HOY, "07:30");
  const { porHacer, pasados } = separarPorFecha([tempranito], HOY);
  assert.deepEqual(porHacer, [tempranito]);
  assert.deepEqual(pasados, []);
});

test("un evento que arranca al filo de la medianoche todavía es de hoy", () => {
  const filo = ev(HOY, "00:00");
  assert.equal(separarPorFecha([filo], HOY).porHacer.length, 1);
});

test("el último instante de ayer ya es pasado", () => {
  const filo = ev("2026-08-17", "23:59");
  assert.equal(separarPorFecha([filo], HOY).pasados.length, 1);
});

test("se conserva el orden en que venían", () => {
  const lista = [ev("2026-08-15"), ev("2026-08-20"), ev("2026-08-16"), ev("2026-08-25")];
  const { porHacer, pasados } = separarPorFecha(lista, HOY);
  assert.deepEqual(porHacer.map((e) => e.id), [lista[1].id, lista[3].id]);
  assert.deepEqual(pasados.map((e) => e.id), [lista[0].id, lista[2].id]);
});

test("un período sin eventos no rompe nada", () => {
  assert.deepEqual(separarPorFecha([], HOY), { porHacer: [], pasados: [] });
});

test("si todavía no pasó ninguno, no hay nada que plegar", () => {
  const lista = [ev(HOY), ev("2026-08-19")];
  const { porHacer, pasados } = separarPorFecha(lista, HOY);
  assert.equal(porHacer.length, 2);
  assert.equal(pasados.length, 0);
});

test("si ya pasaron todos, la lista de arriba queda vacía", () => {
  const lista = [ev("2026-08-15"), ev("2026-08-16")];
  const { porHacer, pasados } = separarPorFecha(lista, HOY);
  assert.equal(porHacer.length, 0);
  assert.equal(pasados.length, 2);
});

test("no se toca la lista original", () => {
  const lista = [ev("2026-08-15"), ev("2026-08-19")];
  const copia = [...lista];
  separarPorFecha(lista, HOY);
  assert.deepEqual(lista, copia);
});

test("el corte se lee en la hora argentina, no en la del servidor", () => {
  // 2026-08-19 a las 00:30 en Argentina es todavía el 18 en UTC. Si el corte se
  // leyera en UTC, este evento caería del lado equivocado.
  const madrugada = ev("2026-08-19", "00:30");
  assert.equal(separarPorFecha([madrugada], "2026-08-19").porHacer.length, 1);
  assert.equal(separarPorFecha([madrugada], "2026-08-20").pasados.length, 1);
});
