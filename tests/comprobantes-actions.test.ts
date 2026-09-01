import { test } from "node:test";
import assert from "node:assert/strict";
import {
  puedeResponderImportes,
  aFilaDeuda,
  cabeceraDeLaCaptura,
  destinoValido,
  kindValido,
} from "../lib/comprobantes/politica";
import { QR_MUESTRAS, QR_QUE_NO_SON_FACTURA } from "./fixtures/qr-muestras";

/**
 * La promesa que sostiene meter un módulo de plata dentro de una app que usa
 * todo el equipo: **al teléfono del depósito el importe no le llega nunca**.
 *
 * Se prueba la decisión, no la pantalla. Si esta prueba pasa y la pantalla
 * igual muestra un número, es un bug de la pantalla. Si esta prueba falla, es
 * un agujero.
 */

test("solo ADMIN y PAGOS pueden recibir importes", () => {
  assert.equal(puedeResponderImportes({ role: "ADMIN" }), true);
  assert.equal(puedeResponderImportes({ role: "PAGOS" }), true);
  assert.equal(puedeResponderImportes({ role: "RECEPCION" }), false);
  assert.equal(puedeResponderImportes({ role: "ARMADOR" }), false);
  assert.equal(puedeResponderImportes({ role: "LOGISTICA" }), false);
  assert.equal(puedeResponderImportes(null), false);
});

test("los importes cruzan a la pantalla como texto, no como BigInt", () => {
  // JSON.stringify de un BigInt tira. Verificado contra Prisma 7.
  const fila = aFilaDeuda({
    supplierId: "s1",
    nombre: "DON ANGEL",
    total: 84184326n,
    cantidad: 2,
  });
  assert.equal(fila.total, "84184326");
  assert.equal(typeof fila.total, "string");
  assert.doesNotThrow(() => JSON.stringify(fila));
});

test("la cabecera sale del texto crudo, no de lo que diga el cliente", () => {
  // El navegador manda los QR que vio; el servidor los vuelve a parsear. Confiar
  // en campos sueltos que mande un cliente es confiar en el cliente.
  const sano = QR_MUESTRAS.find((m) => m.nombre === "sano")!.url;
  const c = cabeceraDeLaCaptura([...QR_QUE_NO_SON_FACTURA, sano]);
  assert.equal(c.fuente, "QR");
  assert.equal(c.numero, 57875);
  assert.equal(c.importeTotal, 76410711n);
});

test("sin ningún QR de factura la cabecera queda vacía, no falla", () => {
  // La foto se guarda igual: un comprobante sin identificar es mejor que un
  // papel sobre un escritorio.
  assert.deepEqual(cabeceraDeLaCaptura(QR_QUE_NO_SON_FACTURA), { fuente: "MANUAL" });
  assert.deepEqual(cabeceraDeLaCaptura([]), { fuente: "MANUAL" });
  assert.deepEqual(cabeceraDeLaCaptura(["basura"]), { fuente: "MANUAL" });
});

test("el destino y el tipo se validan contra una lista, no se copian", () => {
  assert.equal(destinoValido("COCINA"), "COCINA");
  assert.equal(destinoValido("DEPOSITO"), "DEPOSITO");
  assert.equal(destinoValido("OTRO"), "OTRO");
  // Cualquier cosa que mande el cliente y no esté en la lista se descarta, y
  // queda en NULL — que significa "no se sabe", no un valor inventado.
  assert.equal(destinoValido("SOTANO"), undefined);
  assert.equal(destinoValido(""), undefined);

  assert.equal(kindValido("FACTURA"), "FACTURA");
  assert.equal(kindValido("REMITO"), "REMITO");
  assert.equal(kindValido("CUALQUIERA"), "OTRO");
  assert.equal(kindValido(""), "OTRO");
});
