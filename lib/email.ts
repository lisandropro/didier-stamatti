/**
 * El correo es la llave con la que se entra, así que tiene que coincidir letra
 * por letra entre el día que se creó el usuario y el día que la persona lo
 * escribe en su teléfono. Este archivo existe porque no coincidió.
 *
 * Caso real (2026-08-12): se creó a Aldana como `administración@…`, con tilde.
 * No la dejaba entrar. Dos motivos, y cada uno alcanza solo:
 *
 * 1. Nadie escribe la tilde al poner su correo — y sin ella es otra dirección.
 * 2. Aunque la escriba, "ó" se guarda de dos formas distintas según el teclado:
 *    una sola letra (U+00F3) o una "o" seguida de una tilde suelta (U+0301).
 *    Se ven idénticas y para la base son textos distintos.
 */

/** Deja el correo en una sola forma posible: sin espacios, en minúsculas y con
 *  los acentos compuestos de una única manera. Se aplica al guardar Y al
 *  buscar, así los dos lados siempre llegan al mismo texto. */
export function normalizeEmail(raw: string): string {
  return raw.normalize("NFC").trim().toLowerCase();
}

/** El pedazo antes de la arroba. */
function localPart(email: string): string {
  return email.slice(0, email.lastIndexOf("@"));
}

/**
 * Qué tiene de malo este correo, en castellano, o null si está bien.
 *
 * Se rechaza la tilde y la eñe antes de la arroba a propósito: los servidores
 * de correo de verdad no las aceptan ahí, así que una dirección así no existe
 * en ningún lado — y encima obliga a acertarle al acento cada vez que se entra.
 * Es exactamente el error que dejó a Aldana afuera.
 */
export function emailProblem(email: string): string | null {
  if (!email) return "Poné un email.";
  const arroba = email.lastIndexOf("@");
  if (arroba < 1 || arroba === email.length - 1) return "Poné un email válido, con arroba.";
  if (/\s/.test(email)) return "El email no puede tener espacios.";

  const antes = localPart(email);
  const noAscii = [...antes].filter((c) => c.charCodeAt(0) > 127);
  if (noAscii.length > 0) {
    // Se le saca el acento y se le sugiere: casi siempre es lo que se quiso poner.
    const sinAcentos = email
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ñ/g, "n");
    return `El email no puede llevar ${noAscii.join(" ni ")} antes de la arroba: los servidores de correo no los aceptan y después no se puede entrar. Probá con “${sinAcentos}”.`;
  }
  if (!email.slice(arroba + 1).includes(".")) return "Al dominio del email le falta el punto.";
  return null;
}
