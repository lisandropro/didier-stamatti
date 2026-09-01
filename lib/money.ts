// La plata, en centavos enteros.
//
// Nada de punto flotante: `0.1 + 0.2` no da `0.3` y una suma de proveedor que
// cierra por dos centavos es una suma en la que nadie vuelve a confiar.
//
// Y nada de `number` tampoco, ni siquiera en centavos: el techo de un entero de
// 32 bits son $21.474.836,47, y una factura grande lo pasa en silencio.

const MAX_DECIMALES = 2;

/**
 * Convierte lo que dice un papel —o un QR, o un CSV— a centavos.
 *
 * Devuelve `null` si no lo entiende, a propósito: adivinar es como un sistema
 * empieza a mentir. Quien llama decide si eso es un error o un campo vacío.
 *
 * `puntoEsDecimal` desempata el único caso que la cadena sola no resuelve —ver
 * `ultimoSeparadorDecimal`—: activalo cuando el texto venga de una máquina (el
 * QR de AFIP, el CSV de ARCA) y no de una persona.
 */
export function aCentavos(
  texto: string,
  opts: { puntoEsDecimal?: boolean } = {},
): bigint | null {
  if (typeof texto !== "string") return null;

  // Fuera el símbolo de moneda, los espacios (incluido el fino que mete Excel)
  // y el signo, que acá no existe: el signo lo decide el tipo de comprobante.
  // Un signo menos NO se descarta: se rechaza. Comérselo convertía "-1500"
  // en $1.500 positivos sin que nadie lo notara, y el signo de un comprobante
  // lo decide su tipo, no el texto de un importe.
  const limpio = texto.replace(/[$\s  ]/g, "");
  if (/^[+-]/.test(limpio)) return null;
  if (!limpio) return null;
  if (!/^[\d.,]+$/.test(limpio)) return null;

  const separador = ultimoSeparadorDecimal(limpio, opts.puntoEsDecimal === true);
  const [enteroCrudo, decimalCrudo] =
    separador === null
      ? [limpio, ""]
      : [limpio.slice(0, separador), limpio.slice(separador + 1)];

  // Los separadores de miles se descartan; lo que quede tiene que ser dígitos.
  const entero = enteroCrudo.replace(/[.,]/g, "");
  if (!/^\d*$/.test(entero) || !/^\d*$/.test(decimalCrudo)) return null;
  if (entero === "" && decimalCrudo === "") return null;

  // Más de dos decimales se acepta SOLO si lo que sobra son ceros: un emisor
  // real imprime "387124.5100000000000000", que es plata legítima con relleno.
  // Con cualquier otro dígito atrás es una lectura mal hecha, y hay que avisar.
  if (decimalCrudo.length > MAX_DECIMALES && !/^0*$/.test(decimalCrudo.slice(MAX_DECIMALES))) {
    return null;
  }

  const decimal = decimalCrudo.slice(0, MAX_DECIMALES).padEnd(MAX_DECIMALES, "0");
  return BigInt(`${entero || "0"}${decimal}`);
}

/**
 * Dónde está el separador decimal, si es que hay uno.
 *
 * Los dos formatos que llegan de verdad se contradicen, así que la regla mira
 * QUÉ separador es y no solo cuántos dígitos tiene detrás:
 *
 * - La **coma** siempre es decimal. Es el formato argentino del papel y de los
 *   CSV en es-AR.
 * - El **punto** es decimal salvo que le sigan exactamente tres dígitos, que es
 *   la forma de un grupo de miles. Por eso "1.500" son mil quinientos y no uno
 *   y medio, pero "387124.5100000000000000" —que sale de un QR real— sí es
 *   decimal.
 *
 * Un grupo de miles nunca tiene más de tres dígitos, así que con cuatro o más
 * detrás no hay ambigüedad posible.
 *
 * Queda un caso que la cadena sola NO puede resolver: "1500.000" es un millón y
 * medio si lo escribió una persona, y mil quinientos si viene de un QR o de un
 * CSV de ARCA, donde el punto siempre es decimal. Por eso `puntoEsDecimal` lo
 * decide quien llama, que es el único que sabe de dónde salió el dato.
 */
function ultimoSeparadorDecimal(s: string, puntoEsDecimal: boolean): number | null {
  const i = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  if (i === -1) return null;
  if (s[i] === "," || puntoEsDecimal) return i;
  return s.length - i - 1 === 3 ? null : i;
}

/** Para pantalla, en formato argentino: `$ 2.231.811,45`. */
export function formatear(centavos: bigint): string {
  const negativo = centavos < 0n;
  const abs = negativo ? -centavos : centavos;
  const entero = abs / 100n;
  const resto = (abs % 100n).toString().padStart(2, "0");
  const conMiles = entero.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}$ ${conMiles},${resto}`;
}

/**
 * El paso obligatorio antes de que un importe cruce del servidor al navegador.
 * `JSON.stringify` de un BigInt tira; verificado contra Prisma 7.
 */
export function aTextoPlano(centavos: bigint): string {
  return centavos.toString();
}

export function sumar(valores: bigint[]): bigint {
  return valores.reduce((a, b) => a + b, 0n);
}
