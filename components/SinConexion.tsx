"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Una franja arriba cuando el teléfono se queda sin señal, y un "volvió" corto
 *  cuando vuelve. En el depósito la señal va y viene: sin esto, un tilde que no
 *  se guardó solo mostraba un error genérico. Al volver, la pantalla se pide de
 *  nuevo, porque lo que muestra puede haber quedado viejo. */
export function SinConexion() {
  const router = useRouter();
  const [estado, setEstado] = useState<"con" | "sin" | "volvio">("con");

  useEffect(() => {
    let reloj: ReturnType<typeof setTimeout> | undefined;
    // Si la app se abre ya sin señal, no hay evento "offline" que avise: se mira
    // el estado actual. En un microtask porque el lint no deja un setState
    // sincrónico dentro del efecto; `alive` evita tocar el estado ya desmontado.
    let alive = true;
    queueMicrotask(() => {
      if (alive && !navigator.onLine) setEstado("sin");
    });
    const sin = () => {
      clearTimeout(reloj);
      setEstado("sin");
    };
    const con = () => {
      setEstado("volvio");
      router.refresh();
      reloj = setTimeout(() => setEstado("con"), 2500);
    };
    window.addEventListener("offline", sin);
    window.addEventListener("online", con);
    return () => {
      alive = false;
      clearTimeout(reloj);
      window.removeEventListener("offline", sin);
      window.removeEventListener("online", con);
    };
  }, [router]);

  if (estado === "con") return null;
  return (
    <div className={`sin-conexion${estado === "volvio" ? " volvio" : ""}`} role="status" aria-live="polite">
      {estado === "sin"
        ? "Sin conexión. Lo que toques no se guarda hasta que vuelva la señal."
        : "Volvió la conexión."}
    </div>
  );
}
