import { test } from "node:test";
import assert from "node:assert/strict";
import { mismoOrigen } from "../lib/mismo-origen";

const h = (x: Record<string, string>) => new Headers(x);
const PUBLICO = "didier.up.railway.app";

test("detrás del proxy: el host público viene en x-forwarded-host y se acepta", () => {
  // Es el caso de producción, el que estuvo roto del 07/09 al 19/10/2026: la
  // app recibe `host: localhost:8080` y el navegador manda el dominio público.
  assert.equal(
    mismoOrigen(h({ origin: `https://${PUBLICO}`, host: "localhost:8080", "x-forwarded-host": PUBLICO })),
    true,
  );
});

test("sin proxy: alcanza con el host", () => {
  assert.equal(mismoOrigen(h({ origin: "http://localhost:3000", host: "localhost:3000" })), true);
});

test("otro sitio no pasa", () => {
  assert.equal(
    mismoOrigen(h({ origin: "https://malicioso.example", host: "localhost:8080", "x-forwarded-host": PUBLICO })),
    false,
  );
});

test("un subdominio parecido no pasa", () => {
  assert.equal(mismoOrigen(h({ origin: `https://${PUBLICO}.malicioso.example`, "x-forwarded-host": PUBLICO })), false);
});

test("el puerto cuenta", () => {
  assert.equal(mismoOrigen(h({ origin: "http://localhost:3001", host: "localhost:3000" })), false);
});

test("con varios proxies se toma el primer host", () => {
  assert.equal(mismoOrigen(h({ origin: `https://${PUBLICO}`, "x-forwarded-host": `${PUBLICO}, interno:8080` })), true);
});

test("Origin null o ilegible no pasa", () => {
  assert.equal(mismoOrigen(h({ origin: "null", host: PUBLICO })), false);
  assert.equal(mismoOrigen(h({ origin: "esto no es una url", host: PUBLICO })), false);
});

test("con Origin y sin ningún host no pasa", () => {
  assert.equal(mismoOrigen(h({ origin: `https://${PUBLICO}` })), false);
});

test("sin Origin se deja pasar, como antes: la sesión se exige después", () => {
  assert.equal(mismoOrigen(h({ host: PUBLICO })), true);
});
