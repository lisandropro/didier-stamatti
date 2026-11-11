// Las reglas de las contraseñas, en un solo lugar.
//
// Las usan Cuenta (cambiar la propia), Usuarios (crear y resetear) y el script
// de reseteo manual. Antes cada uno repetía "al menos 6 caracteres" y ninguno
// ponía techo: bcrypt corta a los 72 bytes y el login rechaza más de 256
// caracteres, así que una contraseña muy larga se guardaba bien y después no
// dejaba entrar.

import bcrypt from "bcryptjs";

export const CLAVE_MINIMA = 8;
/** bcrypt ignora todo lo que pase de 72 bytes. Se rechaza en vez de cortar en
 *  silencio: dos contraseñas distintas no pueden valer lo mismo. */
export const CLAVE_MAXIMA_BYTES = 72;

/** Costo de bcrypt para las contraseñas nuevas. Las guardadas con un costo
  *  menor siguen valiendo: el costo viaja adentro de cada hash. Es 11 y no más
 *  porque bcryptjs es JavaScript puro: en el servidor cada ingreso ya tarda
 *  cerca de medio segundo. */
export const COSTO_BCRYPT = 11;

// Las que se prueban primero. No es una lista de contraseñas filtradas: son
// las obvias para ESTA app, las que alguien pondría "por ahora".
const OBVIAS = new Set([
  "12345678", "123456789", "1234567890", "11111111", "00000000", "87654321",
  "password", "password1", "contraseña", "contrasena", "qwertyui", "qwerty123",
  "abcd1234", "abc12345", "didier123", "didier1234", "didier2025", "didier2026",
  "stamatti", "catering", "catering1", "catering123",
]);

function sinAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Qué tiene de malo esta contraseña, en castellano, o null si sirve.
 *
 * `persona` es de quién es la cuenta: una contraseña igual al correo o al
 * nombre se adivina sin probar nada.
 */
export function problemaDeClave(
  clave: unknown,
  persona: { email?: string | null; name?: string | null } = {},
): string | null {
  if (typeof clave !== "string" || clave.length === 0) return "Poné una contraseña.";
  if (clave.length < CLAVE_MINIMA) return `La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.`;
  if (Buffer.byteLength(clave, "utf8") > CLAVE_MAXIMA_BYTES) {
    return "La contraseña es demasiado larga (máximo 72 caracteres).";
  }
  if (clave.trim().length === 0) return "La contraseña no puede ser solo espacios.";
  if (new Set(clave).size < 4) return "Esa contraseña es muy fácil de adivinar: usá más letras o números distintos.";

  const llana = sinAcentos(clave);
  if (OBVIAS.has(llana)) return "Esa contraseña es muy fácil de adivinar. Elegí otra.";

  const email = sinAcentos(persona.email ?? "").trim();
  const antesDeLaArroba = email.includes("@") ? email.slice(0, email.lastIndexOf("@")) : email;
  const nombre = sinAcentos(persona.name ?? "").trim();
  for (const dato of [email, antesDeLaArroba, nombre]) {
    if (dato.length >= 3 && llana === dato) return "La contraseña no puede ser tu nombre ni tu email.";
  }
  return null;
}

export function hashearClave(clave: string): Promise<string> {
  return bcrypt.hash(clave, COSTO_BCRYPT);
}

// Un hash de verdad, de una contraseña que nadie tiene. Cuando el email no
// existe se compara igual contra esto: sin esa comparación la respuesta llega
// mucho antes, y por el reloj se puede saber qué correos tienen cuenta.
let relleno: Promise<string> | null = null;

/** Compara la contraseña con el hash de la cuenta, o gasta el mismo tiempo si
 *  la cuenta no existe. Devuelve true solo si hay cuenta y la clave coincide. */
export async function claveCorrecta(clave: string, hash: string | null | undefined): Promise<boolean> {
  if (hash) return bcrypt.compare(clave, hash);
  relleno ??= bcrypt.hash("relleno-sin-dueño-" + Math.random().toString(36), COSTO_BCRYPT);
  await bcrypt.compare(clave, await relleno);
  return false;
}
