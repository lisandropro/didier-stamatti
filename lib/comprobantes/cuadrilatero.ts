import type { Esquina } from "./escaneo";
import { detectarBordes } from "./bordes";

// Encuentra las cuatro esquinas del papel.
//
// Es el pipeline que usan los escáneres de documentos serios, y el motivo de
// usarlo es concreto: el detector anterior devolvía un **rectángulo recto**, y
// el papel casi nunca está recto. Con la hoja apenas torcida, la caja metía mesa
// en las esquinas y cortaba el papel en los lados — por eso había que ajustar el
// recorte casi siempre.
//
//     bordes (Canny) → rectas (Hough) → dos familias ⊥ → intersecar → puntuar
//
// La idea de fondo: el borde de una hoja es **una recta larga**. La textura de
// una mesa, las letras y los pliegues producen bordes cortos y desordenados que
// no acumulan votos en la transformada. Buscar rectas en vez de regiones es lo
// que separa el papel del resto.

/** Una recta en forma normal: `x·cos θ + y·sin θ = ρ`. Se usa esta y no
 *  `y = mx + b` porque aquella no puede representar una recta vertical. */
type Recta = {
  rho: number;
  theta: number;
  votos: number;
  /** Es un borde de la foto, no un borde de papel encontrado. */
  esBorde?: boolean;
};

const GRADOS = Math.PI / 180;

/**
 * Transformada de Hough: de píxeles de borde a rectas.
 *
 * Cada píxel de borde vota por todas las rectas que pasan por él. Donde muchos
 * píxeles alineados votan por la misma, se acumula un pico — y eso es una recta
 * larga, que es lo que buscamos.
 */
function rectas(bordes: Uint8Array, ancho: number, alto: number, cuantas: number): Recta[] {
  const PASO_THETA = 2; // grados
  const nTheta = Math.floor(180 / PASO_THETA);
  const diag = Math.ceil(Math.hypot(ancho, alto));
  const nRho = diag * 2;

  const cos = new Float32Array(nTheta);
  const sin = new Float32Array(nTheta);
  for (let t = 0; t < nTheta; t++) {
    cos[t] = Math.cos(t * PASO_THETA * GRADOS);
    sin[t] = Math.sin(t * PASO_THETA * GRADOS);
  }

  const acum = new Int32Array(nTheta * nRho);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      if (!bordes[y * ancho + x]) continue;
      for (let t = 0; t < nTheta; t++) {
        const r = Math.round(x * cos[t] + y * sin[t]) + diag;
        if (r >= 0 && r < nRho) acum[t * nRho + r]++;
      }
    }
  }

  // Se exige un mínimo de votos proporcional al tamaño: un lado de hoja cruza
  // buena parte de la imagen, y pedir menos deja entrar cualquier rayita.
  const minVotos = Math.max(14, Math.round(Math.min(ancho, alto) * 0.25));

  const picos: Recta[] = [];
  for (let t = 0; t < nTheta; t++) {
    for (let r = 1; r < nRho - 1; r++) {
      const v = acum[t * nRho + r];
      if (v < minVotos) continue;
      // Máximo local: sin esto, una sola recta aparece como veinte casi iguales.
      if (v < acum[t * nRho + r - 1] || v < acum[t * nRho + r + 1]) continue;
      picos.push({ rho: r - diag, theta: t * PASO_THETA * GRADOS, votos: v });
    }
  }

  picos.sort((a, b) => b.votos - a.votos);

  // Se descartan las que son casi la misma recta que una ya elegida.
  const elegidas: Recta[] = [];
  for (const p of picos) {
    if (elegidas.length >= cuantas) break;
    const repetida = elegidas.some(
      (e) => Math.abs(e.rho - p.rho) < Math.min(ancho, alto) * 0.08 && anguloEntre(e.theta, p.theta) < 12 * GRADOS,
    );
    if (!repetida) elegidas.push(p);
  }
  return elegidas;
}

/**
 * Los cuatro bordes de la foto, como rectas candidatas.
 *
 * Sirven para el caso en que **el papel se sale del cuadro**: un ticket largo,
 * una factura que no entró entera. Ahí no hay un borde de papel que encontrar
 * arriba o abajo, y sin esto el detector no arma ningún cuadrilátero — se rinde
 * justo cuando lo que hay que recortar son los costados.
 *
 * Van con pocos votos a propósito: compiten, pero cualquier borde de papel real
 * les gana. Si el papel está entero adentro, estas no se eligen.
 */
function bordesDelCuadro(ancho: number, alto: number): Recta[] {
  const votos = Math.round(Math.min(ancho, alto) * 0.3);
  const b = (rho: number, theta: number) => ({ rho, theta, votos, esBorde: true });
  return [
    b(0, 90 * GRADOS),      // arriba
    b(alto, 90 * GRADOS),   // abajo
    b(0, 0),                // izquierda
    b(ancho, 0),            // derecha
  ];
}

/** La diferencia entre dos ángulos de recta, teniendo en cuenta que θ y θ+180°
 *  son la misma dirección. */
function anguloEntre(a: number, b: number): number {
  let d = Math.abs(a - b) % Math.PI;
  return d > Math.PI / 2 ? Math.PI - d : d;
}

/** Dónde se cruzan dos rectas, o `null` si son casi paralelas. */
function interseccion(a: Recta, b: Recta): Esquina | null {
  const det = Math.cos(a.theta) * Math.sin(b.theta) - Math.sin(a.theta) * Math.cos(b.theta);
  if (Math.abs(det) < 1e-6) return null;
  return {
    x: (a.rho * Math.sin(b.theta) - b.rho * Math.sin(a.theta)) / det,
    y: (b.rho * Math.cos(a.theta) - a.rho * Math.cos(b.theta)) / det,
  };
}

export type Deteccion = {
  esquinas: [Esquina, Esquina, Esquina, Esquina];
  /** De 0 a 1. Por debajo de 0,60 no se devuelve nada. */
  confianza: number;
};

/**
 * Las cuatro esquinas del papel, o `null` si no hay un cuadrilátero creíble.
 *
 * Devolver `null` es una respuesta válida y frecuente: es mejor no dibujar nada
 * que dibujar un marco equivocado, porque el marco equivocado se cree.
 */
export function detectarCuadrilatero(
  datos: Uint8ClampedArray,
  ancho: number,
  alto: number,
): Deteccion | null {
  const bordes = detectarBordes(datos, ancho, alto);
  const todas = [...rectas(bordes, ancho, alto, 12), ...bordesDelCuadro(ancho, alto)];
  if (todas.length < 4) return null;

  // Las rectas se parten en dos familias perpendiculares: los lados de arriba y
  // abajo por un lado, los de los costados por el otro. Un papel siempre da
  // esto; un fondo desordenado, no — y ahí devolvemos null.
  const mejor = mejorCuadrilatero(todas, ancho, alto);
  return mejor;
}

function mejorCuadrilatero(rs: Recta[], ancho: number, alto: number): Deteccion | null {
  let campeon: Deteccion | null = null;

  // Se prueban las combinaciones de cuatro rectas. Con 14 candidatas son unas
  // mil combinaciones, que a este tamaño es instantáneo.
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      // Dos rectas casi paralelas: candidatas a ser lados opuestos.
      if (anguloEntre(rs[i].theta, rs[j].theta) > 25 * GRADOS) continue;

      for (let k = 0; k < rs.length; k++) {
        if (k === i || k === j) continue;
        for (let l = k + 1; l < rs.length; l++) {
          if (l === i || l === j) continue;
          if (anguloEntre(rs[k].theta, rs[l].theta) > 25 * GRADOS) continue;
          // Y las dos familias tienen que ser perpendiculares entre sí.
          if (anguloEntre(rs[i].theta, rs[k].theta) < 55 * GRADOS) continue;

          const c = esquinasDe(rs[i], rs[j], rs[k], rs[l], ancho, alto);
          if (!c) continue;
          if (!campeon || c.confianza > campeon.confianza) campeon = c;
        }
      }
    }
  }

  // **0,60 y no menos, y el número está mirado.** Contra las 18 fotos reales,
  // los cuadriláteros correctos puntúan 0,64 a 0,80 y los equivocados 0,49 a
  // 0,58 — y los equivocados son todos el mismo caso: un ticket angosto que se
  // sale del cuadro, donde el detector agarra una franja cualquiera.
  //
  // Bajar el umbral sube el conteo de detecciones y empeora el producto: un
  // marco equivocado se cree, y quien saca la foto guarda un recorte que se
  // comió media factura. Cuando no hay confianza, no se dibuja nada y la persona
  // ajusta a mano — que es el caso raro, no el habitual.
  return campeon && campeon.confianza >= 0.6 ? campeon : null;
}

/** Arma el cuadrilátero de cuatro rectas y lo puntúa. */
function esquinasDe(
  a: Recta,
  b: Recta,
  c: Recta,
  d: Recta,
  ancho: number,
  alto: number,
): Deteccion | null {
  const p = [interseccion(a, c), interseccion(a, d), interseccion(b, d), interseccion(b, c)];
  if (p.some((q) => q === null)) return null;
  const pts = p as Esquina[];

  // Fuera de la imagen con margen: una esquina a tres pantallas de distancia
  // significa que las rectas eran casi paralelas.
  const margen = Math.max(ancho, alto) * 0.35;
  if (pts.some((q) => q.x < -margen || q.y < -margen || q.x > ancho + margen || q.y > alto + margen)) {
    return null;
  }

  const orden = enOrden(pts);
  if (!orden) return null;

  const area = areaDe(orden);
  const cobertura = area / (ancho * alto);
  // Un papel fotografiado para leerlo ocupa buena parte del cuadro. Un
  // cuadrilátero diminuto es una baldosa; uno gigante son los bordes de la foto.
  if (cobertura < 0.18 || cobertura > 1.05) return null;

  // Los ángulos de una hoja, aun en perspectiva, no se alejan tanto de 90°.
  const angulos = angulosDe(orden);
  const desvio = angulos.reduce((s, g) => s + Math.abs(g - 90), 0) / 4;
  if (desvio > 32) return null;

  // La puntuación pesa tres cosas: que los lados estén respaldados por muchos
  // píxeles de borde, que cubra bastante, y que los ángulos sean rectos.
  // **Cuántos lados son bordes de la foto y no bordes de papel.**
  //
  // Sin esta cuenta, agregar los bordes del cuadro como candidatos subió la
  // detección de 11/18 a 18/18 — y al mirarlas, varias de las "recuperadas"
  // marcaban una franja cualquiera, no el papel. Los bordes dan votos gratis,
  // así que un cuadrilátero armado casi todo con ellos puntúa bien sin haber
  // encontrado nada.
  //
  // Con tres o cuatro bordes, lo detectado es "la foto entera": eso no es una
  // detección y se descarta. Con uno o dos, es un papel que se sale del cuadro
  // —el caso legítimo— pero la confianza baja, porque hay menos evidencia real.
  const bordes = [a, b, c, d].filter((r) => r.esBorde).length;
  if (bordes >= 3) return null;

  const reales = [a, b, c, d].filter((r) => !r.esBorde);
  const votos = reales.reduce((s, r) => s + r.votos, 0) / Math.max(1, reales.length);
  const porVotos = Math.min(1, votos / (Math.min(ancho, alto) * 0.8));
  const porCobertura = Math.min(1, cobertura / 0.7);
  const porAngulos = Math.max(0, 1 - desvio / 32);
  const penalidad = bordes === 0 ? 1 : bordes === 1 ? 0.85 : 0.7;

  return {
    esquinas: orden,
    confianza: (porVotos * 0.45 + porCobertura * 0.2 + porAngulos * 0.35) * penalidad,
  };
}

/** Ordena cuatro puntos en sentido horario desde la superior izquierda, y
 *  devuelve `null` si no forman un cuadrilátero convexo. */
function enOrden(p: Esquina[]): [Esquina, Esquina, Esquina, Esquina] | null {
  const cx = (p[0].x + p[1].x + p[2].x + p[3].x) / 4;
  const cy = (p[0].y + p[1].y + p[2].y + p[3].y) / 4;
  const orden = [...p].sort(
    (u, v) => Math.atan2(u.y - cy, u.x - cx) - Math.atan2(v.y - cy, v.x - cx),
  );
  // Se empieza por la esquina más cercana al origen, que es la superior izq.
  let inicio = 0;
  let mejor = Infinity;
  orden.forEach((q, i) => {
    const d = q.x + q.y;
    if (d < mejor) {
      mejor = d;
      inicio = i;
    }
  });
  const c = [0, 1, 2, 3].map((i) => orden[(inicio + i) % 4]) as [Esquina, Esquina, Esquina, Esquina];

  // Convexo: todos los giros van para el mismo lado. Un cuadrilátero cruzado da
  // un área que parece razonable y una imagen doblada sobre sí misma.
  let signo = 0;
  for (let i = 0; i < 4; i++) {
    const o = c[i];
    const q = c[(i + 1) % 4];
    const r = c[(i + 2) % 4];
    const cruz = (q.x - o.x) * (r.y - q.y) - (q.y - o.y) * (r.x - q.x);
    if (cruz === 0) continue;
    const s = Math.sign(cruz);
    if (signo === 0) signo = s;
    else if (s !== signo) return null;
  }
  return c;
}

function areaDe(c: [Esquina, Esquina, Esquina, Esquina]): number {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i];
    const b = c[(i + 1) % 4];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

function angulosDe(c: [Esquina, Esquina, Esquina, Esquina]): number[] {
  return c.map((_, i) => {
    const p = c[(i + 3) % 4];
    const q = c[i];
    const r = c[(i + 1) % 4];
    const a = Math.atan2(p.y - q.y, p.x - q.x);
    const b = Math.atan2(r.y - q.y, r.x - q.x);
    let g = Math.abs((a - b) * (180 / Math.PI)) % 360;
    if (g > 180) g = 360 - g;
    return g;
  });
}
