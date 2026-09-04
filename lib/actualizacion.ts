// Cuándo la app se actualiza sola.
//
// Cada despliegue cambia el código del servidor. Una pestaña abierta desde
// antes sigue teniendo el código viejo, y sus botones dejan de existir para el
// servidor: al tocar "guardar" la petición se rechaza con "Failed to find
// Server Action" y —esto es lo grave— la persona no ve ningún error. Le pasó a
// Enrique el 3 de septiembre: diez intentos seguidos, nada guardado, ningún
// aviso.
//
// La regla es que la app se actualice sola, sin pedirle nada a nadie. Pero
// recargar tiene su propio riesgo: el armador de pedidos guarda con 700 ms de
// retraso, así que una recarga a destiempo se come la última cantidad tipeada.
// De ahí las dos mitades de este archivo: cuándo hay una versión nueva, y
// cuándo es seguro tomarla.

/** Cada cuánto se mira si el servidor cambió de versión. */
export const CADA_MS = 45_000;
/** Piso entre recargas. Si algo hiciera que las versiones nunca coincidan, la
 *  app quedaría recargándose en bucle; esto lo vuelve un parpadeo cada tanto en
 *  vez de una app inusable. */
export const MINIMO_ENTRE_RECARGAS_MS = 60_000;

export type Situacion = {
  /** La versión con la que se dibujó esta pantalla. */
  cargada: string;
  /** La que dice el servidor ahora. `null` = no se pudo consultar. */
  servidor: string | null;
  /** Si hay trabajo a medio guardar, un formulario abierto o alguien tipeando. */
  ocupado: boolean;
  /** Hace cuánto fue la última recarga automática, en ms. `null` = nunca. */
  desdeUltimaRecarga: number | null;
};

/** ¿El servidor está corriendo otra versión que la de esta pantalla? */
export function hayVersionNueva(s: Situacion): boolean {
  // Sin respuesta no se concluye nada: puede ser la señal del celular.
  if (!s.servidor) return false;
  // Una versión vacía tampoco dice nada.
  if (!s.cargada) return false;
  return s.servidor !== s.cargada;
}

/**
 * ¿Se puede recargar ahora mismo?
 *
 * Hay versión nueva, nadie está a mitad de algo, y no se acaba de recargar.
 * Si está ocupado no se descarta la actualización: se vuelve a preguntar en el
 * próximo control, y se toma cuando la persona suelta el teclado.
 */
export function sePuedeRecargar(s: Situacion): boolean {
  if (!hayVersionNueva(s)) return false;
  if (s.ocupado) return false;
  if (s.desdeUltimaRecarga !== null && s.desdeUltimaRecarga < MINIMO_ENTRE_RECARGAS_MS) return false;
  return true;
}

/**
 * ¿Este error es el de la versión vieja?
 *
 * Es el otro camino: si la persona llegó a tocar el botón antes de que el
 * control periódico se diera cuenta, la acción falla y hay que recargar ya
 * mismo — ese toque se perdió igual, pero el siguiente tiene que funcionar.
 */
export function esErrorDeVersionVieja(mensaje: unknown): boolean {
  if (typeof mensaje !== "string") return false;
  return /Failed to find Server Action|from an older or newer deployment/i.test(mensaje);
}
