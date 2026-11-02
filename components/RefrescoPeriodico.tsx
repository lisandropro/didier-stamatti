"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Vuelve a pedirle la pantalla al servidor cada tanto y al volver a la app.
 *
 * Quien prepara deja el teléfono con Preparar abierto: un cambio de Enrique
 * tiene que aparecer sin que nadie recargue. Si la pestaña está escondida no
 * pide nada; al volver a mirarla, refresca enseguida.
 */
export function RefrescoPeriodico({ cadaMs = 45_000 }: { cadaMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refrescar = () => {
      // Sin señal no se pide nada: `router.refresh()` falla y Next 16 hace una
      // navegación completa, que el service worker contesta con la página de
      // "sin conexión", y esa reemplazaría la lista que se está leyendo. La
      // franja de abajo ya avisa; al volver la señal, `SinConexion` refresca.
      if (document.visibilityState === "visible" && navigator.onLine) router.refresh();
    };
    const id = setInterval(refrescar, cadaMs);
    document.addEventListener("visibilitychange", refrescar);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refrescar);
    };
  }, [router, cadaMs]);
  return null;
}
