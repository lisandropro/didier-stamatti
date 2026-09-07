// La verificación de los renglones, en un solo lugar.
//
// La usan el lector —para el semáforo de la pantalla de captura— y el documento
// reconstruido. Estaba duplicada y las dos copias tenían el mismo error.
//
// **El error, y cómo apareció.** La primera versión exigía
// `cantidad × precioUnitario = subtotal` en cada renglón. Al generar el
// documento con una factura real de Lácteos Don Ángel dio "los renglones no
// suman" — y la factura estaba perfecta. Tiene una columna de **% de descuento**:
//
//     5,470 KG × $15.309,917 = $83.745,60  →  19% off  →  $67.833,65
//
// Los descuentos por renglón son corrientes en las facturas de proveedores de
// alimentos, así que el control habría dado rojo en la mayoría de los
// comprobantes que entran. Un control que se equivoca seguido deja de mirarse
// en dos semanas, y ahí se pierde también para los casos en que tenía razón.

export type RenglonVerificable = {
  cantidad: bigint | null; // MILÉSIMAS
  precioUnitario: bigint | null; // MILÉSIMAS de peso
  subtotal: bigint | null; // CENTAVOS
};

/**
 * Si los renglones cierran contra el neto.
 *
 * Dos comprobaciones, y la que manda es la segunda:
 *
 * 1. **La multiplicación de cada renglón**, tolerando un descuento — siempre
 *    que sea el MISMO en todos. Un descuento parejo es una columna de la
 *    factura; uno distinto por renglón, cuando los demás coinciden, es una
 *    lectura mal hecha.
 * 2. **La suma de los subtotales contra el neto impreso.** Es la más valiosa
 *    porque detecta lo único que ninguna otra cosa detecta: **un renglón que
 *    falta**. Una factura a la que le falta una línea se ve perfectamente normal
 *    renglón por renglón.
 *
 * `null` = no se puede verificar, que no es lo mismo que estar mal.
 */
export function renglonesCierran(
  neto: bigint | null,
  lines: RenglonVerificable[],
): boolean | null {
  if (lines.length === 0 || neto == null) return null;

  const conNumeros = lines.filter((l) => l.subtotal != null);
  if (conNumeros.length === 0) return null;
  // Si algunos traen subtotal y otros no, la suma no puede cerrar contra el
  // neto: falta parte del detalle, y decir que no cierra sería culpar al papel.
  if (conNumeros.length !== lines.length) return null;

  if (!multiplicacionesCoherentes(lines)) return false;

  const suma = conNumeros.reduce((a, l) => a + l.subtotal!, 0n);
  // Un centavo de redondeo por renglón, acumulado: 3 unidades a $33,33 dan
  // $99,99 y muchos emisores imprimen $100,00.
  return abs(suma - neto) <= BigInt(conNumeros.length);
}

/**
 * Que la relación entre `cantidad × precio` y el subtotal sea la misma en todos
 * los renglones.
 *
 * Sin descuento la relación es 1. Con un 19% parejo es 0,81 en todos. Lo que no
 * puede pasar es que doce renglones den 0,81 y uno dé 0,64: ahí hay un número
 * mal leído.
 *
 * Los renglones sin cantidad o sin precio —un flete, un redondeo— no participan:
 * no tienen multiplicación que verificar.
 */
function multiplicacionesCoherentes(lines: RenglonVerificable[]): boolean {
  const razones: number[] = [];
  for (const l of lines) {
    if (l.cantidad == null || l.precioUnitario == null || l.subtotal == null) continue;
    // En millonésimas de peso; /10.000 lo deja en centavos, comparable al subtotal.
    const bruto = (l.cantidad * l.precioUnitario) / 10_000n;
    if (bruto === 0n) continue;
    razones.push(Number(l.subtotal) / Number(bruto));
  }
  if (razones.length < 2) return true; // con uno solo no hay nada que comparar

  const media = razones.reduce((a, b) => a + b, 0) / razones.length;
  // 1,5% de margen: cubre el redondeo de cada renglón y sigue detectando un
  // dígito cambiado, que mueve la razón mucho más que eso.
  return razones.every((r) => Math.abs(r - media) <= 0.015);
}

function abs(v: bigint): bigint {
  return v < 0n ? -v : v;
}
