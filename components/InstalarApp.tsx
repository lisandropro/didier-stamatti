"use client";

import { useEffect, useRef, useState } from "react";

type EventoInstalar = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/**
 * Instalar la app en el teléfono, guiado.
 *
 * En Android el navegador ofrece instalarla y se captura ese ofrecimiento para
 * un botón propio. En iPhone no hay botón posible: se explican los pasos, y que
 * los avisos solo llegan con la app instalada. Instalada, no aparece.
 */
export function InstalarApp() {
  const [modo, setModo] = useState<"oculto" | "android" | "ios">("oculto");
  const ofrecimiento = useRef<EventoInstalar | null>(null);

  useEffect(() => {
    let activo = true;
    const capturar = (e: Event) => {
      e.preventDefault();
      ofrecimiento.current = e as EventoInstalar;
      if (activo) setModo("android");
    };
    const instalada = () => {
      if (activo) setModo("oculto");
    };
    (async () => {
      // Un tick antes de decidir: el estado se setea fuera del cuerpo del efecto.
      await Promise.resolve();
      const yaInstalada =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (yaInstalada) return;
      // Un iPad con iPadOS se presenta como Mac: se lo reconoce por la pantalla táctil.
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (ios && activo) setModo("ios");
    })();
    window.addEventListener("beforeinstallprompt", capturar);
    window.addEventListener("appinstalled", instalada);
    return () => {
      activo = false;
      window.removeEventListener("beforeinstallprompt", capturar);
      window.removeEventListener("appinstalled", instalada);
    };
  }, []);

  async function instalar() {
    const e = ofrecimiento.current;
    if (!e) return;
    await e.prompt();
    await e.userChoice;
    // El ofrecimiento sirve una sola vez: aceptado o no, el botón ya no haría
    // nada. Si el navegador lo vuelve a ofrecer más adelante, reaparece solo.
    ofrecimiento.current = null;
    setModo("oculto");
  }

  if (modo === "oculto") return null;
  return (
    <div className="instalar">
      {modo === "android" ? (
        <>
          <span className="instalar-texto">Instalá la app: se abre con su ícono, sin la barra del navegador, y los avisos llegan mejor.</span>
          <button className="btn primary" onClick={instalar}>Instalar la app</button>
        </>
      ) : (
        <span className="instalar-texto">
          Para instalarla en iPhone: 1) tocá <b>Compartir</b> en Safari, 2) elegí <b>Agregar a inicio</b>, 3) abrí la app desde su ícono.
          En iPhone los avisos solo llegan con la app instalada.
        </span>
      )}
    </div>
  );
}
