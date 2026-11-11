import { createHash, timingSafeEqual } from "node:crypto";

/** Lo mínimo que tiene que medir un secreto compartido para aceptarlo. Con
 *  menos, adivinarlo a fuerza de pedidos deja de ser una fantasía. */
export const MIN_BYTES_DE_SECRETO = 32;

/**
 * ¿El secreto que llegó es el configurado?
 *
 * - Sin secreto configurado, o con uno de menos de 32 bytes, nadie pasa: un
 *   disparador protegido por "1234" es un disparador abierto.
 * - La comparación no depende de cuánto coincidan los textos. Con `===` el
 *   tiempo de respuesta crece con cada carácter acertado y el secreto se puede
 *   ir sacando de a uno. Se comparan los hashes, que miden siempre lo mismo:
 *   `timingSafeEqual` exige largos iguales, y comparar largos antes ya contaría
 *   cuánto mide el secreto.
 */
export function secretoValido(dado: string | null | undefined, configurado: string | null | undefined): boolean {
  if (!configurado || Buffer.byteLength(configurado) < MIN_BYTES_DE_SECRETO) return false;
  if (typeof dado !== "string" || dado.length === 0) return false;
  const a = createHash("sha256").update(dado).digest();
  const b = createHash("sha256").update(configurado).digest();
  return timingSafeEqual(a, b);
}
