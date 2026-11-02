"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { estadoDelTiron, pantallaConTiron, UMBRAL } from "@/lib/tirar";

/** Tirar hacia abajo para actualizar, a mano. La app instalada apaga el estirón
 *  del navegador (`overscroll-behavior:none`, para que no se mueva todo el
 *  borde), y con él el "tirar para actualizar" que se espera en una lista.
 *
 *  Existe solo donde se mira una lista para ver si llegó algo: Período,
 *  Preparar y Avisos (`pantallaConTiron`). En el editor del pedido (`/evento/…`)
 *  no: ahí hay cantidades sin guardar, y actualizar pide la pantalla de nuevo
 *  al servidor. Tampoco en la pantalla ancha, que no cambia.
 *
 *  No decide nada: `estadoDelTiron` dice cuánto baja el indicador y cuándo está
 *  listo; esto solo mide el dedo y dibuja. Sigue a UN dedo, como el gesto de las
 *  hojas (`ComportamientoDeApp`): se guarda su `identifier` y se ignora el resto.
 *  Cuando no hay tirón no dibuja nada, así no ocupa un lugar en la grilla de
 *  `.app`; el indicador es `position:fixed`. */
export function TirarParaActualizar() {
  const router = useRouter();
  const pathname = usePathname();
  const activo = pantallaConTiron(pathname);
  const [actualizando, empezar] = useTransition();
  // null mientras no hay un dedo tirando.
  const [tiron, setTiron] = useState<{ y: number; listo: boolean } | null>(null);

  useEffect(() => {
    if (!activo) return;
    const celular = window.matchMedia("(max-width:860px)");
    let dedo: { id: number; x: number; y: number } | null = null;
    // Si el dedo ya pasó el umbral: es lo que decide, al soltar, si se actualiza.
    let pasoElUmbral = false;

    const soltarGesto = () => {
      dedo = null;
      pasoElUmbral = false;
      setTiron(null);
    };
    // Dentro de una lista que ya se scrolleó, bajar el dedo es para volver
    // arriba en ella, no para actualizar.
    const scrolleado = (desde: EventTarget | null) => {
      for (let el = desde instanceof Element ? desde : null; el; el = el.parentElement) {
        if (el.scrollTop > 0) return true;
      }
      return false;
    };
    const alTocar = (e: TouchEvent) => {
      // Un toque nuevo es un gesto nuevo. Con un segundo dedo (un pellizco) no
      // hay gesto, y solo se arranca con la pantalla en lo más alto: si no, bajar
      // el dedo es para volver arriba en la lista.
      soltarGesto();
      if (e.touches.length !== 1 || !celular.matches || window.scrollY > 0) return;
      const donde = e.target instanceof Element ? e.target : null;
      // Dentro de una hoja abierta (`.overlay`) o del menú "Más" (`.mobmas-fondo`)
      // el dedo es de esa ventana: actualizar sería tocar la pantalla de atrás.
      // Y sobre un campo, arrastrar es elegir texto.
      if (!donde || donde.closest(".overlay, .mobmas-fondo, input, textarea, select") || scrolleado(donde)) return;
      const t = e.touches[0];
      dedo = { id: t.identifier, x: t.clientX, y: t.clientY };
    };
    const alMover = (e: TouchEvent) => {
      const d = dedo;
      if (!d) return;
      const t = [...e.touches].find((x) => x.identifier === d.id);
      if (!t) return;
      const dy = t.clientY - d.y;
      const dx = t.clientX - d.x;
      const estado = estadoDelTiron(dy, dx);
      if (!estado.visible) {
        // Un temblor todavía no dice qué se quiere: se espera. Si fue de costado
        // o hacia arriba, el gesto es para scrollear y se deja en paz.
        if (dy < 0 || Math.abs(dx) > 10) return soltarGesto();
        pasoElUmbral = false;
        setTiron(null);
        return;
      }
      pasoElUmbral = estado.listo;
      setTiron({ y: estado.y, listo: estado.listo });
    };
    const alSoltar = (e: TouchEvent) => {
      const d = dedo;
      if (!d || ![...e.changedTouches].some((x) => x.identifier === d.id)) return;
      const actualizar = pasoElUmbral;
      soltarGesto();
      if (actualizar) empezar(() => router.refresh());
    };

    document.addEventListener("touchstart", alTocar, { passive: true });
    document.addEventListener("touchmove", alMover, { passive: true });
    document.addEventListener("touchend", alSoltar);
    // Si el sistema cancela el toque (una notificación, el gesto de volver), eso
    // no es soltar: no se actualiza.
    document.addEventListener("touchcancel", soltarGesto);
    return () => {
      document.removeEventListener("touchstart", alTocar);
      document.removeEventListener("touchmove", alMover);
      document.removeEventListener("touchend", alSoltar);
      document.removeEventListener("touchcancel", soltarGesto);
      dedo = null;
    };
  }, [activo, router]);

  if (!activo || (!tiron && !actualizando)) return null;
  const listo = tiron?.listo ?? false;
  return (
    <div
      className={`tiron${listo ? " listo" : ""}${actualizando ? " actualizando" : ""}`}
      style={{ transform: `translate(-50%, ${actualizando ? UMBRAL : (tiron?.y ?? 0)}px)` }}
      role="status"
      aria-label={actualizando ? "Actualizando" : listo ? "Soltá para actualizar" : "Tirá para actualizar"}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-2.6-6.4" />
        <path d="M21 4v5h-5" />
      </svg>
    </div>
  );
}
