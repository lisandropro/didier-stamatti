"use client";

import { logout } from "@/app/actions/auth";

/**
 * Antes de cerrar la sesión, desanota este teléfono de los avisos.
 *
 * Sin esto el teléfono seguía recibiendo los avisos de quien salió, con nombres
 * de eventos, hasta que entrara otra persona. Se borra la anotación en el
 * servidor pero NO la suscripción del navegador: si después entra otra persona
 * en este teléfono, PushSubscriptionSync la anota a su nombre y no tiene que
 * volver a activar nada.
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
    });
  } catch {
    // Si no se pudo, se cierra la sesión igual.
  }
}

const IconoSalir = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="M15 12H4M8 8l-4 4 4 4" />
    <path d="M11 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
  </svg>
);

export function CerrarSesion({ variante }: { variante: "icono" | "boton" }) {
  return (
    <form
      action={async () => {
        await desanotarEsteTelefono();
        await logout();
      }}
    >
      {variante === "icono" ? (
        <button type="submit" className="logout-btn" title="Cerrar sesión" aria-label="Cerrar sesión">
          {IconoSalir}
        </button>
      ) : (
        <button type="submit" className="btn btn-del">
          {IconoSalir}
          Cerrar sesión
        </button>
      )}
    </form>
  );
}
