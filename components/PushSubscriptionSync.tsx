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
        if (!("serviceWorker" in navigator)) return;
        // Se registra desde cualquier pantalla, no solo desde Avisos: hasta el
        // 19/10/2026 un teléfono que nunca abría Avisos no tenía el service
        // worker al día, y sin él no hay push ni renovación de la suscripción.
        // Si ya estaba registrado se le pide revisar si hay un sw.js nuevo: una
        // app instalada casi nunca se recarga, y sin esto la versión vieja se
        // quedaba hasta que el navegador se acordara de revisar.
        const existente = await navigator.serviceWorker.getRegistration();
        if (existente) existente.update().catch(() => {});
        const reg = existente ?? (await navigator.serviceWorker.register("/sw.js"));
        if (cancelado) return;
        if (!("PushManager" in window) || !("Notification" in window)) return;
        if (Notification.permission !== "granted") return;

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
