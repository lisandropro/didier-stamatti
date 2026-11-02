"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Cuánto se espera, después del aviso de que volvió la señal, antes de pedir la
 *  pantalla de nuevo. El evento `online` puede llegar antes de que la red conteste
 *  de verdad, y un `router.refresh()` que falla termina en la página de "sin
 *  conexión", que reemplazaría la pantalla que se está mirando. */
const ESPERA_MS = 1500;

/** Una franja abajo cuando el teléfono se queda sin señal, y un "volvió" corto
 *  cuando vuelve. En el depósito la señal va y viene: sin esto, un tilde que no
 *  se guardó solo mostraba un error genérico. Al volver, la pantalla se pide de
 *  nuevo, porque lo que muestra puede haber quedado viejo; salvo en el editor del
 *  pedido, que arma su estado una sola vez al montar y no cambia por refrescar. */
export function SinConexion() {
  const router = useRouter();
  const pathname = usePathname();
  const [estado, setEstado] = useState<"con" | "sin" | "volvio">("con");
  // En una referencia y no en las dependencias del efecto: si cambiara con cada
  // pantalla, el efecto se rearmaría y cortaría el "Volvió" que está a medio mostrar.
  const enElEditor = useRef(false);
  useEffect(() => {
    enElEditor.current = pathname.startsWith("/evento/");
  }, [pathname]);

  useEffect(() => {
    let reloj: ReturnType<typeof setTimeout> | undefined;
    // La espera previa a refrescar: otro reloj, que también hay que cortar.
    let espera: ReturnType<typeof setTimeout> | undefined;
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
      // Si la señal se va otra vez antes de refrescar, ese refresco ya no va.
      clearTimeout(espera);
      setEstado("sin");
    };
    const con = () => {
      if (!sinSenal) return;
      sinSenal = false;
      // Si ya había un "Volvió" en pantalla, su reloj viejo no tiene que cortar el nuevo.
      clearTimeout(reloj);
      clearTimeout(espera);
      setEstado("volvio");
      // El "Volvió" se muestra enseguida, pero la pantalla se pide recién cuando la
      // red tuvo tiempo de andar, y solo si para entonces sigue habiendo señal. En
      // el editor del pedido no se pide: ahí no aporta nada.
      espera = setTimeout(() => {
        if (navigator.onLine && !enElEditor.current) router.refresh();
      }, ESPERA_MS);
      reloj = setTimeout(() => setEstado("con"), 2500);
    };
    window.addEventListener("offline", sin);
    window.addEventListener("online", con);
    return () => {
      alive = false;
      clearTimeout(reloj);
      clearTimeout(espera);
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
