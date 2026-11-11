import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { llaveDeCliente } from "../lib/llave-cliente";

/**
 * Lo que pasa cuando la app se abre por una dirección insegura.
 *
 * Esta suite existe por un bug reportado desde un teléfono: **un botón no hacía
 * absolutamente nada**. Ni abría, ni fallaba, ni mostraba un mensaje.
 *
 * La causa era `crypto.randomUUID()`, que **solo existe en contextos seguros**
 * —HTTPS o `localhost`— y no cuando la app se sirve por IP en la red local, que
 * es exactamente cómo se prueba desde un celular. La llamada estaba *antes* del
 * `try`, así que la excepción se llevaba puesto el `finally` que soltaba la
 * guarda de reentrada: el primer toque fallaba en silencio y todos los
 * siguientes salían por el `return` de la primera línea.
 *
 * Nada de esto lo veía una prueba: en Node y en `localhost` la API existe. Por
 * eso lo que se prueba acá es el comportamiento **cuando no existe**.
 *
 * (El diagnóstico de la cámara que también se probaba acá era de la pantalla de
 * captura del módulo financiero, retirado el 19/10/2026: se fue con él.)
 */

const cryptoOriginal = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, "crypto", {
    value: cryptoOriginal,
    configurable: true,
    writable: true,
  });
});

test("la llave usa randomUUID cuando existe", () => {
  const k = llaveDeCliente();
  assert.match(k, /^[0-9a-f-]{36}$/i);
});

test("SIN randomUUID sigue devolviendo una llave, no una excepción", () => {
  // Este es el caso que rompía todo. Que tire acá es que el botón muere allá.
  Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true, writable: true });
  const k = llaveDeCliente();
  assert.ok(typeof k === "string" && k.length > 8, `devolvió ${JSON.stringify(k)}`);
});

test("sin crypto en absoluto tampoco tira", () => {
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });
  assert.ok(llaveDeCliente().length > 8);
});

test("dos llaves seguidas del respaldo no se repiten", () => {
  // Solo tienen que distinguirse entre envíos del mismo teléfono: la unicidad
  // real la garantiza el índice de la base.
  Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true, writable: true });
  const vistas = new Set(Array.from({ length: 200 }, () => llaveDeCliente()));
  assert.equal(vistas.size, 200);
});
