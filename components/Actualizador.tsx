"use client";

import { useEffect, useRef } from "react";
import {
  CADA_MS,
  esErrorDeVersionVieja,
  sePuedeRecargar,
  type Situacion,
} from "@/lib/actualizacion";
import { estaOcupado } from "@/lib/trabajo-pendiente";

/**
 * Mantiene la app al día sola.
 *
 * Cada despliegue cambia el código del servidor, y una pestaña abierta desde
 * antes queda con el viejo: sus botones dejan de existir y guardar falla **sin
 * mostrar ningún error**. Le pasó a Enrique el 3 de septiembre — diez intentos,
 * nada guardado, ningún aviso.
 *
 * Dos caminos, porque uno solo no alcanza:
 *
 *  1. **Antes de que moleste**: se mira cada tanto qué versión corre el servidor
 *     y, si cambió, se recarga —pero solo cuando nadie está a mitad de algo.
 *  2. **Si igual llegó a fallar**: se escucha el error de la acción rechazada y
 *     se recarga en el acto. Ese toque se perdió, pero el siguiente funciona.
 *
 * Va montado en el armazón de la app, así que corre en todas las pantallas.
 * Aprovecha la consulta que ya hacía la campanita: una sola petición para las
 * dos cosas, que en el celular con datos importa.
 */
export function Actualizador({ version }: { version: string }) {
  const ultimaRecarga = useRef<number | null>(null);

  useEffect(() => {
    let vivo = true;

    // La marca de la última recarga sobrevive a la recarga misma: sin esto, un
    // desacuerdo permanente de versiones dejaría la app en un bucle.
    try {
      const guardada = sessionStorage.getItem("ultima-recarga-version");
      if (guardada) ultimaRecarga.current = Number(guardada);
    } catch {}

    function recargar(motivo: string) {
      try {
        sessionStorage.setItem("ultima-recarga-version", String(Date.now()));
      } catch {}
      console.log(`[version] la app se actualiza sola: ${motivo}`);
      window.location.reload();
    }

    async function mirar() {
      try {
        const res = await fetch("/api/notifications/count", { cache: "no-store" });
        if (!res.ok || !vivo) return;
        const data = await res.json();

        // La campanita se alimenta de esta misma respuesta.
        window.dispatchEvent(new CustomEvent("notif-count", { detail: data.count ?? 0 }));

        const situacion: Situacion = {
          cargada: version,
          servidor: typeof data.version === "string" ? data.version : null,
          ocupado: estaOcupado(),
          desdeUltimaRecarga:
            ultimaRecarga.current === null ? null : Date.now() - ultimaRecarga.current,
        };
        if (sePuedeRecargar(situacion)) recargar(`${situacion.cargada} → ${situacion.servidor}`);
      } catch {
        // Sin señal no se concluye nada.
      }
    }

    // Una acción rechazada por versión vieja llega como promesa sin atender o
    // como error suelto, según desde dónde se haya llamado.
    const porRechazo = (e: PromiseRejectionEvent) => {
      const m = e.reason instanceof Error ? e.reason.message : String(e.reason ?? "");
      if (esErrorDeVersionVieja(m)) recargar("una acción quedó vieja");
    };
    const porError = (e: ErrorEvent) => {
      if (esErrorDeVersionVieja(e.message)) recargar("una acción quedó vieja");
    };

    void mirar();
    const timer = setInterval(mirar, CADA_MS);
    // Al volver a la app después de un rato es cuando más probable es que haya
    // versión nueva: se mira ahí también, sin esperar al próximo turno.
    const alVolver = () => {
      if (document.visibilityState === "visible") void mirar();
    };

    window.addEventListener("unhandledrejection", porRechazo);
    window.addEventListener("error", porError);
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      vivo = false;
      clearInterval(timer);
      window.removeEventListener("unhandledrejection", porRechazo);
      window.removeEventListener("error", porError);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [version]);

  return null;
}
