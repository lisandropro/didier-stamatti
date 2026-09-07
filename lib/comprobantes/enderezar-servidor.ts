import sharp from "sharp";
import {
  ordenarEsquinas,
  medidaDeSalida,
  enderezarPixeles,
  ANCHO_MAXIMO,
  type Esquina,
} from "./escaneo";

// Enderezar el papel, del lado del servidor.
//
// **Por qué se movió acá.** Lo hacía el teléfono, y medido a la resolución real
// de captura tardaba 1,2 s de media y 1,8 s el peor caso — en un iPhone son
// varios segundos de pantalla congelada por cada foto. Con eso encadenar cinco
// comprobantes de un reparto es insoportable, y encadenarlos es justamente lo
// que hace falta.
//
// El teléfono ahora solo manda la foto y las cuatro esquinas que ya venía
// siguiendo en el visor. El trabajo pesado pasa a un lugar donde nadie lo mira
// suceder.
//
// **Es el mismo código.** `enderezarPixeles` es una función pura que toma
// píxeles: la misma que corre en el navegador y la que se usó para medir contra
// las 18 fotos reales. Lo único que cambia es quién le da los píxeles — acá
// `sharp`, que ya venía instalado con Next.

/** El resultado de enderezar, listo para subir. */
export type Enderezada = { jpeg: Buffer; ancho: number; alto: number };

/**
 * Recorta al cuadrilátero, endereza y blanquea el fondo.
 *
 * Devuelve `null` si no puede — esquinas imposibles, imagen ilegible—, y quien
 * llama se queda con la original. La regla del módulo vale también acá: **nada
 * puede impedir que la foto quede**.
 */
export async function enderezarEnServidor(
  jpegOriginal: Buffer,
  esquinasCrudas: unknown,
): Promise<Enderezada | null> {
  try {
    const { data, info } = await sharp(jpegOriginal)
      // A RGBA sin comprimir, que es lo que espera `enderezarPixeles`.
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const entrada = {
      data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
      width: info.width,
      height: info.height,
    };

    // Las esquinas se validan acá, donde recién ahora se conoce el tamaño real
    // de la foto: vienen de un cliente y podrían decir cualquier cosa.
    const esquinas = leerEsquinas(esquinasCrudas, info.width, info.height);
    if (!esquinas) return null;
    const ordenadas = ordenarEsquinas(esquinas);
    if (!ordenadas) return null;

    const medida = medidaDeSalida(ordenadas);
    if (medida.ancho < 8 || medida.alto < 8) return null;

    const escala = Math.min(1, ANCHO_MAXIMO / medida.ancho);
    const ancho = Math.round(medida.ancho * escala);
    const alto = Math.round(medida.alto * escala);

    const salida = enderezarPixeles(entrada, ordenadas, ancho, alto);
    if (!salida) return null;

    const jpeg = await sharp(Buffer.from(salida.data), {
      raw: { width: ancho, height: alto, channels: 4 },
    })
      // `mozjpeg` comprime bastante mejor a la misma calidad visual, y estas
      // fotos se guardan por años.
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();

    return { jpeg, ancho, alto };
  } catch {
    // Una imagen que no se pudo leer no puede tumbar la captura.
    return null;
  }
}

/**
 * Las esquinas tal como las manda el navegador.
 *
 * Vienen de un cliente, así que se validan como todo lo que viene de un cliente:
 * cuatro puntos, números finitos, y dentro de la foto. Un cuadrilátero inventado
 * no puede hacer más daño que un recorte feo —la original siempre se guarda—
 * pero tampoco hay razón para aceptarlo.
 */
export function leerEsquinas(crudo: unknown, ancho: number, alto: number): Esquina[] | null {
  if (typeof crudo !== "string" || crudo === "") return null;
  let v: unknown;
  try {
    v = JSON.parse(crudo);
  } catch {
    return null;
  }
  if (!Array.isArray(v) || v.length !== 4) return null;

  const puntos: Esquina[] = [];
  for (const p of v) {
    if (typeof p !== "object" || p === null) return null;
    const { x, y } = p as { x: unknown; y: unknown };
    if (typeof x !== "number" || typeof y !== "number") return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    // Un poco de margen: el detector puede dar una esquina apenas afuera.
    const m = Math.max(ancho, alto) * 0.05;
    if (x < -m || y < -m || x > ancho + m || y > alto + m) return null;
    puntos.push({ x: Math.max(0, Math.min(ancho, x)), y: Math.max(0, Math.min(alto, y)) });
  }
  return puntos;
}
