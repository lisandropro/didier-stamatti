"use client";

import { useEffect, useRef, useState } from "react";

const IconDots = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5" r="1.9" />
    <circle cx="12" cy="12" r="1.9" />
    <circle cx="12" cy="19" r="1.9" />
  </svg>
);

export type RowMenuItem = { label: string; onSelect: () => void };

const ALTO_ITEM = 38;

/** Menú de tres puntitos para las acciones de una fila.
 *
 *  Se posiciona con coordenadas fijas y no con `absolute`: la tabla vive dentro
 *  de un contenedor con `overflow-x:auto`, que recortaría el desplegable. Por lo
 *  mismo se cierra al hacer scroll, para que no quede flotando lejos del botón. */
export function RowMenu({ items, label }: { items: RowMenuItem[]; label: string }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);

  function abrir() {
    if (pos) return setPos(null);
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const alto = items.length * ALTO_ITEM + 8;
    // Si no entra abajo, se despliega hacia arriba.
    const haciaArriba = r.bottom + alto > window.innerHeight - 8;
    setPos({
      top: haciaArriba ? r.top - alto - 4 : r.bottom + 4,
      right: Math.max(8, window.innerWidth - r.right),
    });
  }

  useEffect(() => {
    if (!pos) return;
    const afuera = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !lista.current?.contains(t)) setPos(null);
    };
    const cerrar = () => setPos(null);
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
        className="rowmenu-btn"
        onClick={abrir}
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        aria-label={label}
        title={label}
      >
        {IconDots}
      </button>
      {pos && (
        <div className="rowmenu-list" role="menu" ref={lista} style={{ top: pos.top, right: pos.right }}>
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              onClick={() => {
                setPos(null);
                it.onSelect();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
