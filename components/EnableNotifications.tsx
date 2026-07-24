"use client";

import { useEffect, useState } from "react";

type State = "loading" | "unsupported" | "ios-install" | "prompt" | "enabled" | "denied" | "working";

function urlB64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

const PUB_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export function EnableNotifications() {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

    if (!supported) {
      // En iPhone, sin instalar a la pantalla de inicio, no hay push posible.
      setState(isIOS && !standalone ? "ios-install" : "unsupported");
      return;
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then(async (reg) => {
        if (Notification.permission === "denied") return setState("denied");
        const sub = await reg.pushManager.getSubscription();
        if (Notification.permission === "granted" && sub) return setState("enabled");
        // iPhone: aunque "soporte", si no está instalada conviene avisar.
        if (isIOS && !standalone) return setState("ios-install");
        setState("prompt");
      })
      .catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    setError(null);
    setState("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "prompt");
        return;
      }
      if (!PUB_KEY) {
        setError("Falta la configuración de notificaciones. Avisale a quien administra la app.");
        setState("prompt");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(PUB_KEY),
      });
      const res = await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error("No se pudo guardar la suscripción.");
      setState("enabled");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo activar.");
      setState("prompt");
    }
  }

  async function disable() {
    setState("working");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/notifications/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("prompt");
    } catch {
      setState("enabled");
    }
  }

  if (state === "loading") return null;

  return (
    <div className="notif-enable">
      {state === "enabled" ? (
        <>
          <span className="notif-enable-ok">🔔 Notificaciones activadas en este dispositivo</span>
          <button className="btn ghost" onClick={disable}>Desactivar</button>
        </>
      ) : state === "denied" ? (
        <span className="notif-enable-note">
          Las notificaciones están bloqueadas en este dispositivo. Activálas desde la configuración del navegador
          (permisos del sitio) y volvé a esta pantalla.
        </span>
      ) : state === "ios-install" ? (
        <span className="notif-enable-note">
          📱 En iPhone, para recibir avisos: tocá el botón <b>Compartir</b> de Safari y elegí{" "}
          <b>“Agregar a inicio”</b>. Después abrí la app desde su ícono y volvé acá para activarlas.
        </span>
      ) : state === "unsupported" ? (
        <span className="notif-enable-note">
          Este dispositivo/navegador no permite notificaciones. Igual vas a ver los avisos acá dentro cuando abras la app.
        </span>
      ) : (
        <>
          <span className="notif-enable-note">Recibí un aviso en este dispositivo cuando alguien modifique un pedido.</span>
          <button className="btn primary" onClick={enable} disabled={state === "working"}>
            {state === "working" ? "Activando…" : "Activar notificaciones"}
          </button>
        </>
      )}
      {error && <span className="notif-enable-err">{error}</span>}
    </div>
  );
}
