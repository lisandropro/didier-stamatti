/* Ayudas chicas que usan varias pantallas. Antes cada una tenía su copia. */

import type { WheelEvent } from "react";

/** Para buscar sin que importen tildes ni mayúsculas: "Mantelería" → "manteleria". */
export const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** " cajas", " juegos"… o nada cuando la unidad es la común. */
export const unidad = (u: string) => (u === "Unidad" ? "" : ` ${u.toLowerCase()}`);

/**
 * Con el cursor encima de un campo numérico enfocado, la rueda del mouse le
 * cambia el valor: al scrollear una lista se alteraba una cantidad sin querer,
 * y en el editor del pedido eso se guarda solo. Sacarle el foco deja que la
 * rueda haga lo que se esperaba, que es scrollear.
 *
 * Va como `onWheel={sinRueda}` en todo `<input type="number">`.
 */
export const sinRueda = (e: WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

/** Unidades que ya se usan en el catálogo, para no inventar variantes nuevas. */
export const UNIDADES = ["Unidad", "Juego", "Módulo", "Caja", "Cajón", "Pack", "Paquete", "Bolsa", "Botella", "Lata", "Litro", "Kg"];

/** Los motivos de un movimiento de stock. `l` es el nombre corto (filtros y
 *  chips del Historial); `detalle`, el que se lee al elegirlo en "Editar stock". */
export const MOTIVOS_DE_STOCK: { v: string; l: string; detalle: string }[] = [
  { v: "COMPRA", l: "Compra", detalle: "Compra / ingreso" },
  { v: "ROTURA", l: "Rotura", detalle: "Rotura" },
  { v: "PERDIDA", l: "Pérdida", detalle: "Pérdida" },
  { v: "AJUSTE", l: "Ajuste", detalle: "Ajuste / conteo" },
];
