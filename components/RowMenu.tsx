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
  const [pos, setPos] = useState<{ top: number; right: number; maxHeight: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);

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
    setPos({
      top: haciaArriba ? r.top - Math.min(alto, lugar) - 4 : r.bottom + 4,
      right: Math.max(8, window.innerWidth - r.right),
      maxHeight: lugar,
    });
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
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    document.addEventListener("mousedown", afuera);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrar);
    return () => {
      document.removeEventListener("mousedown", afuera);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", cerrar, true);
      window.removeEventListener("resize", cerrar);
    };
  }, [pos]);

  return (
    <>
      <button
        ref={btn}
        className={`rowmenu-btn${grande ? " grande" : ""}`}
        onClick={abrir}
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        aria-label={label}
        title={label}
      >
        {IconDots}
      </button>
      {pos &&
        createPortal(
          <div className="rowmenu-list" role="menu" ref={lista} style={{ top: pos.top, right: pos.right, maxHeight: pos.maxHeight }}>
            {items.map((it) => (
              <button
                key={it.label}
                role="menuitem"
                disabled={it.disabled}
                className={it.peligro ? "peligro" : undefined}
                onClick={() => {
                  setPos(null);
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
