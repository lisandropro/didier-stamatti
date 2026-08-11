"use client";

import { useEffect } from "react";

/**
 * Vuelve a atar la suscripción push de este teléfono a quien tiene la sesión
 * abierta ahora.
 *
 * El problema que resuelve: la suscripción del navegador es del *dispositivo*,
 * no de la persona. Sobrevive a cerrar sesión. Si Pablo activa los avisos en un
 * teléfono y después entra Enrique en ese mismo teléfono, el endpoint seguía
 * anotado a nombre de Pablo: los avisos de Pablo sonaban en el teléfono que
 * estaba usando Enrique, y Enrique no recibía ninguno. `EnableNotifications`
 * solo manda la suscripción al servidor cuando alguien toca "Activar", así que
 * nadie la corregía.
 *
 * Se manda en cada apertura de la app. El endpoint es único en la base y se
 * guarda con `upsert`, así que repetirlo no crea nada: solo reasigna el dueño
 * si cambió. Es barato y se arregla solo, también después de actualizar la PWA.
 *
 * No pide permisos ni crea suscripciones nuevas: si esta persona nunca activó
 * los avisos, no hace absolutamente nada.
 */
export function PushSubscriptionSync() {
  useEffect(() => {
    let cancelado = false;

    (async () => {
      try {
        if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
        if (Notification.permission !== "granted") return;

        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg || cancelado) return;

        const sub = await reg.pushManager.getSubscription();
        if (!sub || cancelado) return;

        await fetch("/api/notifications/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
      } catch {
        // Que no se pueda resincronizar nunca puede romper la pantalla.
      }
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  return null;
}
