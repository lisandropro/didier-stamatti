import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MINIMO_ENTRE_RECARGAS_MS,
  esErrorDeVersionVieja,
  hayVersionNueva,
  sePuedeRecargar,
  type Situacion,
} from "../lib/actualizacion";

/**
 * Cuándo la app se actualiza sola.
 *
 * El 3 de septiembre Enrique intentó guardar diez veces con la app abierta desde
 * antes de un despliegue. El servidor rechazó los diez —su código era viejo— y
 * la app no le mostró nada. Creyó que había cargado el pedido; no se guardó una
 * sola línea.
 *
 * Lo que se protege acá son las dos mitades del arreglo: que la app tome sola la
 * versión nueva, y que **no** lo haga encima de trabajo sin guardar. El armador
 * guarda con 700 ms de retraso: recargar a destiempo se come la última cantidad
 * tipeada, que es exactamente el problema que veníamos a resolver.
 */

const base: Situacion = {
  cargada: "0.1.0+aaaaaaa",
  servidor: "0.1.0+aaaaaaa",
  ocupado: false,
  desdeUltimaRecarga: null,
};

test("misma versión: no pasa nada", () => {
  assert.equal(hayVersionNueva(base), false);
  assert.equal(sePuedeRecargar(base), false);
});

test("el servidor cambió de versión: hay que actualizarse", () => {
  const s = { ...base, servidor: "0.1.0+bbbbbbb" };
  assert.equal(hayVersionNueva(s), true);
  assert.equal(sePuedeRecargar(s), true);
});

test("sin respuesta del servidor no se recarga: puede ser la señal", () => {
  const s = { ...base, servidor: null };
  assert.equal(hayVersionNueva(s), false);
  assert.equal(sePuedeRecargar(s), false);
});

test("nunca se recarga encima de trabajo sin guardar", () => {
  // El caso que importa: hay versión nueva Y la persona está tipeando.
  const s = { ...base, servidor: "0.1.0+bbbbbbb", ocupado: true };
  assert.equal(hayVersionNueva(s), true, "la versión nueva se detecta igual");
  assert.equal(sePuedeRecargar(s), false, "pero se espera");
});

test("la actualización no se descarta: se toma cuando deja de estar ocupado", () => {
  const ocupado = { ...base, servidor: "0.1.0+bbbbbbb", ocupado: true };
  assert.equal(sePuedeRecargar(ocupado), false);
  assert.equal(sePuedeRecargar({ ...ocupado, ocupado: false }), true);
});

test("no se recarga dos veces seguidas: hay un piso entre recargas", () => {
  // Si por algún motivo las versiones nunca coincidieran, sin este piso la app
  // quedaría recargándose en bucle y sería inusable.
  const s = { ...base, servidor: "0.1.0+bbbbbbb", desdeUltimaRecarga: 5_000 };
  assert.equal(sePuedeRecargar(s), false);
  assert.equal(sePuedeRecargar({ ...s, desdeUltimaRecarga: MINIMO_ENTRE_RECARGAS_MS + 1 }), true);
});

test("una versión cargada vacía no dispara nada", () => {
  assert.equal(hayVersionNueva({ ...base, cargada: "", servidor: "0.1.0+bbbbbbb" }), false);
});

// ---------------------------------------------------------------------------
// El otro camino: la acción que ya falló
// ---------------------------------------------------------------------------

test("se reconoce el error exacto que vio Enrique", () => {
  assert.equal(
    esErrorDeVersionVieja(
      'Failed to find Server Action "40bcb43474fc6d92588d95d665d332aa74cecc45d4". This request might be from an older or newer deployment.'
    ),
    true
  );
});

test("también en su forma corta o traducida a medias", () => {
  assert.equal(esErrorDeVersionVieja("This request might be from an older or newer deployment"), true);
  assert.equal(esErrorDeVersionVieja("failed to find server action"), true, "sin importar mayúsculas");
});

test("un error común no dispara una recarga", () => {
  // Recargar por cualquier error sería peor que el problema: se perdería lo
  // que la persona está haciendo cada vez que se corta la señal.
  assert.equal(esErrorDeVersionVieja("Failed to fetch"), false);
  assert.equal(esErrorDeVersionVieja("No se pudo guardar. Revisá la conexión."), false);
  assert.equal(esErrorDeVersionVieja(undefined), false);
  assert.equal(esErrorDeVersionVieja(null), false);
  assert.equal(esErrorDeVersionVieja({ message: "Failed to find Server Action" }), false, "solo texto");
});

// ---------------------------------------------------------------------------
// El contador de trabajo pendiente
// ---------------------------------------------------------------------------

test("el contador de pendientes vuelve a cero cuando todo se guardó", async () => {
  const { marcarPendiente, marcarGuardado, estaOcupado, _reiniciar } = await import("../lib/trabajo-pendiente");
  _reiniciar();
  assert.equal(estaOcupado(), false);
  marcarPendiente();
  assert.equal(estaOcupado(), true);
  marcarGuardado();
  assert.equal(estaOcupado(), false, "si quedara trabado en alto, la app no se actualizaría nunca más");
});

test("varias cosas a medio guardar a la vez: ocupado hasta la última", async () => {
  const { marcarPendiente, marcarGuardado, estaOcupado, _reiniciar } = await import("../lib/trabajo-pendiente");
  _reiniciar();
  marcarPendiente();
  marcarPendiente();
  marcarGuardado();
  assert.equal(estaOcupado(), true, "todavía queda una");
  marcarGuardado();
  assert.equal(estaOcupado(), false);
});

test("un guardado de más no deja el contador en negativo", async () => {
  // Si quedara negativo, el próximo pendiente real no se notaría y la app
  // podría recargarse justo encima de algo sin guardar.
  const { marcarPendiente, marcarGuardado, estaOcupado, _reiniciar } = await import("../lib/trabajo-pendiente");
  _reiniciar();
  marcarGuardado();
  marcarGuardado();
  marcarPendiente();
  assert.equal(estaOcupado(), true);
});
