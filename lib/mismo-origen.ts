/**
 * ¿La petición viene de una página de esta misma app?
 *
 * Es la defensa contra que otro sitio le haga mandar algo al navegador de una
 * persona con sesión abierta. Se compara el `Origin` que pone el navegador con
 * el host al que llegó la petición, que es lo mismo que hace Next con las
 * server actions.
 *
 * **No se compara contra `req.url`.** Ese fue el error que hubo entre el 07/09
 * y el 19/10/2026: detrás del proxy de Railway, `req.url` es la dirección
 * interna (`http://localhost:8080`) y el `Origin` es el dominio público, así
 * que nunca coincidían. Cada suscripción a los avisos se rechazaba con 403, en
 * silencio, y nadie podía activar ni desactivar los avisos en un teléfono.
 *
 * Sin `Origin` se deja pasar, como antes: la sesión sigue siendo obligatoria
 * después de este chequeo.
 */
export function mismoOrigen(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (!origin) return true;
  // El proxy pone el host público en `x-forwarded-host`; si pasó por más de
  // uno, el primero es el que vio el navegador.
  const host = (headers.get("x-forwarded-host") ?? headers.get("host"))?.split(",")[0].trim();
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    // `Origin: null` (un iframe aislado, un archivo local) o cualquier basura.
    return false;
  }
}
