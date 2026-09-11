import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularPactado, IVA_POR_CIENTO } from "../lib/comprobantes/ingresos";

/**
 * Lo que se le cobra al cliente por un evento.
 *
 * **Lo que se protege acá es el IVA.** ARCA entrega el costo con neto e IVA
 * separados. Si el ingreso se comparara con el IVA adentro, el margen saldría
 * inflado un 21% — y ese número no se usa para mirar: se usa para decidir
 * precios. Un margen inflado es peor que ningún margen.
 *
 * Y la otra distinción que no se ve: **comensales no es invitados**. Se cobra
 * por los presupuestados aunque vengan menos; tomarlo del evento daría un
 * ingreso más chico que el real, y la diferencia se leería como menos margen.
 */

const SIN_EXTRAS: bigint[] = [];

test("con el IVA adentro, el neto sale de dividir por 1,21", () => {
  // 100 cubiertos a $12.100 = $1.210.000 con IVA -> $1.000.000 netos.
  const p = calcularPactado({
    precioPorPersona: 1_210_000n, // $12.100,00
    comensales: 100,
    extras: SIN_EXTRAS,
    conIva: true,
  });
  assert.ok(p);
  assert.equal(p.bruto, 121_000_000n);
  assert.equal(p.neto, 100_000_000n);
  assert.equal(p.iva, 21_000_000n);
  assert.equal(p.neto + p.iva, p.bruto, "las partes tienen que dar el todo");
});

test("sin IVA adentro, el neto es el precio y el IVA se agrega", () => {
  const p = calcularPactado({
    precioPorPersona: 1_000_000n, // $10.000,00
    comensales: 100,
    extras: SIN_EXTRAS,
    conIva: false,
  });
  assert.ok(p);
  assert.equal(p.bruto, 100_000_000n);
  assert.equal(p.neto, 100_000_000n, "el pactado ya era neto");
  assert.equal(p.iva, 21_000_000n);
});

test("el mismo precio da NETOS distintos según lleve IVA o no", () => {
  // Es la razón entera de guardar `conIva`. Si se asumiera uno de los dos, la
  // mitad de los eventos tendría el margen mal por un 21%, sin ninguna señal.
  const base = { precioPorPersona: 1_210_000n, comensales: 100, extras: SIN_EXTRAS };
  const con = calcularPactado({ ...base, conIva: true });
  const sin = calcularPactado({ ...base, conIva: false });
  assert.ok(con && sin);
  assert.notEqual(con.neto, sin.neto);
  assert.equal(sin.neto - con.neto, 21_000_000n, "exactamente el IVA de diferencia");
});

test("los extras se suman al total, y son fijos: no se multiplican por la gente", () => {
  // Un kiosco se cobra por kiosco. Si se multiplicara por los comensales, un
  // kiosco de $500.000 en una fiesta de 200 daría cien millones.
  const p = calcularPactado({
    precioPorPersona: 1_000_000n,
    comensales: 200,
    extras: [50_000_000n, 30_000_000n], // dos kioscos
    conIva: false,
  });
  assert.ok(p);
  assert.equal(p.bruto, 200_000_000n + 80_000_000n);
});

test("se cobra por los comensales PRESUPUESTADOS, no por los que vinieron", () => {
  // El mínimo garantizado. La cantidad sale de acá y no de `Event.guests`:
  // son dos números distintos y este es el que factura.
  const p = calcularPactado({
    precioPorPersona: 1_000_000n,
    comensales: 150,
    extras: SIN_EXTRAS,
    conIva: false,
  });
  assert.ok(p);
  assert.equal(p.bruto, 150_000_000n);
});

test("sin precio o sin comensales devuelve NULL, no cero", () => {
  // Un evento sin precio cargado no vale cero pesos: no se sabe cuánto vale.
  // Cero se leería como "no dejó nada" y arruinaría cualquier promedio.
  assert.equal(
    calcularPactado({ precioPorPersona: null, comensales: 100, extras: SIN_EXTRAS, conIva: true }),
    null,
  );
  assert.equal(
    calcularPactado({ precioPorPersona: 1_000n, comensales: null, extras: SIN_EXTRAS, conIva: true }),
    null,
  );
});

test("mientras no se sepa si lleva IVA, se calcula del modo que NO infla el margen", () => {
  // `conIva` en NULL es "nadie contestó". Suponer que el precio es neto daría
  // un margen 21% mejor del real; suponer que lo incluye da uno más chico. Ante
  // la duda, el que no hace tomar una decisión equivocada.
  const nulo = calcularPactado({
    precioPorPersona: 1_210_000n, comensales: 100, extras: SIN_EXTRAS, conIva: null,
  });
  const conIva = calcularPactado({
    precioPorPersona: 1_210_000n, comensales: 100, extras: SIN_EXTRAS, conIva: true,
  });
  assert.deepEqual(nulo, conIva);
});

test("un precio negativo se rechaza en vez de restar", () => {
  assert.equal(
    calcularPactado({ precioPorPersona: -1_000n, comensales: 10, extras: SIN_EXTRAS, conIva: false }),
    null,
  );
  assert.equal(
    calcularPactado({ precioPorPersona: 1_000n, comensales: -5, extras: SIN_EXTRAS, conIva: false }),
    null,
  );
});

test("el redondeo del IVA no pierde ni inventa un centavo", () => {
  // Un importe que no divide exacto por 1,21. Lo que no puede pasar es que
  // neto + iva deje de dar el bruto: ahí es donde se escapa un centavo por
  // evento y a fin de año nadie lo puede explicar.
  for (const bruto of [1n, 7n, 99n, 100n, 12_345n, 999_999n, 1_000_000_007n]) {
    const p = calcularPactado({
      precioPorPersona: bruto, comensales: 1, extras: SIN_EXTRAS, conIva: true,
    });
    assert.ok(p);
    assert.equal(p.neto + p.iva, p.bruto, `no cierra con ${bruto}`);
    assert.ok(p.neto >= 0n && p.iva >= 0n, `algo dio negativo con ${bruto}`);
  }
});

test("la alícuota está en un solo lugar", () => {
  // Si el día de mañana cambia, tiene que cambiar acá y no en cinco cuentas
  // repetidas por el código.
  assert.equal(IVA_POR_CIENTO, 21n);
});
