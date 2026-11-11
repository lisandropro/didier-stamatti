// El nombre de una persona, para compararlo con el de otra.
//
// Los avisos, el historial del pedido y los tildes del depósito dicen quién
// hizo cada cosa POR EL NOMBRE. Por eso dos cuentas no pueden llamarse igual:
// "Enrique" y "enrique " tienen que contar como el mismo.

function llano(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** ¿Son el mismo nombre? Sin mirar mayúsculas, acentos ni espacios de más. */
export function mismoNombre(a: string, b: string): boolean {
  return llano(a) === llano(b);
}
