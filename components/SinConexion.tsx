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
    // Si de verdad se había ido la señal. Al pasar del wifi a los datos el
    // teléfono puede disparar "online" sin haber estado nunca sin red: sin esta
    // marca aparecía un "Volvió" falso y la pantalla se recargaba a mitad de algo.
    let sinSenal = false;
    queueMicrotask(() => {
      if (alive && !navigator.onLine) {
        sinSenal = true;
        setEstado("sin");
      }
    });
    const sin = () => {
      sinSenal = true;
      clearTimeout(reloj);
      setEstado("sin");
    };
    const con = () => {
      if (!sinSenal) return;
      sinSenal = false;
      // Si ya había un "Volvió" en pantalla, su reloj viejo no tiene que cortar el nuevo.
      clearTimeout(reloj);
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

  const texto =
    estado === "sin" ? "Sin conexión: lo que toques ahora no se guarda." : estado === "volvio" ? "Volvió la conexión." : "";
  // El contenedor del aviso se dibuja SIEMPRE, vacío cuando hay conexión: los
  // lectores de pantalla solo anuncian los cambios de una zona que ya estaba, y
  // una que aparece ya con el texto puesto muchos no la leen. Vacío no se ve:
  // la clase que lo pinta (`sin-conexion`) va solo cuando hay texto. Lo único que
  // lleva siempre es `sin-conexion-aviso`, para que no ocupe un lugar en la grilla
  // de `.app`.
  return (
    <div
      className={texto ? `sin-conexion${estado === "volvio" ? " volvio" : ""}` : "sin-conexion-aviso"}
      role="status"
      aria-live="polite"
    >
      {texto}
    </div>
  );
}
