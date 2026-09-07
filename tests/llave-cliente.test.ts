import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { llaveDeCliente, porQueNoHayCamara } from "../lib/llave-cliente";

/**
 * Lo que pasa cuando la app se abre por una dirección insegura.
 *
 * Esta suite existe por un bug reportado desde un teléfono: **el botón de la
 * cámara no hacía absolutamente nada**. Ni abría, ni fallaba, ni mostraba un
 * mensaje.
 *
 * La causa era `crypto.randomUUID()`, que **solo existe en contextos seguros**
 * —HTTPS o `localhost`— y no cuando la app se sirve por IP en la red local, que
 * es exactamente cómo se prueba desde un celular. La llamada estaba *antes* del
 * `try`, así que la excepción se llevaba puesto el `finally` que soltaba la
 * guarda de reentrada: el primer toque fallaba en silencio y todos los
 * siguientes salían por el `return` de la primera línea.
 *
 * Nada de esto lo veía una prueba: en Node y en `localhost` las dos APIs
 * existen. Por eso lo que se prueba acá es el comportamiento **cuando no
 * existen**.
 */

const cryptoOriginal = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, "crypto", {
    value: cryptoOriginal,
    configurable: true,
    writable: true,
  });
  // @ts-expect-error se limpian los dobles del entorno de navegador
  delete globalThis.window;
  // @ts-expect-error idem
  delete globalThis.navigator;
  // @ts-expect-error idem
  delete globalThis.location;
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
  // Solo tienen que distinguirse entre capturas del mismo teléfono: la unicidad
  // real la garantiza el índice de la base.
  Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true, writable: true });
  const vistas = new Set(Array.from({ length: 200 }, () => llaveDeCliente()));
  assert.equal(vistas.size, 200);
});

// ---------------------------------------------------------------------------
// El diagnóstico de la cámara
// ---------------------------------------------------------------------------

/** Simula un navegador con o sin contexto seguro. */
function navegador(opts: { seguro: boolean; conMediaDevices: boolean; host?: string }) {
  Object.defineProperty(globalThis, "window", {
    value: { isSecureContext: opts.seguro },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: opts.conMediaDevices ? { mediaDevices: { getUserMedia: () => {} } } : {},
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "location", {
    value: { host: opts.host ?? "192.168.0.220:3000" },
    configurable: true,
    writable: true,
  });
}

test("con contexto seguro y cámara disponible, no hay impedimento", () => {
  navegador({ seguro: true, conMediaDevices: true });
  assert.equal(porQueNoHayCamara(), null);
});

test("por http, el mensaje NOMBRA la dirección como el problema", () => {
  // "No se pudo abrir la cámara" manda a revisar permisos, a reiniciar el
  // teléfono, a cualquier lado menos al problema real.
  navegador({ seguro: false, conMediaDevices: false, host: "192.168.0.220:3000" });
  const m = porQueNoHayCamara() ?? "";
  assert.match(m, /https/i);
  assert.match(m, /192\.168\.0\.220:3000/);
  assert.doesNotMatch(m, /permiso/i, "no debería mandar a revisar permisos");
});

test("en contexto seguro pero sin soporte, dice otra cosa", () => {
  // Un navegador viejo por HTTPS: el problema NO es la dirección, y decir que sí
  // lo mandaría a cambiar algo que ya está bien.
  navegador({ seguro: true, conMediaDevices: false });
  const m = porQueNoHayCamara() ?? "";
  assert.doesNotMatch(m, /https/i);
  assert.match(m, /navegador/i);
});
