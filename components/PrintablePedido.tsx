"use client";

import { Fragment, useEffect, useState } from "react";
import { flushSync } from "react-dom";

export type Bloque = { clave: string; tipo: "cartel" | "seccion"; nodo: React.ReactNode };
export type Modo = "todo" | "pedido" | "carteles";

/** Qué bloques salen por la impresora en cada modo. */
export function bloquesVisibles<T extends { tipo: "cartel" | "seccion" }>(bloques: T[], modo: Modo): T[] {
  if (modo === "todo") return bloques;
  const buscado = modo === "carteles" ? "cartel" : "seccion";
  return bloques.filter((b) => b.tipo === buscado);
}

/**
 * Lo que se imprime, y qué parte.
 *
 * En pantalla se ve todo junto: los cartelitos y las hojas del pedido, en el
 * orden en que salen de la impresora. Al imprimir una sola parte, la otra se
 * **saca del DOM** en vez de esconderse con CSS. No es capricho: cada bloque
 * lleva un salto de página y la regla que lo evita en el último usa
 * `:last-child`, que sigue apuntando al bloque escondido. Escondiendo con CSS
 * salía una hoja en blanco al final.
 *
 * Los botones viven en la barra de arriba, fuera de este componente, así que se
 * hablan por un evento del navegador — el mismo mecanismo que ya usa el
 * formulario de sugerencias.
 */
export function PrintablePedido({ bloques }: { bloques: Bloque[] }) {
  const [modo, setModo] = useState<Modo>("todo");

  useEffect(() => {
    function imprimir(e: Event) {
      const que = (e as CustomEvent<"pedido" | "carteles">).detail;
      // flushSync obliga a que React pinte ANTES de abrir el diálogo de
      // impresión: window.print() es sincrónico y no espera al siguiente render.
      flushSync(() => setModo(que));
      try {
        window.print();
      } finally {
        setModo("todo");
      }
    }
    window.addEventListener("imprimir-parte", imprimir);
    return () => window.removeEventListener("imprimir-parte", imprimir);
  }, []);

  const visibles = bloquesVisibles(bloques, modo);

  // Fragment y no un <div>: los carteles y las secciones tienen que seguir
  // siendo hijos DIRECTOS de .pdf-content. De eso dependen el salto de página
  // entre bloques y la hoja apaisada del cartel, que se elige con `page:cartel`
  // sobre la caja que genera la página.
  return (
    <>
      {visibles.map((b) => (
        <Fragment key={b.clave}>{b.nodo}</Fragment>
      ))}
    </>
  );
}

/** Lo llaman los botones de la barra. */
export function imprimirParte(que: "pedido" | "carteles") {
  window.dispatchEvent(new CustomEvent("imprimir-parte", { detail: que }));
}
