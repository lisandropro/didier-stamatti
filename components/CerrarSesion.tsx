"use client";

import { useFormStatus } from "react-dom";
import { logout } from "@/app/actions/auth";

/** Lo máximo que se espera a desanotar el teléfono antes de cerrar la sesión. */
const ESPERA_MAXIMA_MS = 2500;

/**
 * Antes de cerrar la sesión, desanota este teléfono de los avisos.
 *
 * Sin esto el teléfono seguía recibiendo los avisos de quien salió, con nombres
 * de eventos, hasta que entrara otra persona. Se borra la anotación en el
 * servidor pero NO la suscripción del navegador: si después entra otra persona
 * en este teléfono, PushSubscriptionSync la anota a su nombre y no tiene que
 * volver a activar nada.
 *
 * Nunca falla (si no se pudo, se cierra la sesión igual) y nunca espera de más:
 * ver `desanotarConTope`.
 */
async function desanotarEsteTelefono(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await fetch("/api/notifications/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
      // Si la página se va antes de que termine (la sesión se cierra y se
      // navega), el navegador igual completa el pedido.
      keepalive: true,
    });
  } catch {
    // Si no se pudo, se cierra la sesión igual.
  }
}

/**
 * Salir no puede depender de la red: con mala señal, el pedido de arriba podía
 * colgarse y el botón de cerrar sesión quedaba sin hacer nada. Pasado el tope
 * se sigue; si la baja no llegó, PushSubscriptionSync o el próximo envío
 * fallido lo corrigen.
 */
async function desanotarConTope(): Promise<void> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<void>((resolver) => {
    reloj = setTimeout(resolver, ESPERA_MAXIMA_MS);
  });
  await Promise.race([desanotarEsteTelefono(), tope]);
  clearTimeout(reloj);
}

const IconoSalir = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="M15 12H4M8 8l-4 4 4 4" />
    <path d="M11 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
  </svg>
);

/**
 * Va adentro del `<form>`: `useFormStatus` solo ve el formulario que lo
 * contiene. Mientras se cierra la sesión el botón queda deshabilitado, para que
 * un segundo toque no mande dos veces el cierre.
 */
function BotonSalir({ variante }: { variante: "icono" | "boton" }) {
  const { pending } = useFormStatus();
  return variante === "icono" ? (
    <button type="submit" className="logout-btn" title="Cerrar sesión" aria-label="Cerrar sesión" disabled={pending}>
      {IconoSalir}
    </button>
  ) : (
    <button type="submit" className="btn btn-del" disabled={pending}>
      {IconoSalir}
      {pending ? "Cerrando…" : "Cerrar sesión"}
    </button>
  );
}

export function CerrarSesion({ variante }: { variante: "icono" | "boton" }) {
  return (
    <form
      action={async () => {
        await desanotarConTope();
        await logout();
      }}
    >
      <BotonSalir variante={variante} />
    </form>
  );
}
