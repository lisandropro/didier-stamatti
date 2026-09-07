import { test } from "node:test";
import assert from "node:assert/strict";
import { SeguidorDePapel, ocupaPoco, type Cuadro } from "../lib/comprobantes/seguidor";

/**
 * El marco que sigue al papel en el visor.
 *
 * Lo que se prueba acá es lo que separa "se ve como CamScanner" de "titila": la
 * detección cruda cambia unos píxeles en cada lectura y falla cada tanto, y
 * dibujarla tal cual da un marco que tiembla y parpadea.
 *
 * Es lógica pura: se la alimenta con una secuencia de lecturas y se comprueba
 * qué dibujaría. No hace falta una cámara.
 */

const PAPEL: Cuadro = [
  { x: 100, y: 100 },
  { x: 500, y: 100 },
  { x: 500, y: 700 },
  { x: 100, y: 700 },
];

/** El mismo papel, movido `d` píxeles: el temblor de una mano. */
function movido(c: Cuadro, d: number): Cuadro {
  return c.map((p) => ({ x: p.x + d, y: p.y + d })) as Cuadro;
}

test("una sola lectura NO dibuja nada", () => {
  // Un reflejo o un cuadro borroso encuentran "algo" por un instante. Dibujarlo
  // pone un marco en cualquier lado y se ve como un error.
  const s = new SeguidorDePapel();
  assert.equal(s.observar(PAPEL), null);
});

test("dos lecturas seguidas SÍ lo dibujan", () => {
  const s = new SeguidorDePapel();
  s.observar(PAPEL);
  assert.ok(s.observar(PAPEL));
});

test("perder el papel un par de cuadros NO lo hace desaparecer", () => {
  // Mover la mano hace fallar una lectura cada tanto. Esconder el marco cada vez
  // lo haría titilar, y el parpadeo se lee como "no lo encuentra" aunque lo
  // encuentre casi siempre.
  const s = new SeguidorDePapel();
  s.observar(PAPEL);
  s.observar(PAPEL);
  assert.ok(s.observar(null), "se fue con una falla");
  assert.ok(s.observar(null), "se fue con dos fallas");
  assert.ok(s.observar(null), "se fue con tres fallas");
});

test("perderlo del todo SÍ lo hace desaparecer", () => {
  const s = new SeguidorDePapel();
  s.observar(PAPEL);
  s.observar(PAPEL);
  for (let i = 0; i < 6; i++) s.observar(null);
  assert.equal(s.actual, null);
});

test("el marco se mueve hacia la lectura nueva, no salta a ella", () => {
  // Esto es lo que quita el temblor: cada lectura corrige una fracción.
  const s = new SeguidorDePapel();
  s.observar(PAPEL);
  s.observar(PAPEL);
  const r = s.observar(movido(PAPEL, 20))!;
  const avance = r[0].x - 100;
  assert.ok(avance > 0, "no se movió nada");
  assert.ok(avance < 20, `saltó entero: avanzó ${avance} de 20`);
});

test("varias lecturas seguidas terminan de alcanzarla", () => {
  // Suavizar no puede significar quedarse atrás para siempre.
  const s = new SeguidorDePapel();
  s.observar(PAPEL);
  s.observar(PAPEL);
  let r: Cuadro | null = null;
  for (let i = 0; i < 15; i++) r = s.observar(movido(PAPEL, 20));
  assert.ok(Math.abs(r![0].x - 120) < 1, `quedó en ${r![0].x}, esperaba ~120`);
});

test("apuntar a OTRO papel salta de una, no viaja por la pantalla", () => {
  // Si el salto es grande, suavizar haría que el marco cruce despacio lugares
  // donde no hay nada — se ve como si el papel se hubiera movido, y no pasó eso.
  const s = new SeguidorDePapel();
  s.observar(PAPEL);
  s.observar(PAPEL);
  const otro: Cuadro = [
    { x: 900, y: 900 },
    { x: 1300, y: 900 },
    { x: 1300, y: 1500 },
    { x: 900, y: 1500 },
  ];
  const r = s.observar(otro)!;
  assert.deepEqual(r, otro);
});

test("el temblor de la mano NO se trata como otro papel", () => {
  const s = new SeguidorDePapel();
  s.observar(PAPEL);
  s.observar(PAPEL);
  const r = s.observar(movido(PAPEL, 8))!;
  assert.ok(r[0].x > 100 && r[0].x < 108, `saltó con un temblor de 8px: ${r[0].x}`);
});

test("reiniciar borra todo: al reabrir la cámara no queda un marco viejo", () => {
  const s = new SeguidorDePapel();
  s.observar(PAPEL);
  s.observar(PAPEL);
  assert.ok(s.actual);
  s.reiniciar();
  assert.equal(s.actual, null);
  // Y vuelve a exigir dos lecturas para aparecer.
  assert.equal(s.observar(PAPEL), null);
});

// ---------------------------------------------------------------------------

test("avisa cuando el papel ocupa poco cuadro", () => {
  // Una foto donde el comprobante ocupa un cuarto de la pantalla se ve bien en
  // el visor y después no se lee el CAE.
  const chiquito: Cuadro = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 300 },
    { x: 0, y: 300 },
  ];
  assert.equal(ocupaPoco(chiquito, 960, 1280), true);
});

test("un papel que llena el cuadro no molesta con el aviso", () => {
  const grande: Cuadro = [
    { x: 20, y: 20 },
    { x: 940, y: 20 },
    { x: 940, y: 1260 },
    { x: 20, y: 1260 },
  ];
  assert.equal(ocupaPoco(grande, 960, 1280), false);
});
