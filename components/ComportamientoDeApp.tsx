"use client";

import { useEffect } from "react";

/** Lo que el CSS no alcanza para que la app instalada se sienta una app y no
 *  una página web. No dibuja nada.
 *
 *  - Mantener apretado un enlace abre el menú del navegador ("abrir en pestaña
 *    nueva", "copiar enlace"): en una app eso no existe. Se frena solo en
 *    pantallas táctiles —con mouse, el clic derecho sigue andando— y nunca en
 *    los campos de texto, donde sirve para pegar.
 *  - Safari del iPhone ignora `user-scalable=no`: el pellizco se frena acá.
 *  - La barra del sistema toma el color del fondo del tema elegido en la app,
 *    no del tema del teléfono: si alguien eligió oscuro con el teléfono en
 *    claro, la barra quedaba blanca sobre una app negra.
 *  - Deslizar una hoja hacia abajo la cierra, como en cualquier app de Android.
 *    No conoce a ninguna ventana: usa el mismo cierre que ya tiene cada una al
 *    tocar afuera. */
export function ComportamientoDeApp() {
  useEffect(() => {
    const tactil = window.matchMedia("(pointer: coarse)");
    const sinMenu = (e: MouseEvent) => {
      if (!tactil.matches) return;
      if (e.target instanceof Element && e.target.closest("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
    };
    const sinPellizco = (e: Event) => e.preventDefault();

    const pintarBarra = () => {
      const color = getComputedStyle(document.body).backgroundColor;
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", color));
    };
    const cambioDeTema = new MutationObserver(pintarBarra);

    // Deslizar hacia abajo cierra la hoja, como en Android. No conoce a ningún
    // modal: al soltar, hace clic en su fondo, que es como ya se cierra cada
    // uno al tocar afuera. Si una ventana no se cierra tocando afuera (por
    // ejemplo, mientras borra), tampoco se cierra deslizando: vuelve a su lugar.
    // Solo arranca si lo que está bajo el dedo no está scrolleado: si no, el
    // gesto es para subir el contenido, no para cerrar.
    const celular = window.matchMedia("(max-width:860px)");
    let arrastre: { y: number; hoja: HTMLElement; fondo: HTMLElement } | null = null;
    const scrolleado = (desde: EventTarget | null, hoja: HTMLElement) => {
      for (let el = desde instanceof Element ? desde : null; el && el !== hoja.parentElement; el = el.parentElement) {
        if (el instanceof HTMLElement && el.scrollTop > 0) return true;
      }
      return false;
    };
    const alTocar = (e: TouchEvent) => {
      if (!celular.matches || e.touches.length !== 1) return;
      const hoja = e.target instanceof Element ? e.target.closest<HTMLElement>(".modal") : null;
      const fondo = hoja?.parentElement;
      if (!hoja || !fondo?.classList.contains("overlay") || scrolleado(e.target, hoja)) return;
      if (e.target instanceof Element && e.target.closest("input, textarea, select")) return;
      arrastre = { y: e.touches[0].clientY, hoja, fondo };
    };
    const alMover = (e: TouchEvent) => {
      if (!arrastre) return;
      const dy = e.touches[0].clientY - arrastre.y;
      arrastre.hoja.style.transition = "none";
      arrastre.hoja.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
    };
    const alSoltar = (e: TouchEvent) => {
      if (!arrastre) return;
      const { hoja, fondo, y } = arrastre;
      arrastre = null;
      const dy = e.changedTouches[0].clientY - y;
      hoja.style.transition = "";
      hoja.style.transform = "";
      if (dy > 90) fondo.click();
    };

    document.addEventListener("contextmenu", sinMenu);
    document.addEventListener("gesturestart", sinPellizco);
    document.addEventListener("touchstart", alTocar, { passive: true });
    document.addEventListener("touchmove", alMover, { passive: true });
    document.addEventListener("touchend", alSoltar);
    document.addEventListener("touchcancel", alSoltar);
    pintarBarra();
    cambioDeTema.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      document.removeEventListener("contextmenu", sinMenu);
      document.removeEventListener("gesturestart", sinPellizco);
      document.removeEventListener("touchstart", alTocar);
      document.removeEventListener("touchmove", alMover);
      document.removeEventListener("touchend", alSoltar);
      document.removeEventListener("touchcancel", alSoltar);
      cambioDeTema.disconnect();
    };
  }, []);
  return null;
}
