import { test } from "node:test";
import assert from "node:assert/strict";
import { repartir, periodoDe } from "../lib/comprobantes/margen";
import { esCostoDeEvento, CATEGORIAS } from "../lib/comprobantes/categorias";

/**
 * El costo por evento.
 *
 * **Acá no se mide, se reparte**, y las pruebas protegen las dos cosas que
 * hacen que un reparto sirva o engañe:
 *
 *   - **que la suma de las partes dé el total**, al centavo. Si cada parte se
 *     redondeara por su cuenta, la pantalla mostraría una diferencia que nadie
 *     puede explicar — y es la clase de error que en este proyecto ya apareció
 *     dos veces.
 *   - **que lo que no es costo de evento quede afuera**. Repartir los
 *     impuestos y los retiros de los socios entre las fiestas haría ver pérdida
 *     donde no la hay.
 */

test("la suma de las partes da el total, al centavo", () => {
  // 100 pesos entre tres eventos no divide exacto. Lo que no puede pasar es
  // que se pierda o se invente un centavo.
  const partes = repartir(10_000n, [
    { eventoId: "a", cubiertos: 100 },
    { eventoId: "b", cubiertos: 50 },
    { eventoId: "c", cubiertos: 33 },
  ]);
  assert.equal(partes.reduce((a, p) => a + p.costo, 0n), 10_000n);
});

test("el sobrante va al evento más grande, y siempre al mismo", () => {
  // Determinista: dos corridas tienen que dar lo mismo, o la pantalla cambiaría
  // sola entre recargas.
  const uno = repartir(100n, [
    { eventoId: "chico", cubiertos: 1 },
    { eventoId: "grande", cubiertos: 2 },
  ]);
  const otro = repartir(100n, [
    { eventoId: "grande", cubiertos: 2 },
    { eventoId: "chico", cubiertos: 1 },
  ]);
  const costoDe = (r: typeof uno, id: string) => r.find((p) => p.eventoId === id)!.costo;
  assert.equal(costoDe(uno, "grande"), costoDe(otro, "grande"));
  assert.ok(costoDe(uno, "grande") > costoDe(uno, "chico"));
  assert.equal(costoDe(uno, "grande") + costoDe(uno, "chico"), 100n);
});

test("reparte en proporción a los cubiertos, no en partes iguales", () => {
  // Una fiesta de 200 no cuesta lo mismo que una de 50.
  const partes = repartir(25_000n, [
    { eventoId: "grande", cubiertos: 200 },
    { eventoId: "chico", cubiertos: 50 },
  ]);
  const g = partes.find((p) => p.eventoId === "grande")!.costo;
  const c = partes.find((p) => p.eventoId === "chico")!.costo;
  assert.equal(g, 20_000n);
  assert.equal(c, 5_000n);
});

test("sin cubiertos cargados no reparte nada, en vez de partir en partes iguales", () => {
  // Partir en partes iguales sería inventar un criterio. Cero dice "no se
  // sabe", que es la verdad.
  const partes = repartir(10_000n, [
    { eventoId: "a", cubiertos: 0 },
    { eventoId: "b", cubiertos: 0 },
  ]);
  assert.deepEqual(partes.map((p) => p.costo), [0n, 0n]);
});

test("un período sin eventos no rompe ni pierde el costo en silencio", () => {
  assert.deepEqual(repartir(10_000n, []), []);
});

// ---------------------------------------------------------------------------
// A qué período va cada factura
// ---------------------------------------------------------------------------

const PERIODOS = [
  { id: "p1", startDay: "2026-09-05", endDay: "2026-09-07" },
  { id: "p2", startDay: "2026-09-12", endDay: "2026-09-14" },
];

test("una factura de adentro del período va a ese período", () => {
  assert.equal(periodoDe("2026-09-06", PERIODOS), "p1");
});

test("la comida del jueves va al fin de semana que viene, no al anterior", () => {
  // Es el caso normal y el que más importa: la fecha de la factura casi nunca
  // cae adentro del período. Si fuera al anterior, el costo se cargaría a
  // eventos que ya pasaron.
  assert.equal(periodoDe("2026-09-10", PERIODOS), "p2");
});

test("lo anterior al primer período cae en el primero", () => {
  assert.equal(periodoDe("2026-08-20", PERIODOS), "p1");
});

test("lo posterior al último período NO se asigna", () => {
  // Todavía no se sabe para qué evento fue. Inventarle un período sería
  // cargarle a una fiesta pasada una compra que es de la que viene.
  assert.equal(periodoDe("2026-09-20", PERIODOS), null);
});

// ---------------------------------------------------------------------------
// Qué entra en el costo y qué no
// ---------------------------------------------------------------------------

test("los impuestos y los retiros de socios NO son costo de un evento", () => {
  // Es la razón de ser de la tabla. Repartirlos entre las fiestas mostraría
  // pérdida donde no la hay.
  assert.equal(esCostoDeEvento("Impuestos"), false);
  assert.equal(esCostoDeEvento("Retiro de socio"), false);
  assert.equal(esCostoDeEvento("Prestamo a personal"), false);
  assert.equal(esCostoDeEvento("Gastos bancarios"), false);
  assert.equal(esCostoDeEvento("Bienes de uso"), false);
});

test("la comida y la gente sí lo son", () => {
  for (const c of ["Carnes", "Verduleria", "Pescados", "Almacen y lacteos", "Bebidas", "Hielo"]) {
    assert.equal(esCostoDeEvento(c), true, `${c} tendría que contar`);
  }
});

test("las cuatro que decidió el usuario entran", () => {
  // Sueldos, cargas sociales, gas y combustible, vajillería y logística. El
  // criterio que eligió es amplio: si el gasto existe porque se hacen eventos,
  // carga contra los eventos.
  for (const c of ["Sueldos", "Cargas sociales", "Gas y combustible", "Vajilla y manteleria", "Logistica y fletes"]) {
    assert.equal(esCostoDeEvento(c), true, `${c} tendría que contar`);
  }
});

test("un proveedor SIN clasificar queda afuera, no adentro", () => {
  // No se sabe qué es. Meterlo en el costo sería inventar; el reparto informa
  // aparte cuánto quedó afuera por esto.
  assert.equal(esCostoDeEvento(null), false);
  assert.equal(esCostoDeEvento(""), false);
  assert.equal(esCostoDeEvento("Rubro que no existe"), false);
});

test("la tabla cubre todas las categorías: si se agrega una, esta prueba falla", () => {
  // El mismo truco que el proyecto ya usa con los roles. Una categoría nueva
  // sin decidir caería en "no es costo" por omisión, y el costo saldría más
  // bajo sin que nada avise.
  for (const c of CATEGORIAS) {
    assert.equal(typeof esCostoDeEvento(c), "boolean", `falta decidir ${c}`);
  }
  assert.equal(CATEGORIAS.length, 26);
});
