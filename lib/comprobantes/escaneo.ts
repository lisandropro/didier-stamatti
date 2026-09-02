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

export type Recuadro = { x0: number; y0: number; x1: number; y1: number };

/**
 * Una propuesta de recorte: la caja donde está el contenido.
 *
 * No es detección de bordes de OpenCV y no pretende serlo. Recorre filas y
 * columnas buscando dónde deja de haber sólo fondo, que resuelve el caso común
 * —el papel más o menos de frente, con mesa alrededor— y falla en el difícil,
 * que es para lo que están las esquinas arrastrables.
 *
 * Devuelve `null` cuando no encuentra nada distinto o cuando el recorte agarra
 * casi toda la foto. En los dos casos proponer un recorte sería peor que no
 * proponerlo: uno recorta al azar y el otro no aporta nada y arriesga comerse un
 * borde.
 */
export function recuadroDeContenido(
  datos: Uint8ClampedArray,
  ancho: number,
  alto: number,
): Recuadro | null {
  if (ancho < 8 || alto < 8) return null;

  const lum = new Float32Array(ancho * alto);
  for (let i = 0; i < ancho * alto; i++) {
    const j = i * 4;
    lum[i] = 0.299 * datos[j] + 0.587 * datos[j + 1] + 0.114 * datos[j + 2];
  }

  // El fondo es la mediana: en una foto de una hoja sobre una mesa, lo que más
  // hay es una de las dos cosas, y la que sea sirve de referencia.
  const orden = Float32Array.from(lum).sort();
  const fondo = orden[Math.floor(orden.length / 2)];
  // Un umbral proporcional al contraste real de la imagen, no un número fijo:
  // una foto a contraluz y una con flash no tienen el mismo rango.
  const p05 = orden[Math.floor(orden.length * 0.05)];
  const p95 = orden[Math.floor(orden.length * 0.95)];
  const umbral = Math.max(18, (p95 - p05) * 0.25);

  const distinto = (i: number) => Math.abs(lum[i] - fondo) > umbral;

  // Una fila o columna cuenta si al menos el 2% de sus píxeles se despegan del
  // fondo. Un píxel suelto es ruido del sensor, no un borde de papel.
  const minFila = Math.max(2, Math.floor(ancho * 0.02));
  const minCol = Math.max(2, Math.floor(alto * 0.02));

  let y0 = -1;
  let y1 = -1;
  for (let y = 0; y < alto; y++) {
    let n = 0;
    for (let x = 0; x < ancho; x++) if (distinto(y * ancho + x)) n++;
    if (n >= minFila) {
      if (y0 === -1) y0 = y;
      y1 = y;
    }
  }

  let x0 = -1;
  let x1 = -1;
  for (let x = 0; x < ancho; x++) {
    let n = 0;
    for (let y = 0; y < alto; y++) if (distinto(y * ancho + x)) n++;
    if (n >= minCol) {
      if (x0 === -1) x0 = x;
      x1 = x;
    }
  }

  if (x0 === -1 || y0 === -1 || x1 <= x0 || y1 <= y0) return null;

  // Si ya ocupa casi todo, recortar no aporta.
  const cubre = ((x1 - x0) * (y1 - y0)) / (ancho * alto);
  if (cubre > 0.9) return null;
  // Y si es minúsculo, encontró una mancha y no una hoja.
  if (cubre < 0.05) return null;

  return { x0, y0, x1, y1 };
}

// ---------------------------------------------------------------------------
// La parte que necesita un navegador
// ---------------------------------------------------------------------------

/** Cuánto se achica la foto para buscar el recuadro. Detectar sobre 12 megapixeles
 *  tarda segundos en un teléfono de gama media; sobre 240 px es instantáneo y la
 *  posición de un borde no necesita más precisión que esa. */
const ANCHO_DE_ANALISIS = 240;

/**
 * Propone las cuatro esquinas del papel dentro de una foto.
 *
 * Devuelve un rectángulo, no un cuadrilátero torcido: sin OpenCV no se detecta
 * la perspectiva de forma confiable, y proponer un cuadrilátero mal calculado es
 * peor que proponer uno recto — el recto se corrige arrastrando una esquina, el
 * torcido hay que arreglarlo entero.
 *
 * `null` cuando no encuentra nada: ahí la pantalla propone el marco por defecto.
 */
export function proponerEsquinas(lienzo: HTMLCanvasElement): Esquina[] | null {
  const escala = Math.min(1, ANCHO_DE_ANALISIS / lienzo.width);
  const ancho = Math.max(8, Math.round(lienzo.width * escala));
  const alto = Math.max(8, Math.round(lienzo.height * escala));

  const chico = document.createElement("canvas");
  chico.width = ancho;
  chico.height = alto;
  const ctx = chico.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(lienzo, 0, 0, ancho, alto);

  const r = recuadroDeContenido(ctx.getImageData(0, 0, ancho, alto).data, ancho, alto);
  if (!r) return null;

  // Un poco de aire: el detector encuentra donde arranca la TINTA, y el borde
  // del papel está un poco más afuera. Comerse el borde es peor que dejar un
  // dedo de mesa.
  const aire = Math.round(Math.min(ancho, alto) * 0.02);
  const x0 = Math.max(0, r.x0 - aire) / escala;
  const y0 = Math.max(0, r.y0 - aire) / escala;
  const x1 = Math.min(ancho - 1, r.x1 + aire) / escala;
  const y1 = Math.min(alto - 1, r.y1 + aire) / escala;

  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** El marco por defecto cuando no se detectó nada: casi toda la foto, con
 *  margen. Se arrastra desde ahí, que es más rápido que desde una esquina. */
export function marcoPorDefecto(ancho: number, alto: number): Esquina[] {
  const mx = ancho * 0.05;
  const my = alto * 0.05;
  return [
    { x: mx, y: my },
    { x: ancho - mx, y: my },
    { x: ancho - mx, y: alto - my },
    { x: mx, y: alto - my },
  ];
}

/** Más allá de esto el archivo pesa de más para lo que aporta: una hoja A4 a
 *  1600 px de ancho ya tiene el CAE legible y el QR decodificable. */
const ANCHO_MAXIMO = 1600;

/**
 * Recorta al cuadrilátero, endereza y blanquea el fondo.
 *
 * Devuelve `null` si no puede: quien llama sube la original. La regla del módulo
 * vale también acá — **nada puede impedir que la foto quede**.
 */
export function enderezar(fuente: HTMLCanvasElement, esquinas: Esquina[]): HTMLCanvasElement | null {
  const ordenadas = ordenarEsquinas(esquinas);
  if (!ordenadas) return null;

  const mapa = mapaDePerspectiva(ordenadas);
  if (!mapa) return null;

  const medida = medidaDeSalida(ordenadas);
  if (medida.ancho < 8 || medida.alto < 8) return null;

  const escala = Math.min(1, ANCHO_MAXIMO / medida.ancho);
  const ancho = Math.round(medida.ancho * escala);
  const alto = Math.round(medida.alto * escala);

  const origen = fuente.getContext("2d", { willReadFrequently: true });
  if (!origen) return null;
  const entrada = origen.getImageData(0, 0, fuente.width, fuente.height);

  const resultado = enderezarPixeles(entrada, ordenadas, ancho, alto);
  if (!resultado) return null;

  const destino = document.createElement("canvas");
  destino.width = ancho;
  destino.height = alto;
  const ctxDestino = destino.getContext("2d");
  if (!ctxDestino) return null;
  const salida = ctxDestino.createImageData(ancho, alto);
  salida.data.set(resultado.data);
  ctxDestino.putImageData(salida, 0, 0);
  return destino;
}

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
  const mapa = mapaDePerspectiva(esquinas);
  if (!mapa || ancho < 1 || alto < 1) return null;

  const data = new Uint8ClampedArray(ancho * alto * 4);
  for (let y = 0; y < alto; y++) {
    // El medio pixel centra la muestra en la celda en vez de en su esquina. Sin
    // eso la imagen queda corrida medio pixel, que a simple vista no se nota
    // pero le come nitidez al texto chico — que aca es el CAE.
    const v = (y + 0.5) / alto;
    for (let x = 0; x < ancho; x++) {
      const p = mapa((x + 0.5) / ancho, v);
      muestrear(entrada, p.x, p.y, data, (y * ancho + x) * 4);
    }
  }

  if (opciones.realzar !== false) realzar(data);
  return { data, width: ancho, height: alto };
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
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) {
    // Fuera de la foto: blanco. Es lo que hay alrededor de una hoja escaneada.
    destino[i] = destino[i + 1] = destino[i + 2] = 255;
    destino[i + 3] = 255;
    return;
  }

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;

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
function realzar(d: Uint8ClampedArray): void {
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

/**
 * De la foto al archivo que se sube.
 *
 * Devuelve `null` ante cualquier problema, y quien llama sube la original.
 */
export async function escanear(fuente: HTMLCanvasElement, esquinas: Esquina[]): Promise<Blob | null> {
  try {
    const derecha = enderezar(fuente, esquinas);
    if (!derecha) return null;
    return await new Promise<Blob | null>((listo) =>
      derecha.toBlob((b) => listo(b), "image/jpeg", 0.85),
    );
  } catch {
    return null;
  }
}
