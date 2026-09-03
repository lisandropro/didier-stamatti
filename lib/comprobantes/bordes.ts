// Detección de bordes por el método de Canny.
//
// Es el primer paso del pipeline que usan los escáneres de documentos serios
// —CamScanner, Office Lens, el de Dropbox—: en vez de buscar "la región clara
// más grande", se buscan **los bordes del papel**, y después las rectas que los
// forman.
//
// **Por qué se cambió.** La versión anterior umbralizaba por Otsu y devolvía la
// caja del componente claro más grande. Eso da un rectángulo **recto**, y el
// papel casi nunca está recto: con la hoja apenas torcida, la caja incluye mesa
// en las esquinas y corta el papel en los lados. De ahí venía tener que ajustar
// el recorte a mano casi siempre — el ajuste estaba corrigiendo un detector que
// no podía acertar, no un caso difícil.
//
// Todo acá es aritmética sobre un arreglo de píxeles: se prueba sin navegador.

export type Gris = { datos: Float32Array; ancho: number; alto: number };

/** De píxeles RGBA a luminancia. */
export function aGris(datos: Uint8ClampedArray, ancho: number, alto: number): Gris {
  const g = new Float32Array(ancho * alto);
  for (let i = 0; i < ancho * alto; i++) {
    const j = i * 4;
    g[i] = 0.299 * datos[j] + 0.587 * datos[j + 1] + 0.114 * datos[j + 2];
  }
  return { datos: g, ancho, alto };
}

/**
 * Desenfoque gaussiano separable, 5 taps.
 *
 * Va antes de derivar y no es opcional: la derivada amplifica el ruido, y el
 * ruido del sensor de un teléfono en un depósito con poca luz produce bordes
 * falsos por todos lados. Separable —una pasada horizontal y otra vertical— es
 * la misma cuenta que un núcleo de 5×5 pero cinco veces más barata.
 */
export function desenfocar(g: Gris): Gris {
  const { ancho: w, alto: h, datos } = g;
  const k = [0.06136, 0.24477, 0.38774, 0.24477, 0.06136];
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -2; i <= 2; i++) s += k[i + 2] * datos[y * w + Math.min(w - 1, Math.max(0, x + i))];
      tmp[y * w + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -2; i <= 2; i++) s += k[i + 2] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x];
      out[y * w + x] = s;
    }
  }
  return { datos: out, ancho: w, alto: h };
}

export type Gradiente = {
  magnitud: Float32Array;
  /** Dirección cuantizada a 0, 1, 2 o 3 (0°, 45°, 90°, 135°). */
  direccion: Uint8Array;
  ancho: number;
  alto: number;
};

/** Derivadas por Sobel: cuánto cambia el brillo y hacia dónde. */
export function gradiente(g: Gris): Gradiente {
  const { ancho: w, alto: h, datos } = g;
  const magnitud = new Float32Array(w * h);
  const direccion = new Uint8Array(w * h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = datos[i - w - 1], b = datos[i - w], c = datos[i - w + 1];
      const d = datos[i - 1], f = datos[i + 1];
      const p = datos[i + w - 1], q = datos[i + w], r = datos[i + w + 1];

      const gx = a + 2 * d + p - (c + 2 * f + r);
      const gy = a + 2 * b + c - (p + 2 * q + r);
      magnitud[i] = Math.hypot(gx, gy);

      // El ángulo se cuantiza a los cuatro vecinos posibles: la supresión mira
      // los dos píxeles a los lados del borde, y esos son discretos.
      let ang = (Math.atan2(gy, gx) * 180) / Math.PI;
      if (ang < 0) ang += 180;
      direccion[i] = ang < 22.5 || ang >= 157.5 ? 0 : ang < 67.5 ? 1 : ang < 112.5 ? 2 : 3;
    }
  }
  return { magnitud, direccion, ancho: w, alto: h };
}

/**
 * Bordes finos: se queda solo con los máximos locales a lo ancho del borde.
 *
 * Sin esto, el borde de una hoja sale como una banda de tres o cuatro píxeles y
 * la transformada de Hough recibe cuatro rectas casi iguales donde hay una.
 */
export function afinar(gr: Gradiente): Float32Array {
  const { magnitud: m, direccion: d, ancho: w, alto: h } = gr;
  const out = new Float32Array(w * h);
  // Los dos vecinos a comparar según la dirección del gradiente.
  const vecinos = [
    [-1, 0, 1, 0],
    [-1, 1, 1, -1],
    [0, -1, 0, 1],
    [-1, -1, 1, 1],
  ];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const [ax, ay, bx, by] = vecinos[d[i]];
      const a = m[(y + ay) * w + (x + ax)];
      const b = m[(y + by) * w + (x + bx)];
      out[i] = m[i] >= a && m[i] >= b ? m[i] : 0;
    }
  }
  return out;
}

/**
 * Doble umbral con histéresis.
 *
 * Un borde débil se conserva **solo si toca uno fuerte**. Es lo que deja pasar
 * el lado de una hoja que se pone tenue donde le da la sombra, sin dejar pasar
 * la textura de la mesa.
 *
 * Los umbrales salen de la imagen, no son constantes: una foto a contraluz y
 * una con flash no tienen el mismo rango, y un número fijo funciona en una y
 * borra la otra.
 */
export function histeresis(fino: Float32Array, ancho: number, alto: number): Uint8Array {
  const n = ancho * alto;

  // El umbral alto es un percentil de las magnitudes que no son cero: así se
  // adapta al contraste real de cada foto.
  const vivos: number[] = [];
  for (let i = 0; i < n; i += 3) if (fino[i] > 0) vivos.push(fino[i]);
  if (vivos.length === 0) return new Uint8Array(n);
  vivos.sort((a, b) => a - b);
  const alto_ = Math.max(12, vivos[Math.floor(vivos.length * 0.92)]);
  const bajo = alto_ * 0.4;

  const salida = new Uint8Array(n);
  const pila: number[] = [];
  for (let i = 0; i < n; i++) {
    if (fino[i] >= alto_) {
      salida[i] = 1;
      pila.push(i);
    }
  }
  // Se propaga desde los fuertes hacia los débiles conectados.
  while (pila.length > 0) {
    const i = pila.pop()!;
    const x = i % ancho;
    const y = (i - x) / ancho;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= ancho || ny >= alto) continue;
        const j = ny * ancho + nx;
        if (!salida[j] && fino[j] >= bajo) {
          salida[j] = 1;
          pila.push(j);
        }
      }
    }
  }
  return salida;
}

/** El pipeline completo: de píxeles a un mapa de bordes de 0 y 1. */
export function detectarBordes(
  datos: Uint8ClampedArray,
  ancho: number,
  alto: number,
): Uint8Array {
  return histeresis(afinar(gradiente(desenfocar(aGris(datos, ancho, alto)))), ancho, alto);
}
