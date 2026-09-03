import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { enderezarEnServidor, leerEsquinas } from "../lib/comprobantes/enderezar-servidor";

/**
 * Enderezar el papel del lado del servidor.
 *
 * **Por qué se movió acá.** Lo hacía el teléfono, y medido a la resolución real
 * de captura tardaba 1,2 s de media y 1,8 s el peor caso: varios segundos de
 * pantalla congelada por cada foto. Con eso, encadenar cinco comprobantes de un
 * reparto es insoportable — y encadenarlos es justamente lo que hace falta.
 *
 * Lo que se protege acá es que **nada pueda impedir que la foto quede**: si el
 * enderezado falla por cualquier motivo, devuelve `null` y quien llama sube la
 * original.
 */

/** Un JPEG con una franja oscura a la izquierda, para ver si el recorte agarró
 *  el lado correcto. */
async function jpegDePrueba(ancho: number, alto: number): Promise<Buffer> {
  const crudo = Buffer.alloc(ancho * alto * 3);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const v = x < ancho / 3 ? 30 : 220;
      const i = (y * ancho + x) * 3;
      crudo[i] = v;
      crudo[i + 1] = v;
      crudo[i + 2] = v;
    }
  }
  return sharp(crudo, { raw: { width: ancho, height: alto, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

const esq = (p: { x: number; y: number }[]) => JSON.stringify(p);

test("endereza y devuelve un JPEG del tamaño del recorte", async () => {
  const jpg = await jpegDePrueba(400, 600);
  const r = await enderezarEnServidor(
    jpg,
    esq([
      { x: 140, y: 20 },
      { x: 380, y: 20 },
      { x: 380, y: 580 },
      { x: 140, y: 580 },
    ]),
  );
  assert.ok(r, "no enderezó");
  assert.equal(r.ancho, 240);
  assert.equal(r.alto, 560);
  // Que sea un JPEG de verdad y no bytes cualesquiera.
  const meta = await sharp(r.jpeg).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, 240);
});

test("el recorte se queda con la parte pedida, no con la otra", async () => {
  // Se recorta la mitad CLARA. Si el resultado saliera oscuro, el mapeo estaría
  // espejado o corrido — y eso no lo detecta ninguna prueba de geometría.
  const jpg = await jpegDePrueba(400, 600);
  const r = await enderezarEnServidor(
    jpg,
    esq([
      { x: 200, y: 40 },
      { x: 380, y: 40 },
      { x: 380, y: 560 },
      { x: 200, y: 560 },
    ]),
  );
  assert.ok(r);
  const { data } = await sharp(r.jpeg).greyscale().raw().toBuffer({ resolveWithObject: true });
  const medio = data.reduce((s, v) => s + v, 0) / data.length;
  assert.ok(medio > 180, `salió oscuro: brillo medio ${medio.toFixed(0)}`);
});

test("sin esquinas NO endereza: la original se guarda entera", async () => {
  const jpg = await jpegDePrueba(200, 300);
  assert.equal(await enderezarEnServidor(jpg, ""), null);
  assert.equal(await enderezarEnServidor(jpg, undefined), null);
});

test("una imagen ilegible no tumba la captura", async () => {
  // Vale la regla del módulo: nada puede impedir que la foto quede.
  const basura = Buffer.from("esto no es una imagen");
  assert.equal(
    await enderezarEnServidor(
      basura,
      esq([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    ),
    null,
  );
});

// ---------------------------------------------------------------------------
// Las esquinas vienen de un cliente
// ---------------------------------------------------------------------------

test("acepta cuatro puntos dentro de la foto", () => {
  const r = leerEsquinas(
    esq([
      { x: 10, y: 10 },
      { x: 90, y: 10 },
      { x: 90, y: 190 },
      { x: 10, y: 190 },
    ]),
    100,
    200,
  );
  assert.equal(r?.length, 4);
});

test("rechaza lo que no es un cuadrilátero", () => {
  assert.equal(leerEsquinas("no es json", 100, 200), null);
  assert.equal(leerEsquinas(esq([{ x: 1, y: 1 }]), 100, 200), null);
  assert.equal(leerEsquinas(JSON.stringify("una cadena"), 100, 200), null);
  assert.equal(leerEsquinas(null, 100, 200), null);
});

test("rechaza números que no son números", () => {
  // `NaN` e `Infinity` sobreviven a `JSON.parse` como `null`, y un punto con
  // coordenadas raras produce un mapa de perspectiva sin sentido.
  assert.equal(leerEsquinas('[{"x":null,"y":0},{"x":1,"y":0},{"x":1,"y":1},{"x":0,"y":1}]', 100, 200), null);
  assert.equal(leerEsquinas('[{"x":"5","y":0},{"x":1,"y":0},{"x":1,"y":1},{"x":0,"y":1}]', 100, 200), null);
});

test("rechaza esquinas lejos de la foto", () => {
  const r = leerEsquinas(
    esq([
      { x: -900, y: -900 },
      { x: 90, y: 10 },
      { x: 90, y: 190 },
      { x: 10, y: 190 },
    ]),
    100,
    200,
  );
  assert.equal(r, null);
});

test("una esquina apenas afuera se pega al borde, no se rechaza", () => {
  // El detector puede dar una esquina un par de píxeles fuera del cuadro, y
  // tirar la foto por eso sería perder un recorte bueno.
  const r = leerEsquinas(
    esq([
      { x: -3, y: -2 },
      { x: 102, y: 0 },
      { x: 100, y: 200 },
      { x: 0, y: 199 },
    ]),
    100,
    200,
  );
  assert.ok(r);
  assert.equal(r[0].x, 0);
  assert.equal(r[0].y, 0);
  assert.equal(r[1].x, 100);
});
