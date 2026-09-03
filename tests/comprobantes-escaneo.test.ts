import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ordenarEsquinas,
  medidaDeSalida,
  mapaDePerspectiva,
  puntoBlanco,
  enderezarPixeles,
  type Mapa,
  type Esquina,
} from "../lib/comprobantes/escaneo";

/**
 * La geometría del escaneo.
 *
 * Ordenar las esquinas mal es el error que no se ve venir: la imagen sale
 * rotada 90° o espejada, y como igual "parece un escaneo", nadie se da cuenta
 * hasta que hay que leer un CAE al revés.
 *
 * El recorte y el realce se comprueban a ojo: una prueba automática de "esta
 * imagen se ve linda" no existe. Lo que sí se prueba acá es **la matemática**,
 * que es donde viven los errores silenciosos.
 */

// Una hoja fotografiada de costado: las esquinas NO vienen en orden.
const DESORDENADAS = [
  { x: 640, y: 900 }, // inferior derecha
  { x: 120, y: 80 }, // superior izquierda
  { x: 100, y: 950 }, // inferior izquierda
  { x: 700, y: 60 }, // superior derecha
];

test("ordena las esquinas empezando por la superior izquierda, en sentido horario", () => {
  const o = ordenarEsquinas(DESORDENADAS);
  assert.ok(o);
  assert.deepEqual(o, [
    { x: 120, y: 80 },
    { x: 700, y: 60 },
    { x: 640, y: 900 },
    { x: 100, y: 950 },
  ]);
});

test("con menos de cuatro esquinas no inventa un cuadrilátero", () => {
  assert.equal(ordenarEsquinas(DESORDENADAS.slice(0, 3)), null);
  assert.equal(ordenarEsquinas([]), null);
});

test("la salida conserva la proporción del papel, no la de la foto", () => {
  // Se toma el lado más largo de cada par: si un borde quedó escorzado por el
  // ángulo, usar el corto achataría la hoja y con ella los renglones.
  const m = medidaDeSalida(ordenarEsquinas(DESORDENADAS)!);
  assert.ok(m.ancho > 0 && m.alto > 0);
  // Una hoja A4 vertical: más alta que ancha. Si esto se invierte, la imagen
  // salió acostada.
  assert.ok(m.alto > m.ancho, `salió acostada: ${m.ancho}x${m.alto}`);
});

test("una hoja perfectamente derecha no se deforma", () => {
  const rect = [
    { x: 0, y: 0 },
    { x: 800, y: 0 },
    { x: 800, y: 1100 },
    { x: 0, y: 1100 },
  ];
  const m = medidaDeSalida(rect);
  assert.equal(m.ancho, 800);
  assert.equal(m.alto, 1100);
});

// ---------------------------------------------------------------------------
// La perspectiva
// ---------------------------------------------------------------------------
//
// Es la parte que reemplaza a OpenCV. Se prueba comprobando que las esquinas
// vayan a donde tienen que ir y que una recta del papel siga siendo una recta:
// un error acá curva los renglones y la factura queda ilegible justo en la
// columna de los importes.

const CERCA = (a: number, b: number, tol = 0.001) =>
  assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test("las cuatro esquinas del destino caen en las cuatro del papel", () => {
  const q = ordenarEsquinas(DESORDENADAS)!;
  const m = mapaDePerspectiva(q);
  assert.ok(m);

  const esquinas: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  esquinas.forEach(([u, v], i) => {
    const p = m(u, v);
    CERCA(p.x, q[i].x);
    CERCA(p.y, q[i].y);
  });
});

test("un rectángulo derecho se mapea sin distorsión", () => {
  const m = mapaDePerspectiva([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 200 },
    { x: 0, y: 200 },
  ]);
  assert.ok(m);
  CERCA(m(0.5, 0.5).x, 50);
  CERCA(m(0.5, 0.5).y, 100);
  CERCA(m(0.25, 0.75).x, 25);
  CERCA(m(0.25, 0.75).y, 150);
});

test("una recta del papel sigue siendo una recta después de enderezar", () => {
  // El borde superior del destino tiene que caer sobre el segmento entre las dos
  // esquinas de arriba del papel. Si el mapa está mal, el punto del medio se
  // sale de la recta y los renglones salen curvados.
  const q = ordenarEsquinas(DESORDENADAS)!;
  const m = mapaDePerspectiva(q);
  assert.ok(m);
  const p = m(0.5, 0);
  // Producto cruzado: si es cero, los tres puntos son colineales.
  const cruz =
    (q[1].x - q[0].x) * (p.y - q[0].y) - (q[1].y - q[0].y) * (p.x - q[0].x);
  CERCA(cruz, 0, 0.01);
});

test("cuatro puntos degenerados no producen un mapa", () => {
  // Todos iguales: no hay cuadrilátero. Devolver un mapa igual daría una imagen
  // de un solo color, que "parece un escaneo" y no lo es.
  assert.equal(
    mapaDePerspectiva([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ]),
    null,
  );
});

// ---------------------------------------------------------------------------
// El realce
// ---------------------------------------------------------------------------

test("el punto blanco sale del papel, no del pixel más claro", () => {
  // Un reflejo del flash es un puñado de píxeles a 255. Si el punto blanco
  // saliera del máximo, ese reflejo definiría toda la imagen y el papel quedaría
  // gris. Se usa un percentil alto, que ignora el reflejo.
  const papel = new Uint8ClampedArray(400 * 4);
  for (let i = 0; i < 400; i++) {
    // 99% del papel a 180 (papel en sombra), 1% a 255 (el reflejo).
    const v = i < 396 ? 180 : 255;
    papel.set([v, v, v, 255], i * 4);
  }
  const b = puntoBlanco(papel);
  assert.ok(b >= 175 && b <= 185, `el reflejo se coló: ${b}`);
});

test("una imagen negra no produce un punto blanco de cero", () => {
  // Dividir por cero mandaría todos los píxeles a infinito y saldría una imagen
  // blanca vacía: el comprobante desaparecería sin ningún error.
  const negra = new Uint8ClampedArray(40 * 4);
  assert.ok(puntoBlanco(negra) >= 1);
});

// ---------------------------------------------------------------------------
// La detección automática
// ---------------------------------------------------------------------------
//
// Sus pruebas se mudaron a `comprobantes-cuadrilatero.test.ts` junto con el
// detector. La caja recta que vivía acá se reemplazó por Canny + Hough: contra
// las 18 fotos reales del depósito, aquella "acertaba" 18 de 18 marcando siempre
// el cuadro entero, que es lo mismo que no detectar nada.

// ---------------------------------------------------------------------------
// La prueba de ida y vuelta
// ---------------------------------------------------------------------------
//
// Esta es la que de verdad prueba el escaneo. Se toma un "documento" conocido,
// se lo deforma como si alguien le sacara una foto de costado, y se comprueba
// que el enderezado lo recupera. Si la matemática estuviera mal —esquinas
// cambiadas, mapa invertido, muestreo corrido— el documento recuperado no se
// parecería al original, y ninguna prueba de geometría suelta lo detectaría.

/** Un "documento": franjas horizontales, como los renglones de una factura. */
function documento(ancho: number, alto: number): Mapa {
  const data = new Uint8ClampedArray(ancho * alto * 4);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      // Franjas cada 8 filas, y una marca oscura en la esquina superior
      // izquierda para detectar rotaciones y espejados.
      const enFranja = Math.floor(y / 8) % 2 === 0;
      const enMarca = x < ancho * 0.15 && y < alto * 0.1;
      const v = enMarca ? 0 : enFranja ? 250 : 60;
      data.set([v, v, v, 255], (y * ancho + x) * 4);
    }
  }
  return { data, width: ancho, height: alto };
}

function pixel(m: Mapa, x: number, y: number): number {
  const i = (Math.round(y) * m.width + Math.round(x)) * 4;
  return m.data[i];
}

test("un documento deformado se recupera al enderezarlo", () => {
  const original = documento(200, 300);

  // Se "fotografía" de costado: el documento se proyecta a este cuadrilátero
  // dentro de una foto más grande.
  const enLaFoto: Esquina[] = [
    { x: 60, y: 40 },
    { x: 330, y: 90 },
    { x: 300, y: 430 },
    { x: 30, y: 380 },
  ];
  const foto = enderezarPixeles(original, invertir(enLaFoto, 200, 300), 400, 480, {
    realzar: false,
  });
  assert.ok(foto, "no se pudo generar la foto de prueba");

  // Y ahora el camino real: de la foto, con esas esquinas, al documento derecho.
  const recuperado = enderezarPixeles(foto, enLaFoto, 200, 300, { realzar: false });
  assert.ok(recuperado);

  // La marca tiene que seguir arriba a la izquierda. Se la distingue por ser
  // NEGRO PURO (0): las franjas oscuras del documento valen 60, así que un
  // umbral en el medio confundiría una franja con la marca — que es exactamente
  // el error que tenía la primera versión de esta prueba.
  const esMarca = (x: number, y: number) => pixel(recuperado, x, y) < 30;
  assert.ok(esMarca(12, 12), `la marca no está arriba a la izquierda: ${pixel(recuperado, 12, 12)}`);
  assert.ok(!esMarca(187, 12), "hay marca arriba a la derecha: salió espejada");
  assert.ok(!esMarca(12, 287), "hay marca abajo a la izquierda: salió rotada");
  assert.ok(!esMarca(187, 287), "hay marca abajo a la derecha: salió al revés");

  // Y las franjas tienen que seguir siendo horizontales: dos puntos de la misma
  // fila, lejos entre sí, con el mismo tono.
  const izq = pixel(recuperado, 40, 150);
  const der = pixel(recuperado, 160, 150);
  assert.ok(Math.abs(izq - der) < 60, `los renglones salieron inclinados: ${izq} vs ${der}`);
});

/** Las esquinas que hay que pasarle a `enderezarPixeles` para PROYECTAR un
 *  documento dentro de una foto — la operación inversa a la del escaneo. */
function invertir(destino: Esquina[], ancho: number, alto: number): Esquina[] {
  // Para generar la foto se recorre la foto y se toma del documento, así que las
  // esquinas son las del documento vistas desde el rectángulo de la foto. Se
  // resuelve numéricamente: para cada esquina de la foto, dónde cae en el
  // documento.
  const m = mapaDePerspectiva(destino)!;
  // Las cuatro esquinas de la foto (0..400, 0..480) mapeadas al documento
  // mediante el mapa inverso aproximado por búsqueda: alcanza con las esquinas
  // porque la homografía queda determinada por ellas.
  const buscar = (fx: number, fy: number): Esquina => {
    let mejorU = 0.5;
    let mejorV = 0.5;
    let paso = 0.5;
    for (let it = 0; it < 60; it++) {
      let mejor = Infinity;
      let bu = mejorU;
      let bv = mejorV;
      for (const du of [-paso, 0, paso]) {
        for (const dv of [-paso, 0, paso]) {
          const u = mejorU + du;
          const v = mejorV + dv;
          const p = m(u, v);
          const d = Math.hypot(p.x - fx, p.y - fy);
          if (d < mejor) {
            mejor = d;
            bu = u;
            bv = v;
          }
        }
      }
      mejorU = bu;
      mejorV = bv;
      paso *= 0.7;
    }
    return { x: mejorU * ancho, y: mejorV * alto };
  };
  return [buscar(0, 0), buscar(400, 0), buscar(400, 480), buscar(0, 480)];
}

test("una transformación identidad devuelve la imagen INTACTA, píxel por píxel", () => {
  // La prueba que faltaba, y la que habría atrapado el peor error de este
  // módulo: `muestrear` interpolaba en `x + 0.5` en vez de `x - 0.5`, así que
  // mezclaba cada píxel al 50% con su vecino. **Toda imagen escaneada salía con
  // medio píxel de desenfoque en cada eje.**
  //
  // No se veía: la imagen quedaba apenas más blanda y aun así "parecía un
  // escaneo". Lo que sí se veía era el resultado — contra fotos reales, el
  // único comprobante cuyo QR se leía dejaba de leerse después de escanearlo,
  // con recorte identidad y sin realce. Un QR tiene módulos de tres o cuatro
  // píxeles: medio píxel de mezcla alcanza para romperlo.
  //
  // Con las esquinas en las esquinas y el mismo tamaño de salida, no hay nada
  // que interpolar y el resultado tiene que ser idéntico. Si alguna vez deja de
  // serlo, algo volvió a correrse.
  const orig = documento(64, 96);
  const identidad: Esquina[] = [
    { x: 0, y: 0 },
    { x: 64, y: 0 },
    { x: 64, y: 96 },
    { x: 0, y: 96 },
  ];
  const r = enderezarPixeles(orig, identidad, 64, 96, { realzar: false });
  assert.ok(r);

  let distintos = 0;
  for (let i = 0; i < orig.data.length; i += 4) {
    if (Math.abs(r.data[i] - orig.data[i]) > 0) distintos++;
  }
  assert.equal(distintos, 0, `${distintos} píxeles cambiaron en una identidad`);
});
