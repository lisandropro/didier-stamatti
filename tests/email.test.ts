import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, emailProblem } from "../lib/email";

/**
 * El correo es la llave para entrar. Estas pruebas existen por un caso real:
 * Aldana quedó afuera de la app porque su usuario se creó como
 * `administración@…`, con tilde.
 */

// --- El caso que pasó ---------------------------------------------------------

test("un correo con tilde antes de la arroba se rechaza al crear el usuario", () => {
  const problema = emailProblem(normalizeEmail("administración@didierstamatti.com"));
  assert.ok(problema, "tendría que haber avisado y no avisó");
  assert.match(problema, /ó/);
});

test("y el aviso sugiere la dirección sin tilde, que es la que se quiso poner", () => {
  const problema = emailProblem(normalizeEmail("administración@didierstamatti.com"))!;
  assert.match(problema, /administracion@didierstamatti\.com/);
});

test("la eñe también, por el mismo motivo", () => {
  const problema = emailProblem(normalizeEmail("señora@didierstamatti.com"))!;
  assert.ok(problema);
  assert.match(problema, /senora@didierstamatti\.com/);
});

test("un acento en el dominio no molesta al login, así que no se rechaza", () => {
  // El problema es antes de la arroba; el dominio lo resuelve el sistema aparte.
  assert.equal(emailProblem("hola@catering.com"), null);
});

// --- Las dos formas de escribir la misma tilde --------------------------------

test("la misma dirección escrita de las dos formas termina siendo el mismo texto", () => {
  // "ó" como una sola letra, y "o" seguida de una tilde suelta. Se ven iguales.
  const unaLetra = "josé@didier.com";
  const oMasTilde = "josé@didier.com";
  assert.notEqual(unaLetra, oMasTilde, "deberían empezar siendo distintas");
  assert.equal(normalizeEmail(unaLetra), normalizeEmail(oMasTilde));
});

test("normalizar saca espacios y mayúsculas", () => {
  assert.equal(normalizeEmail("  Contacto@Didier.COM  "), "contacto@didier.com");
});

test("normalizar no rompe un correo común", () => {
  assert.equal(normalizeEmail("lisa.lf2006@gmail.com"), "lisa.lf2006@gmail.com");
});

test("los correos que ya están en uso siguen entrando igual", () => {
  for (const e of [
    "lisa.lf2006@gmail.com",
    "contacto@didierstamatti.com",
    "pablograttone83@gmail.com",
  ]) {
    assert.equal(normalizeEmail(e), e, `${e} cambiaría al normalizar`);
    assert.equal(emailProblem(e), null, `${e} sería rechazado`);
  }
});

// --- Lo demás que se valida ---------------------------------------------------

test("se piden las partes mínimas de un correo", () => {
  assert.ok(emailProblem(""));
  assert.ok(emailProblem("sinarroba"));
  assert.ok(emailProblem("@sinnombre.com"));
  assert.ok(emailProblem("sindominio@"));
  assert.ok(emailProblem("hola@sinpunto"));
  assert.ok(emailProblem("con espacio@didier.com"));
});

test("un correo normal pasa", () => {
  assert.equal(emailProblem("aldana@didierstamatti.com"), null);
  assert.equal(emailProblem("administracion@didierstamatti.com"), null);
  assert.equal(emailProblem("nombre.apellido+etiqueta@sub.dominio.com.ar"), null);
});
