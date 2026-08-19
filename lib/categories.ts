// Los sectores del depósito, en un solo lugar y sin dependencias.
//
// Vive aparte por el mismo motivo que `lib/permissions.ts`: hasta acá la lista
// de categorías estaba escrita a mano en catorce archivos —acciones, pantallas,
// PDF, carteles, resumen del depósito— y agregar una quinta significaba
// acordarse de los catorce. Olvidarse de uno no rompe nada ruidosamente: la
// categoría simplemente no aparece en esa pantalla, y eso se descubre el día
// del evento.
//
// En la base `category` es texto libre, así que agregar un sector no lleva
// migración. Lo que sí lleva es aparecer en todas las listas de acá.

export const CATEGORIES = ["ENSERES", "MANTELERIA", "MOBILIARIO", "BEBIDA"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<string, string> = {
  ENSERES: "Enseres",
  MANTELERIA: "Mantelería",
  MOBILIARIO: "Mobiliario",
  BEBIDA: "Bebida",
};

/**
 * Qué sectores llevan cartel automático al imprimir el pedido.
 *
 * El cartel es la hoja apaisada que se pega en el sector del depósito. Solo lo
 * llevan los que se preparan en depósitos distintos. El resto se reimprime a
 * pedido desde /evento/[id]/pdf/cartel/[sector] cuando hace falta, sin ensuciar
 * cada impresión con una hoja que nadie va a pegar.
 */
export const CON_CARTEL: readonly Category[] = ["ENSERES", "BEBIDA"];

export function esCategoria(valor: string): valor is Category {
  return (CATEGORIES as readonly string[]).includes(valor);
}

export function nombreDeCategoria(valor: string): string {
  return CATEGORY_LABEL[valor] ?? valor;
}

export function llevaCartel(valor: string): boolean {
  return (CON_CARTEL as readonly string[]).includes(valor);
}

/** En qué orden salen los sectores: en pantalla, en el resumen y en el PDF.
 *  Una categoría desconocida —de un dato viejo— va al final, no al principio. */
export function ordenDeCategoria(valor: string): number {
  const i = (CATEGORIES as readonly string[]).indexOf(valor);
  return i === -1 ? CATEGORIES.length : i;
}

/** Las opciones tal como las piden los <select> y las pestañas. */
export const OPCIONES_CATEGORIA: { v: string; l: string }[] = CATEGORIES.map((v) => ({
  v,
  l: CATEGORY_LABEL[v],
}));
