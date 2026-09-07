// El CUIT lleva dígito verificador por módulo 11.
//
// Validarlo es gratis y es una de las tres formas que tenemos de saber si el
// lector automático leyó bien, sin que una persona tenga que mirar el papel.
// Un dígito mal leído tiene 10 de 11 probabilidades de romper la validación.

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function cuitValido(cuit: string): boolean {
  if (typeof cuit !== "string") return false;
  // Los guiones se descartan: en el papel casi siempre está como 30-71773748-9.
  const d = cuit.replace(/\D/g, "");
  if (d.length !== 11) return false;

  const suma = PESOS.reduce((acc, peso, i) => acc + peso * Number(d[i]), 0);
  const resto = suma % 11;
  // Las dos excepciones de la regla: resto 0 da verificador 0, y resto 1 da 9.
  const esperado = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;
  return esperado === Number(d[10]);
}
