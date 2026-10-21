// Qué hacer con los faltantes de un período en cada barrido. Sin base de datos.
//
// Se compara lo que falta ahora con lo último que se avisó. Avisar solo lo
// nuevo o lo que empeoró es lo que hace que el aviso se lea: uno que se repite
// cada minuto por lo mismo enseña a ignorarlo.

export type Faltante = { productId: string; name: string; totalRequested: number; stock: number; missing: number };
export type Avisado = { productId: string; missing: number };
export type Decision = {
  /** Lo que hay que avisar: nuevo, o falta más que lo avisado. */
  avisar: Faltante[];
  /** Las filas a crear o actualizar en `FaltanteAvisado`. */
  guardar: Avisado[];
  /** Los productos que dejaron de faltar: su fila se borra, sin aviso. */
  borrar: string[];
};

/**
 * La primera vez que se barre un período se registra todo lo que ya falta sin
 * avisar: si no, el deploy (o un período recién creado con pedidos copiados)
 * dispararía un aviso por cada faltante viejo.
 *
 * Si falta menos que lo avisado, no se toca la fila: lo guardado es lo que se
 * avisó, y si vuelve a subir sin pasar ese número el depósito ya lo sabía.
 */
export function decidirFaltantes(actuales: Faltante[], avisados: Avisado[], primeraVez: boolean): Decision {
  const previo = new Map(avisados.map((a) => [a.productId, a.missing]));
  const faltaAhora = new Set(actuales.map((f) => f.productId));
  const borrar = avisados.filter((a) => !faltaAhora.has(a.productId)).map((a) => a.productId);

  if (primeraVez) {
    return { avisar: [], guardar: actuales.map((f) => ({ productId: f.productId, missing: f.missing })), borrar };
  }

  const avisar = actuales.filter((f) => {
    const antes = previo.get(f.productId);
    return antes === undefined || f.missing > antes;
  });
  return { avisar, guardar: avisar.map((f) => ({ productId: f.productId, missing: f.missing })), borrar };
}
