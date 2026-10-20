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
      if (document.visibilityState === "visible") router.refresh();
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
