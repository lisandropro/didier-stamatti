import { test } from "node:test";
import assert from "node:assert/strict";
import { detectarCuadrilatero } from "../lib/comprobantes/cuadrilatero";
import { detectarBordes } from "../lib/comprobantes/bordes";

/**
 * Encontrar las cuatro esquinas del papel.
 *
 * **Por qué se reemplazó lo anterior.** El detector viejo umbralizaba y devolvía
 * la caja del componente claro más grande: un rectángulo RECTO. Contra las 18
 * fotos reales del depósito "acertaba" 18 de 18 — y al dibujarlo encima se veía
 * que siempre marcaba el cuadro entero, que es lo mismo que no detectar nada. De
 * ahí venía tener que ajustar el recorte casi siempre.
 *
 * Acá se prueba con imágenes sintéticas donde la respuesta se conoce de
 * antemano. La prueba contra fotos reales es visual y vive en
 * `scripts/probar-escaneo.mts`.
 */

/** Un lienzo con una hoja clara sobre fondo oscuro, en las esquinas dadas. */
function conHoja(
  ancho: number,
  alto: number,
  esquinas: { x: number; y: number }[],
): Uint8ClampedArray {
  const d = new Uint8ClampedArray(ancho * alto * 4);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const v = dentro(esquinas, x, y) ? 228 : 34;
      d.set([v, v, v, 255], (y * ancho + x) * 4);
    }
  }
  return d;
}

/** Punto en polígono, por cruces. */
function dentro(p: { x: number; y: number }[], x: number, y: number): boolean {
  let d = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (p[i].y > y !== p[j].y > y && x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) {
      d = !d;
    }
  }
  return d;
}

const cerca = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

test("encuentra una hoja RECTA con sus cuatro esquinas", () => {
  const q = [
    { x: 30, y: 40 },
    { x: 170, y: 40 },
    { x: 170, y: 250 },
    { x: 30, y: 250 },
  ];
  const r = detectarCuadrilatero(conHoja(200, 290, q), 200, 290);
  assert.ok(r, "no encontró nada");
  r.esquinas.forEach((p, i) => {
    assert.ok(cerca(p.x, q[i].x, 6), `esquina ${i}: x=${p.x.toFixed(0)}, esperaba ${q[i].x}`);
    assert.ok(cerca(p.y, q[i].y, 6), `esquina ${i}: y=${p.y.toFixed(0)}, esperaba ${q[i].y}`);
  });
});

test("encuentra una hoja TORCIDA, que es lo que el detector viejo no podía", () => {
  // Éste es el caso que importa: la caja recta de antes habría metido fondo en
  // las esquinas y cortado el papel en los lados.
  const q = [
    { x: 45, y: 30 },
    { x: 175, y: 60 },
    { x: 155, y: 255 },
    { x: 25, y: 225 },
  ];
  const r = detectarCuadrilatero(conHoja(200, 290, q), 200, 290);
  assert.ok(r, "no encontró la hoja torcida");
  r.esquinas.forEach((p, i) => {
    assert.ok(cerca(p.x, q[i].x, 10), `esquina ${i}: x=${p.x.toFixed(0)}, esperaba ${q[i].x}`);
    assert.ok(cerca(p.y, q[i].y, 10), `esquina ${i}: y=${p.y.toFixed(0)}, esperaba ${q[i].y}`);
  });
});

test("la inclinación queda registrada, no aplanada a un rectángulo", () => {
  const q = [
    { x: 45, y: 30 },
    { x: 175, y: 60 },
    { x: 155, y: 255 },
    { x: 25, y: 225 },
  ];
  const r = detectarCuadrilatero(conHoja(200, 290, q), 200, 290)!;
  // El lado de arriba baja unos 13°. Si el resultado fuera una caja recta, los
  // dos primeros puntos tendrían la misma `y`.
  const caida = Math.abs(r.esquinas[1].y - r.esquinas[0].y);
  assert.ok(caida > 15, `salió recto: la caída del lado superior es ${caida.toFixed(0)}px`);
});

test("una imagen sin nada NO inventa un cuadrilátero", () => {
  // Devolver algo acá es peor que devolver nada: un marco equivocado se cree.
  const lisa = new Uint8ClampedArray(200 * 290 * 4).fill(150);
  assert.equal(detectarCuadrilatero(lisa, 200, 290), null);
});

test("ruido sin estructura tampoco produce un cuadrilátero", () => {
  const d = new Uint8ClampedArray(200 * 290 * 4);
  let s = 12345;
  for (let i = 0; i < 200 * 290; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = s % 256;
    d.set([v, v, v, 255], i * 4);
  }
  assert.equal(detectarCuadrilatero(d, 200, 290), null);
});

test("una hoja diminuta no cuenta como documento", () => {
  // Una baldosa, un papelito. Un comprobante fotografiado para leerlo ocupa
  // buena parte del cuadro.
  const q = [
    { x: 80, y: 120 },
    { x: 120, y: 120 },
    { x: 120, y: 170 },
    { x: 80, y: 170 },
  ];
  assert.equal(detectarCuadrilatero(conHoja(200, 290, q), 200, 290), null);
});

test("la confianza distingue lo fácil de lo dudoso", () => {
  const facil = [
    { x: 30, y: 40 },
    { x: 170, y: 40 },
    { x: 170, y: 250 },
    { x: 30, y: 250 },
  ];
  const r = detectarCuadrilatero(conHoja(200, 290, facil), 200, 290)!;
  // Contra fotos reales, los correctos puntúan 0,64 a 0,80. Uno sintético y
  // perfecto tiene que estar al menos ahí.
  assert.ok(r.confianza >= 0.6, `confianza ${r.confianza.toFixed(2)}`);
  assert.ok(r.confianza <= 1);
});

// ---------------------------------------------------------------------------
// Los bordes
// ---------------------------------------------------------------------------

test("los bordes salen donde cambia el brillo, y en ningún otro lado", () => {
  const ancho = 60, alto = 60;
  const d = new Uint8ClampedArray(ancho * alto * 4);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const v = x < 30 ? 30 : 220;
      d.set([v, v, v, 255], (y * ancho + x) * 4);
    }
  }
  const b = detectarBordes(d, ancho, alto);

  // En la fila del medio, el borde tiene que estar cerca de x=30.
  const fila = [...Array(ancho).keys()].filter((x) => b[30 * ancho + x]);
  assert.ok(fila.length > 0, "no encontró el borde");
  assert.ok(fila.every((x) => Math.abs(x - 30) <= 2), `bordes dispersos: ${fila.join(",")}`);
});

test("una imagen lisa no produce ningún borde", () => {
  const lisa = new Uint8ClampedArray(50 * 50 * 4).fill(180);
  const b = detectarBordes(lisa, 50, 50);
  assert.equal(b.reduce((s, v) => s + v, 0), 0);
});
