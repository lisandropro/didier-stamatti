"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const IconDots = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5" r="1.9" />
    <circle cx="12" cy="12" r="1.9" />
    <circle cx="12" cy="19" r="1.9" />
  </svg>
);

export type RowMenuItem = { label: string; onSelect: () => void; disabled?: boolean; peligro?: boolean };

// Alto de un ítem para decidir si el menú entra hacia abajo. En el celular cada
// ítem mide lo que un dedo (44 px); en la pantalla ancha mide menos, y
// sobreestimar solo hace que a veces se abra hacia arriba.
const ALTO_ITEM = 44;

/** Menú de tres puntitos para las acciones de una fila.
 *
 *  Se posiciona con coordenadas fijas y no con `absolute`: la tabla vive dentro
 *  de un contenedor con `overflow-x:auto`, que recortaría el desplegable. Por lo
 *  mismo se cierra al hacer scroll, para que no quede flotando lejos del botón.
 *  Salvo el scroll de la propia lista: si no entra en la pantalla, se desplaza
 *  adentro y no se cierra.
 *
 *  La lista se dibuja en el `body` (`createPortal`) y no al lado del botón: la
 *  cabecera del editor tiene `backdrop-filter`, que la vuelve la caja de
 *  referencia de todo `position:fixed` que tenga adentro. Si la cabecera no
 *  está pegada arriba de todo (en la portada del celular deja de ser fija), el
 *  menú se abría corrido. En el body, además, queda por encima de la barra de
 *  abajo (`.mobnav`).
 *  `grande`: el botón mide lo que un dedo, para la cabecera del celular. */
export function RowMenu({ items, label, grande = false }: { items: RowMenuItem[]; label: string; grande?: boolean }) {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number; maxHeight: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const abiertoConTeclado = useRef(false);

  function abrir() {
    if (pos) return setPos(null);
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const alto = items.length * ALTO_ITEM + 8;
    const abajo = window.innerHeight - r.bottom - 12;
    const arriba = r.top - 12;
    // Hacia arriba solo si abajo no entra y arriba hay más lugar.
    const haciaArriba = alto > abajo && arriba > abajo;
    const lugar = haciaArriba ? arriba : abajo;
    // Hacia arriba la lista se ancla por abajo y no con un `top` calculado: el
    // alto estimado (`ALTO_ITEM`) sobreestima en la pantalla ancha y la lista
    // quedaba flotando unos píxeles arriba del botón.
    setPos(
      haciaArriba
        ? { bottom: window.innerHeight - r.top + 4, right: Math.max(8, window.innerWidth - r.right), maxHeight: lugar }
        : { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right), maxHeight: lugar },
    );
  }

  useEffect(() => {
    if (!pos) return;
    const afuera = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !lista.current?.contains(t)) setPos(null);
    };
    const cerrar = (e: Event) => {
      if (e.target instanceof Node && lista.current?.contains(e.target)) return;
      setPos(null);
    };
    // Con teclado: Escape cierra y devuelve el foco al botón; las flechas
    // recorren los ítems (Tab se iría al final de la página, porque la lista
    // se dibuja en el body).
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Marcado como usado: si hay una ventana debajo, no se cierra también.
        e.preventDefault();
        setPos(null);
        btn.current?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Tab") return;
      const opciones = [...(lista.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      if (opciones.length === 0) return;
      e.preventDefault();
      const i = opciones.indexOf(document.activeElement as HTMLButtonElement);
      const paso = e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1;
      opciones[(i + paso + opciones.length) % opciones.length].focus();
    };
    // Abierto con el teclado (Enter o espacio sobre el ⋯), el foco entra al
    // primer ítem. Con el dedo o el mouse no hace falta y no se mueve nada.
    if (abiertoConTeclado.current) lista.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    // Cambiar el tamaño de la ventana (o girar el teléfono) deja el menú mal
    // parado y lo cierra. Pero en el celular el teclado también dispara
    // `resize` —la pantalla se achica de alto, `resizes-content`—: tocar el ⋯
    // con el teclado abierto lo cierra, y el menú se abría y se cerraba solo.
    // El teclado no cambia el ancho; girar o redimensionar la ventana, sí.
    const anchoAlAbrir = window.innerWidth;
    const alCambiarTamano = () => {
      if (window.innerWidth !== anchoAlAbrir) setPos(null);
    };
    document.addEventListener("mousedown", afuera);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", alCambiarTamano);
    return () => {
      document.removeEventListener("mousedown", afuera);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", cerrar, true);
      window.removeEventListener("resize", alCambiarTamano);
    };
  }, [pos]);

  return (
    <>
      <button
        ref={btn}
        className={`rowmenu-btn${grande ? " grande" : ""}`}
        type="button"
        // `detail` es 0 cuando el clic vino del teclado.
        onClick={(e) => {
          abiertoConTeclado.current = e.detail === 0;
          abrir();
        }}
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        aria-label={label}
        title={label}
      >
        {IconDots}
      </button>
      {pos &&
        createPortal(
          <div className="rowmenu-list" role="menu" ref={lista} style={{ top: pos.top, bottom: pos.bottom, right: pos.right, maxHeight: pos.maxHeight }}>
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                className={it.peligro ? "peligro" : undefined}
                onClick={() => {
                  setPos(null);
                  // El foco vuelve al ⋯ antes de actuar: si la acción abre una
                  // ventana, al cerrarla el foco tiene a dónde volver.
                  btn.current?.focus({ preventScroll: true });
                  it.onSelect();
                }}
              >
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
