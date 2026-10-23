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
    // El gesto es de UN dedo: se guarda el `identifier` del que lo empezó y
    // todo lo demás (mover, soltar) busca a ese. Si no, un segundo dedo que se
    // apoya o se levanta movería la hoja o la cerraría sin querer.
    const celular = window.matchMedia("(max-width:860px)");
    let arrastre: { id: number; x: number; y: number; moviendo: boolean; hoja: HTMLElement; fondo: HTMLElement } | null = null;
    // Devuelve la hoja a su lugar y deja de seguir al dedo. No cierra nada.
    const soltarGesto = () => {
      if (!arrastre) return;
      arrastre.hoja.style.transition = "";
      arrastre.hoja.style.transform = "";
      arrastre = null;
    };
    const scrolleado = (desde: EventTarget | null, hoja: HTMLElement) => {
      for (let el = desde instanceof Element ? desde : null; el && el !== hoja.parentElement; el = el.parentElement) {
        if (el instanceof HTMLElement && el.scrollTop > 0) return true;
      }
      return false;
    };
    const alTocar = (e: TouchEvent) => {
      if (!celular.matches || e.touches.length !== 1) return;
      // Un toque nuevo y solo es un gesto nuevo: si quedó uno colgado (su nodo
      // se desmontó y nunca llegó el "soltar"), no se arrastra la hoja de aquel.
      soltarGesto();
      const hoja = e.target instanceof Element ? e.target.closest<HTMLElement>(".modal") : null;
      const fondo = hoja?.parentElement;
      if (!hoja || !fondo?.classList.contains("overlay") || scrolleado(e.target, hoja)) return;
      if (e.target instanceof Element && e.target.closest("input, textarea, select")) return;
      const dedo = e.touches[0];
      arrastre = { id: dedo.identifier, x: dedo.clientX, y: dedo.clientY, moviendo: false, hoja, fondo };
    };
    const alMover = (e: TouchEvent) => {
      const a = arrastre;
      if (!a) return;
      const dedo = [...e.touches].find((t) => t.identifier === a.id);
      if (!dedo) return;
      const dy = dedo.clientY - a.y;
      if (!a.moviendo) {
        // La hoja no se mueve por un temblor del dedo: hasta que se corrió más
        // de 8 px no se sabe qué quiere. Si fue hacia abajo y más en vertical que
        // en horizontal, es para cerrar; si fue de costado o hacia arriba, el
        // gesto es para scrollear y la hoja no se toca.
        const dx = dedo.clientX - a.x;
        if (Math.max(Math.abs(dx), Math.abs(dy)) <= 8) return;
        if (!(dy > 8 && dy > Math.abs(dx))) return soltarGesto();
        a.moviendo = true;
      }
      a.hoja.style.transition = "none";
      a.hoja.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
    };
    const alSoltar = (e: TouchEvent) => {
      const a = arrastre;
      if (!a) return;
      const dedo = [...e.changedTouches].find((t) => t.identifier === a.id);
      if (!dedo) return;
      const cerrar = a.moviendo && dedo.clientY - a.y > 90;
      soltarGesto();
      if (cerrar) a.fondo.click();
    };

    document.addEventListener("contextmenu", sinMenu);
    document.addEventListener("gesturestart", sinPellizco);
    document.addEventListener("touchstart", alTocar, { passive: true });
    document.addEventListener("touchmove", alMover, { passive: true });
    document.addEventListener("touchend", alSoltar);
    // Si el sistema cancela el toque (se tapó con una notificación, lo agarró
    // el gesto de volver), eso no es un deslizamiento: la hoja vuelve a su
    // lugar y NO se cierra, por más que el dedo haya bajado.
    document.addEventListener("touchcancel", soltarGesto);
    pintarBarra();
    cambioDeTema.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      document.removeEventListener("contextmenu", sinMenu);
      document.removeEventListener("gesturestart", sinPellizco);
      document.removeEventListener("touchstart", alTocar);
      document.removeEventListener("touchmove", alMover);
      document.removeEventListener("touchend", alSoltar);
      document.removeEventListener("touchcancel", soltarGesto);
      cambioDeTema.disconnect();
    };
  }, []);
  return null;
}
