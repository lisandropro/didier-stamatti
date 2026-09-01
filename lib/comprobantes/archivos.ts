// Que es un archivo, mirandolo por dentro.
//
// El `type` de un `File` lo declara el navegador a partir de la extension: es un
// dato del cliente, y en el borde del dinero un dato del cliente no decide
// nada. Un `.exe` renombrado a `.jpg` llegaba con `image/jpeg` y se guardaba en
// el bucket con ese Content-Type; el dia que alguien abra ese enlace, el
// navegador hace lo que diga la cabecera que nosotros escribimos.
//
// La firma de los primeros bytes no se puede renombrar.

/** Los cuatro formatos que el modulo acepta, con su firma. */
const FIRMAS: { tipo: string; ok: (b: Uint8Array) => boolean }[] = [
  { tipo: "image/jpeg", ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    tipo: "image/png",
    ok: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  // "RIFF" .... "WEBP": el tamano va en el medio, por eso se miran los dos
  // extremos y no una sola tira contigua.
  {
    tipo: "image/webp",
    ok: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  { tipo: "application/pdf", ok: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
];

/**
 * El tipo real del archivo, o `null` si no es ninguno de los aceptados.
 *
 * Alcanza con los primeros 12 bytes. Se devuelve el tipo encontrado —no un
 * booleano— para que quien guarda escriba en el bucket el Content-Type que el
 * archivo REALMENTE tiene, y no el que vino en el formulario.
 */
export function tipoReal(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  return FIRMAS.find((f) => f.ok(bytes))?.tipo ?? null;
}
