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
 * Una propuesta de recorte: dónde está el papel.
 *
 * **El papel es lo CLARO.** La primera versión de esto buscaba lo que se
 * despegaba de la mediana, y contra 18 fotos reales acertó **cero veces**: la
 * mediana ES el papel —ocupa casi todo el cuadro— así que la caja se expandía
 * hasta abarcar el fondo oscuro. Estaba exactamente al revés.
 *
 * Ahora: se umbraliza por Otsu, se etiquetan las regiones claras y se toma la
 * más grande **que pase por el centro**. Quien saca la foto apunta al papel que
 * quiere; el del medio es el suyo, aunque atrás haya otros.
 *
 * Y **una cobertura alta no se rechaza**. La versión anterior descartaba todo lo
 * que pasara del 90% "porque recortar no aportaba nada", y contra fotos reales
 * el papel cubre entre el 84% y el 99%: rechazaba justamente la respuesta
 * correcta. Cuando el papel llena el cuadro, la propuesta correcta es el cuadro
 * casi entero.
 *
 * Devuelve `null` cuando no hay una región clara plausible: ahí la pantalla
 * propone el marco por defecto y la persona arrastra.
 */
export function recuadroDeContenido(
  datos: Uint8ClampedArray,
  ancho: number,
  alto: number,
): Recuadro | null {
  if (ancho < 8 || alto < 8) return null;

  const n = ancho * alto;
  const lum = new Float32Array(n);
  const histograma = new Int32Array(256);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const v = 0.299 * datos[j] + 0.587 * datos[j + 1] + 0.114 * datos[j + 2];
    lum[i] = v;
    histograma[Math.round(v)]++;
  }

  const umbralOtsu = otsu(histograma, n);
  // Sin dos grupos no hay nada que separar: una imagen de un solo tono no tiene
  // hoja, y devolver el cuadro entero sería afirmar que se encontró algo.
  if (umbralOtsu === null) return null;
  const umbral = umbralOtsu;

  // Etiquetado por inundación. Sobre la imagen de análisis —240 px de ancho— son
  // unos 76.000 píxeles: instantáneo, y sin recursión para no reventar la pila
  // con una región grande.
  const visto = new Uint8Array(n);
  const pila: number[] = [];
  const cx = ancho / 2;
  const cy = alto / 2;

  let mejorTam = 0;
  let mejor: Recuadro | null = null;

  for (let inicio = 0; inicio < n; inicio++) {
    if (lum[inicio] <= umbral || visto[inicio]) continue;

    let tam = 0;
    let x0 = ancho;
    let y0 = alto;
    let x1 = 0;
    let y1 = 0;
    let pasaPorElCentro = false;

    pila.length = 0;
    pila.push(inicio);
    visto[inicio] = 1;

    while (pila.length > 0) {
      const p = pila.pop()!;
      const px = p % ancho;
      const py = (p - px) / ancho;
      tam++;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      // "El centro" es un rectángulo del 40% central, no un punto: un píxel
      // oscuro justo en el medio —una letra— no puede decidir esto.
      if (Math.abs(px - cx) < ancho * 0.2 && Math.abs(py - cy) < alto * 0.2) {
        pasaPorElCentro = true;
      }

      if (px > 0) empujar(p - 1);
      if (px < ancho - 1) empujar(p + 1);
      if (py > 0) empujar(p - ancho);
      if (py < alto - 1) empujar(p + ancho);
    }

    if (pasaPorElCentro && tam > mejorTam) {
      mejorTam = tam;
      mejor = { x0, y0, x1, y1 };
    }

    function empujar(q: number) {
      if (!visto[q] && lum[q] > umbral) {
        visto[q] = 1;
        pila.push(q);
      }
    }
  }

  if (!mejor || mejor.x1 <= mejor.x0 || mejor.y1 <= mejor.y0) return null;

  const area = (mejor.x1 - mejor.x0) * (mejor.y1 - mejor.y0);
  // Una mancha chica no es una hoja.
  if (area / n < 0.25) return null;
  // Y si la región clara llena su propia caja a menos de la mitad, no es una
  // hoja: es luz dispersa, o dos papeles unidos por un hilo de píxeles.
  if (mejorTam / area < 0.5) return null;

  return mejor;
}

/**
 * El umbral que mejor separa lo claro de lo oscuro, por Otsu.
 *
 * Un número fijo no sirve: una foto a contraluz y una con flash no tienen el
 * mismo rango, y el mismo depósito con la luz prendida o apagada tampoco.
 */
function otsu(histograma: Int32Array, total: number): number | null {
  let suma = 0;
  for (let t = 0; t < 256; t++) suma += t * histograma[t];

  let sumaFondo = 0;
  let pesoFondo = 0;
  let mejorVarianza = 0;
  let umbral: number | null = null;

  for (let t = 0; t < 256; t++) {
    pesoFondo += histograma[t];
    if (pesoFondo === 0) continue;
    const pesoFrente = total - pesoFondo;
    if (pesoFrente === 0) break;

    sumaFondo += t * histograma[t];
    const mediaFondo = sumaFondo / pesoFondo;
    const mediaFrente = (suma - sumaFondo) / pesoFrente;
    const entreClases = pesoFondo * pesoFrente * (mediaFondo - mediaFrente) ** 2;
    if (entreClases > mejorVarianza) {
      mejorVarianza = entreClases;
      umbral = t;
    }
  }
  return umbral;
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

/** Cuántas filas se procesan antes de ceder el hilo. Con 64, cada tanda tarda
 *  unas decenas de milisegundos: bastante para avanzar, poco para que se note. */
const FILAS_POR_BANDA = 64;

/**
 * Recorta al cuadrilátero, endereza, rota y blanquea el fondo.
 *
 * Cede el hilo entre bandas para que la pantalla pueda dibujar el progreso: el
 * bucle tarda segundos a resolución completa, y sin esto el teléfono se queda
 * congelado y quien saca la foto vuelve a tocar.
 *
 * Devuelve `null` si no puede: quien llama sube la original. La regla del módulo
 * vale también acá — **nada puede impedir que la foto quede**.
 */
export async function enderezar(
  fuente: HTMLCanvasElement,
  esquinas: Esquina[],
  opciones: { giro?: 0 | 90 | 180 | 270; alAvanzar?: (fraccion: number) => void } = {},
): Promise<HTMLCanvasElement | null> {
  const ordenadas = ordenarEsquinas(esquinas);
  if (!ordenadas) return null;

  const medida = medidaDeSalida(ordenadas);
  if (medida.ancho < 8 || medida.alto < 8) return null;

  const escala = Math.min(1, ANCHO_MAXIMO / medida.ancho);
  const ancho = Math.round(medida.ancho * escala);
  const alto = Math.round(medida.alto * escala);

  const origen = fuente.getContext("2d", { willReadFrequently: true });
  if (!origen) return null;
  const entrada = origen.getImageData(0, 0, fuente.width, fuente.height);

  const trabajo = crearEnderezador(entrada, ordenadas, ancho, alto);
  if (!trabajo) return null;

  for (let y = 0; y < alto; y += FILAS_POR_BANDA) {
    trabajo.banda(y, y + FILAS_POR_BANDA);
    opciones.alAvanzar?.(Math.min(1, (y + FILAS_POR_BANDA) / alto));
    // `setTimeout(0)` y no `queueMicrotask`: una microtarea NO deja pintar, y el
    // punto de todo esto es que la pantalla pueda dibujar.
    await new Promise((r) => setTimeout(r, 0));
  }

  const resultado = trabajo.terminar(true);

  const derecha = aLienzo(resultado);
  return girar(derecha, opciones.giro ?? 0);
}

function aLienzo(m: Mapa): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = m.width;
  c.height = m.height;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(m.width, m.height);
  img.data.set(m.data);
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Gira la imagen en múltiplos de 90°.
 *
 * Hace falta y no es un lujo: entre las 18 fotos reales del depósito hay una
 * orden de reparación fotografiada de costado, y el enderezado no la corrige —
 * conserva la proporción del papel tal como estaba en la foto. Una factura
 * acostada en la pantalla de quien paga se lee girando la cabeza.
 *
 * Se gira acá, sobre la imagen ya derecha, y no antes: rotar la foto entera
 * costaría otra pasada por todos los píxeles.
 */
export function girar(lienzo: HTMLCanvasElement, grados: 0 | 90 | 180 | 270): HTMLCanvasElement {
  if (grados === 0) return lienzo;

  const vertical = grados === 90 || grados === 270;
  const salida = document.createElement("canvas");
  salida.width = vertical ? lienzo.height : lienzo.width;
  salida.height = vertical ? lienzo.width : lienzo.height;

  const ctx = salida.getContext("2d")!;
  ctx.translate(salida.width / 2, salida.height / 2);
  ctx.rotate((grados * Math.PI) / 180);
  ctx.drawImage(lienzo, -lienzo.width / 2, -lienzo.height / 2);
  return salida;
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

/**
 * De la foto al archivo que se sube.
 *
 * Devuelve `null` ante cualquier problema, y quien llama sube la original.
 */
export async function escanear(
  fuente: HTMLCanvasElement,
  esquinas: Esquina[],
  opciones: { giro?: 0 | 90 | 180 | 270; alAvanzar?: (fraccion: number) => void } = {},
): Promise<Blob | null> {
  try {
    const derecha = await enderezar(fuente, esquinas, opciones);
    if (!derecha) return null;
    return await new Promise<Blob | null>((listo) =>
      derecha.toBlob((b) => listo(b), "image/jpeg", 0.85),
    );
  } catch {
    return null;
  }
}
