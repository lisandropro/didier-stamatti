// ¿Se puede correr el seed contra esta base? Sin dependencias, para probarlo.
//
// `prisma/seed.ts` BORRA todos los renglones de pedido, todos los movimientos
// de stock y todo el catálogo antes de cargar el del archivo. Es una
// herramienta de desarrollo, pero es un comando: alcanza con correrlo con
// `DATABASE_URL` apuntando a la base de verdad —o en la consola de Railway—
// para quedarse sin pedidos ni historial de stock, sin que nada pregunte.

export type DatosDeLaBase = { eventos: number; renglones: number; movimientos: number };

export type Entorno = Record<string, string | undefined>;

/** ¿Este proceso está corriendo en producción? Railway pone sus variables en
 *  cualquier comando que corre en el servicio; `NODE_ENV` es la otra señal. */
export function pareceProduccion(env: Entorno): boolean {
  return env.NODE_ENV === "production" || Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_PROJECT_ID);
}

/**
 * Sin `--force`, el seed no corre si esto parece producción ni si la base ya
 * tiene trabajo cargado (eventos, renglones de pedido o movimientos de stock):
 * las dos son señales de que lo que se va a borrar es de verdad.
 *
 * Con `--force` corre siempre: es quien lo escribe diciendo que sabe qué borra.
 */
export function puedeSembrar(argv: string[], env: Entorno, datos: DatosDeLaBase): { ok: true } | { ok: false; motivo: string } {
  if (argv.includes("--force")) return { ok: true };
  const como = "Si de verdad querés reemplazar el catálogo y borrar eso, corré el seed con --force.";
  if (pareceProduccion(env)) {
    return { ok: false, motivo: `Esto parece producción (NODE_ENV o variables de Railway): el seed borra los pedidos, los movimientos de stock y el catálogo. ${como}` };
  }
  if (datos.eventos + datos.renglones + datos.movimientos > 0) {
    return {
      ok: false,
      motivo:
        `La base ya tiene trabajo cargado (${datos.eventos} eventos, ${datos.renglones} renglones de pedido, ${datos.movimientos} movimientos de stock) ` +
        `y el seed borra los renglones, los movimientos y el catálogo. ${como}`,
    };
  }
  return { ok: true };
}
