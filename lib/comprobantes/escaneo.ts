// Convierte la foto de un papel en algo que parece un escaneo.
//
// Lo que llega es un papel arrugado, de costado, en una carpeta de anillos y con
// la sombra de quien la saca encima. Lo que se archiva tiene que estar recortado
// al borde de la hoja, derecho y con fondo blanco.
//
// **No es maquillaje.** Aldana está en otra oficina y no puede ir a mirar el
// papel; y una imagen enderezada y con contraste sube la tasa de lectura del QR
// —hoy medida en 28% sobre fotos casuales— y mejora la extracción por IA. El
// escaneo alimenta al resto del sistema, no solo a la vista.
//
// **Lo que NO se hace acá es generar un documento nuevo a partir de los datos
// leídos.** Un PDF reconstruido se ve más confiable que una foto borrosa pero
// contiene lo que la IA leyó, y un error quedaría lavado dentro de algo con
// aspecto de comprobante fiscal. Se procesa el original; no se dibuja otro.
//
// ---------------------------------------------------------------------------
//
// **Por qué esto no usa `jscanify`, que era lo que decía el plan.**
//
// `jscanify` trae OpenCV compilado a WASM: 30 MB, y además arrastra `canvas`
// —un binding nativo que necesita cairo y pango en el sistema— y `jsdom`. Los
// dos son irrelevantes en el navegador, pero se instalan igual y pueden romper
// el build de Railway.
//
// Treinta megas para encontrar cuatro esquinas, en un teléfono de depósito que
// puede estar con datos móviles, cuando el propio plan ya exigía que las
// esquinas se pudieran arrastrar a mano porque la detección automática falla
// seguido. La matemática del enderezado son ochenta líneas conocidas, se prueba
// sin navegador, y no pesa nada.
//
// Lo que se pierde: la detección automática de OpenCV, que es mejor que la de
// acá. Lo que se gana: que la app siga pesando lo que pesa. El arrastre —que
// iba a existir de todos modos— cubre la diferencia.

// ---------------------------------------------------------------------------
//
// **El QR no se lee de esta imagen.** Se lee en vivo en el visor, del cuadro de
// video, y viaja con la captura (`app/actions/comprobantes.ts`). Nada vuelve a
// decodificar el archivo guardado.
//
// Vale anotarlo porque medir "cuantos QR sobreviven al escaneo" es una trampa
// que se pisa sola: sobre las 18 fotos reales el enderezado baja de 6 de 6 a
// 2 de 6, y eso NO es una regresion de nada. El dato ya se leyo, y la original
// se archiva entera al lado de la escaneada.
//
// Aislado con un decodificador serio (zxing), variando una cosa por vez:
//
//     recorte identidad, con y sin realce      6 de 6
//     recorte detectado, con y sin realce      2 de 6
//     idem sin el tope de 2400 px              2 de 6
//
// O sea: el realce es inocente y el achicado tambien. Es la interpolacion
// bilineal de la perspectiva, que ablanda los modulos de un QR de tres pixeles.
// Agrandar el recorte no cambia nada —probado a 2%, 4% y 6%: el recorte ya toma
// casi todo el cuadro, no hay borde que cortar— y afilar despues recupera una
// foto y rompe otra. No hay nada que arreglar aca.

export type Esquina = { x: number; y: number };

/**
 * Ordena cuatro puntos como superior-izquierda, superior-derecha,
 * inferior-derecha, inferior-izquierda.
 *
 * El truco es viejo y funciona con cualquier cuadrilátero convexo: la suma
 * `x + y` es mínima en la esquina superior izquierda y máxima en la inferior
 * derecha; la posición horizontal separa las otras dos.
 *
 * Equivocarse acá no rompe nada visiblemente: la imagen sale rotada o espejada
 * y "parece un escaneo" igual. Por eso tiene prueba propia.
 */
export function ordenarEsquinas(
  puntos: Esquina[],
): [Esquina, Esquina, Esquina, Esquina] | null {
  if (!Array.isArray(puntos) || puntos.length !== 4) return null;

  const porSuma = [...puntos].sort((a, b) => a.x + a.y - (b.x + b.y));
  const supIzq = porSuma[0];
  const infDer = porSuma[3];

  const resto = puntos.filter((p) => p !== supIzq && p !== infDer);
  if (resto.length !== 2) return null;
  const [supDer, infIzq] = resto[0].x > resto[1].x ? resto : [resto[1], resto[0]];

  return [supIzq, supDer, infDer, infIzq];
}

/**
 * El tamaño de la imagen enderezada.
 *
 * De cada par de lados opuestos se toma el **más largo**: si un borde quedó
 * escorzado por el ángulo de la foto, usar el corto achataría la hoja y con ella
 * los renglones, que es justo lo que después hay que leer.
 */
export function medidaDeSalida(esquinas: Esquina[]): { ancho: number; alto: number } {
  const [si, sd, id, ii] = esquinas;
  const dist = (a: Esquina, b: Esquina) => Math.hypot(a.x - b.x, a.y - b.y);
  return {
    ancho: Math.round(Math.max(dist(si, sd), dist(ii, id))),
    alto: Math.round(Math.max(dist(si, ii), dist(sd, id))),
  };
}

/**
 * El mapa de perspectiva: del rectángulo de salida al cuadrilátero del papel.
 *
 * Devuelve una función que toma coordenadas del destino en `[0,1]×[0,1]` y
 * devuelve el punto de la foto original que le corresponde. Va en ese sentido
 * —destino a origen— porque así se recorre el destino pixel por pixel sin dejar
 * agujeros; al revés quedan huecos entre los píxeles proyectados.
 *
 * Es la forma cerrada del mapeo del cuadrado unitario a un cuadrilátero. No hace
 * falta resolver un sistema de 8×8: con los cuatro puntos alcanza.
 *
 * Devuelve `null` cuando los cuatro puntos no forman un cuadrilátero. Devolver
 * un mapa igual daría una imagen de un solo color, que "parece un escaneo" y no
 * lo es.
 */
export function mapaDePerspectiva(
  esquinas: Esquina[],
): ((u: number, v: number) => Esquina) | null {
  if (esquinas.length !== 4) return null;
  const [p0, p1, p2, p3] = esquinas;

  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;

  let a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number;

  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    // Paralelogramo: el mapeo es afín y no hay término de perspectiva.
    a = p1.x - p0.x;
    b = p2.x - p1.x;
    c = p0.x;
    d = p1.y - p0.y;
    e = p2.y - p1.y;
    f = p0.y;
    g = 0;
    h = 0;
  } else {
    const den = dx1 * dy2 - dy1 * dx2;
    // Denominador cero = los puntos son colineales o coincidentes: no hay hoja.
    if (Math.abs(den) < 1e-9) return null;
    g = (dx3 * dy2 - dy3 * dx2) / den;
    h = (dx1 * dy3 - dy1 * dx3) / den;
    a = p1.x - p0.x + g * p1.x;
    b = p3.x - p0.x + h * p3.x;
    c = p0.x;
    d = p1.y - p0.y + g * p1.y;
    e = p3.y - p0.y + h * p3.y;
    f = p0.y;
  }

  // Un cuadrilátero de área cero tampoco sirve, y los coeficientes salen todos
  // en cero sin que nada avise.
  if (Math.abs(a) < 1e-9 && Math.abs(b) < 1e-9 && Math.abs(d) < 1e-9 && Math.abs(e) < 1e-9) {
    return null;
  }

  return (u, v) => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w };
  };
}

/**
 * El nivel de gris que hay que llevar a blanco.
 *
 * Se estima del propio papel con un percentil alto, **no con el píxel más
 * claro**: un reflejo del flash es un puñado de píxeles a 255, y tomarlos como
 * referencia dejaría el papel gris.
 *
 * Nunca devuelve cero: dividir por cero mandaría todos los píxeles a infinito y
 * saldría una imagen blanca vacía — el comprobante desaparecería sin que nada
 * avise.
 */
export function puntoBlanco(datos: Uint8ClampedArray): number {
  const muestras: number[] = [];
  // Se muestrea salteado y con paso primo para no caer siempre en la misma
  // columna, que en una tabla daría una muestra sesgada.
  const paso = 4 * 97;
  for (let i = 0; i + 2 < datos.length; i += paso) {
    muestras.push(0.299 * datos[i] + 0.587 * datos[i + 1] + 0.114 * datos[i + 2]);
  }
  if (muestras.length === 0) return 255;
  muestras.sort((x, y) => x - y);
  const p90 = muestras[Math.min(muestras.length - 1, Math.floor(muestras.length * 0.9))];
  return Math.max(1, p90);
}
/**
 * El ancho máximo de la imagen escaneada.
 *
 * **2400 y no 1600, y el número está medido.** Con un banco de 12 QR de AFIP a
 * escala real —distintos tamaños de impresión, con y sin desenfoque, con tinta
 * gastada— achicar a 1600 px perdía 2; a 2400 no perdía ninguno. El realce, en
 * cambio, no cambió el resultado en ninguna combinación: lo que rompe el código
 * es el achicado, no el contraste.
 *
 * Sube el peso del archivo alrededor de un 50%, y vale la pena: un QR perdido
 * manda el comprobante a carga manual, que es lo que este módulo vino a evitar.
 */
export const ANCHO_MAXIMO = 2400;

/**
 * Recorta al cuadrilátero, endereza y blanquea el fondo.
 *
 * Devuelve `null` si no puede: quien llama sube la original. La regla del módulo
 * vale también acá — **nada puede impedir que la foto quede**.
 */
/** Una imagen, sin depender de que exista un navegador. */
export type Mapa = { data: Uint8ClampedArray; width: number; height: number };

/**
 * El nucleo: recorre el destino pixel por pixel y toma de la foto el color que
 * corresponde.
 *
 * Vive separado del canvas para poder probarlo de verdad — deformando un
 * documento conocido y comprobando que el enderezado lo recupera. Una prueba de
 * "se ve linda" no existe; esta si.
 */
export function enderezarPixeles(
  entrada: Mapa,
  esquinas: Esquina[],
  ancho: number,
  alto: number,
  opciones: { realzar?: boolean } = {},
): Mapa | null {
  const trabajo = crearEnderezador(entrada, esquinas, ancho, alto);
  if (!trabajo) return null;
  trabajo.banda(0, alto);
  return trabajo.terminar(opciones.realzar !== false);
}

/**
 * El mismo trabajo, partido en bandas de filas.
 *
 * Existe porque este bucle **bloquea el hilo**. Medido contra fotos reales del
 * deposito: 700 ms a 1500 px de ancho, y mas de 2 s a resolucion completa. En un
 * telefono de gama media eso son varios segundos con la pantalla congelada y sin
 * ninguna senal — que se lee como "se colgo" y termina en un segundo toque.
 *
 * Partirlo permite ceder el hilo entre bandas y mostrar que algo esta pasando.
 */
export function crearEnderezador(
  entrada: Mapa,
  esquinas: Esquina[],
  ancho: number,
  alto: number,
): { banda(desde: number, hasta: number): void; terminar(realzar: boolean): Mapa } | null {
  const mapa = mapaDePerspectiva(esquinas);
  if (!mapa || ancho < 1 || alto < 1) return null;

  const data = new Uint8ClampedArray(ancho * alto * 4);

  return {
    banda(desde: number, hasta: number) {
      recorrer(entrada, mapa, data, ancho, alto, desde, Math.min(alto, hasta));
    },
    terminar(realzar: boolean) {
      if (realzar) realzarDatos(data);
      return { data, width: ancho, height: alto };
    },
  };
}

function recorrer(
  entrada: Mapa,
  mapa: (u: number, v: number) => Esquina,
  data: Uint8ClampedArray,
  ancho: number,
  alto: number,
  desde: number,
  hasta: number,
): void {
  for (let y = desde; y < hasta; y++) {
    // El medio pixel centra la muestra en la celda en vez de en su esquina.
    const v = (y + 0.5) / alto;
    for (let x = 0; x < ancho; x++) {
      const p = mapa((x + 0.5) / ancho, v);
      muestrear(entrada, p.x, p.y, data, (y * ancho + x) * 4);
    }
  }
}

/**
 * Muestreo bilineal: el color se interpola entre los cuatro píxeles vecinos.
 *
 * Tomar el píxel más cercano y listo sería más rápido y dejaría el texto con
 * escalones. En una factura eso es la diferencia entre leer un 3 y leer un 8.
 */
function muestrear(
  img: Mapa,
  x: number,
  y: number,
  destino: Uint8ClampedArray,
  i: number,
): void {
  const { width: w, height: h, data: d } = img;
  // El límite es `w`, no `w - 1`. La coordenada es CONTINUA: el píxel `w-1`
  // ocupa `[w-1, w)`, así que un punto en 63.5 de una imagen de 64 está adentro.
  // Comparando contra `w - 1` la última fila y la última columna de toda imagen
  // escaneada salían en blanco — un borde de un píxel, invisible, y aun así
  // mal. Lo agarró la prueba de identidad.
  if (x < 0 || y < 0 || x > w || y > h) {
    // Fuera de la foto: blanco. Es lo que hay alrededor de una hoja escaneada.
    destino[i] = destino[i + 1] = destino[i + 2] = 255;
    destino[i + 3] = 255;
    return;
  }

  // **El medio pixel se RESTA acá.** El mapa devuelve una coordenada continua,
  // donde el pixel `i` ocupa `[i, i+1)` y su centro esta en `i+0.5`. La grilla
  // de interpolacion, en cambio, esta en los CENTROS. Sin este ajuste, una
  // transformacion identidad interpolaba cada pixel al 50% con su vecino: la
  // imagen entera salia con medio pixel de desenfoque en cada eje.
  //
  // No se veia. Lo que se veia era el resultado: de 18 comprobantes reales, el
  // unico cuyo QR se leia dejaba de leerse despues de escanearlo — con recorte
  // identidad y sin realce. Un QR tiene modulos de tres o cuatro pixeles, asi
  // que medio pixel de mezcla alcanza para romperlo.
  const cx = x - 0.5;
  const cy = y - 0.5;
  const x0 = Math.max(0, Math.floor(cx));
  const y0 = Math.max(0, Math.floor(cy));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, cx - x0));
  const fy = Math.max(0, Math.min(1, cy - y0));

  const a = (y0 * w + x0) * 4;
  const b = (y0 * w + x1) * 4;
  const c = (y1 * w + x0) * 4;
  const e = (y1 * w + x1) * 4;

  for (let k = 0; k < 3; k++) {
    const arriba = d[a + k] * (1 - fx) + d[b + k] * fx;
    const abajo = d[c + k] * (1 - fx) + d[e + k] * fx;
    destino[i + k] = arriba * (1 - fy) + abajo * fy;
  }
  destino[i + 3] = 255;
}

/**
 * Fondo blanco y texto negro, **sin binarizar**.
 *
 * Un umbral duro —blanco o negro y nada en el medio— se ve muy prolijo y
 * arruina el QR y los sellos. Acá se estira el contraste dejando los grises: el
 * papel se va a blanco, la tinta a negro, y lo que estaba en el medio sobrevive.
 */
function realzarDatos(d: Uint8ClampedArray): void {
  const blanco = puntoBlanco(d);
  // Una pizca por debajo del punto blanco para que el papel llegue a 255 limpio,
  // sin llevarse la tinta clara puesta.
  const factor = 255 / (blanco * 0.94);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, d[i] * factor);
    d[i + 1] = Math.min(255, d[i + 1] * factor);
    d[i + 2] = Math.min(255, d[i + 2] * factor);
  }
}
