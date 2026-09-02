// Leer el QR de la cámara, también en iPhone.
//
// **El problema que resuelve.** La pantalla de captura usaba `BarcodeDetector`,
// que es una API del navegador y **no existe en Safari**. Las 18 fotos reales
// del depósito son `.HEIC`: salieron de un iPhone. O sea que en los teléfonos
// que este equipo usa de verdad, el lector de QR nunca corrió ni una vez — la
// rama `if (!Detector) return` se tomaba siempre, en silencio, y todos los
// comprobantes caían al peldaño más caro de la cascada.
//
// No se veía porque no hay error: simplemente no se leía nada, y como muchas
// facturas tampoco traen QR, el resultado era indistinguible de "esta no tenía".
//
// Cuando `BarcodeDetector` está (Android, Chrome de escritorio) se usa ese, que
// es mejor y no cuesta nada. Cuando no está, se carga jsQR — 280 KB, sin
// dependencias, y **solo en los teléfonos que lo necesitan**.

export type LectorQr = { leer(fuente: HTMLVideoElement | HTMLCanvasElement): Promise<string[]> };

type Nativo = { detect(s: CanvasImageSource): Promise<{ rawValue: string }[]> };

/**
 * El mejor lector disponible en este navegador.
 *
 * Devuelve `null` solo si no hay ninguno, que hoy no debería pasar en ningún
 * navegador con cámara.
 */
export async function crearLectorQr(): Promise<LectorQr | null> {
  const Nativo = (globalThis as unknown as { BarcodeDetector?: new (o: unknown) => Nativo })
    .BarcodeDetector;

  if (Nativo) {
    const detector = new Nativo({ formats: ["qr_code"] });
    return {
      async leer(fuente) {
        try {
          return (await detector.detect(fuente)).map((c) => c.rawValue);
        } catch {
          // Un cuadro borroso no es un error: se prueba con el siguiente.
          return [];
        }
      },
    };
  }

  let jsQR: typeof import("jsqr").default;
  try {
    ({ default: jsQR } = await import("jsqr"));
  } catch {
    return null;
  }

  // jsQR necesita píxeles, así que hay que pasar por un lienzo. Se reusa uno
  // solo: crear uno por cuadro llena la memoria del teléfono en segundos.
  const lienzo = document.createElement("canvas");
  const ctx = lienzo.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  return {
    async leer(fuente) {
      const ancho = fuente instanceof HTMLVideoElement ? fuente.videoWidth : fuente.width;
      const alto = fuente instanceof HTMLVideoElement ? fuente.videoHeight : fuente.height;
      if (!ancho || !alto) return [];

      // Se busca a la mitad de resolución. jsQR es bastante más lento que el
      // lector nativo, y a tamaño completo un iPhone no llega a un cuadro por
      // segundo — con la cámara temblando, eso es no leer nunca. La mitad
      // alcanza para un QR de factura y multiplica por cuatro los intentos.
      const escala = Math.min(1, 1000 / ancho);
      lienzo.width = Math.round(ancho * escala);
      lienzo.height = Math.round(alto * escala);
      ctx.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);

      const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
      const r = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
      return r ? [r.data] : [];
    },
  };
}
