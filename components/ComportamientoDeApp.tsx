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
 *    claro, la barra quedaba blanca sobre una app negra. */
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

    document.addEventListener("contextmenu", sinMenu);
    document.addEventListener("gesturestart", sinPellizco);
    pintarBarra();
    cambioDeTema.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      document.removeEventListener("contextmenu", sinMenu);
      document.removeEventListener("gesturestart", sinPellizco);
      cambioDeTema.disconnect();
    };
  }, []);
  return null;
}
