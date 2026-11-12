"use client";

import { ViewTransition, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * El paso de una pantalla a otra: la vieja se apaga en un instante y la nueva
 * entra subiendo apenas. Sin esto la pantalla cambiaba de golpe y, con el
 * esqueleto de carga en el medio, se sentía como tres saltos seguidos.
 *
 * Va en el layout, alrededor de lo que cambia, con la ruta como `key`: el
 * layout no se vuelve a montar al navegar, así que sin la `key` React no vería
 * una pantalla que sale y otra que entra. Solo cuenta la ruta, no la consulta:
 * cambiar de período (`?w=`) es la misma pantalla con otros datos.
 *
 * `default="none"`: el refresco periódico, tirar para actualizar y lo que
 * guarda una acción también son transiciones, y ninguna tiene que animar.
 *
 * Donde el navegador no sabe hacerlo (Safari viejo), cambia de golpe como
 * antes. Con "reducir movimiento" no anima (globals.css).
 */
export function Pantalla({ children }: { children: ReactNode }) {
  const ruta = usePathname();
  return (
    <ViewTransition key={ruta} enter="pantalla-entra" exit="pantalla-sale" default="none">
      {children}
    </ViewTransition>
  );
}

/** El esqueleto de carga se va apagándose cuando llega la pantalla de verdad,
 *  en vez de ser reemplazado de golpe. */
export function SalidaDeEsqueleto({ children }: { children: ReactNode }) {
  return (
    <ViewTransition exit="esqueleto-sale" default="none">
      {children}
    </ViewTransition>
  );
}
