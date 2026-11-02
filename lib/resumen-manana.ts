// El texto del resumen de la mañana, en un solo lugar y sin base de datos.
//
// Es un único push por persona y por día: "qué tengo hoy y mañana". Sale una
// sola vez para no ser un aviso más entre los de cambios de pedido, y sale de
// mañana (entre las 7 y las 11, hora argentina) porque a la tarde un "resumen
// de la mañana" confunde. Esta función solo arma el texto de lo que recibe;
// quién lo recibe, cuándo y si ya salió hoy lo decide quien la llama.
//
// Cada rol ve lo suyo: todos, los eventos de hoy y de mañana y los productos
// que faltan; quien arma pedidos, además, qué eventos no tienen pedido o no
// están marcados listos; la administradora, además, quién todavía no tiene los
// avisos activados en ningún teléfono.

import { canEditOrders } from "./permissions";
import { MAX_CUERPO, recortar } from "./aviso-texto";

/** Desde las 7:00 hora argentina. */
export const HORA_DESDE = 7;
/** Después de las 11 ya no es "de la mañana". */
export const HORA_HASTA = 11;

/** ¿Es hora de mandar el resumen? `hora` es la hora argentina, de 0 a 23. */
export function esHoraDelResumen(hora: number): boolean {
  return hora >= HORA_DESDE && hora < HORA_HASTA;
}

/** Un evento de hoy o de mañana: su lugar, cuántos renglones tiene el pedido
 *  y si ya lo marcaron listo. */
export type EventoDelResumen = { lugar: string; renglones: number; listo: boolean };

export type DatosDelResumen = {
  hoy: EventoDelResumen[];
  manana: EventoDelResumen[];
  /** Cuántos productos faltan en los períodos de esos eventos. */
  faltan: number;
  /** Nombres de quienes no tienen los avisos activados en ningún teléfono. */
  sinAvisos: string[];
};

const MAX_NOMBRES = 3;

/** "A", "A y B", "A, B y C". */
function unidos(nombres: string[]): string {
  if (nombres.length <= 1) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

/** "Hoy: A, B, C y 2 más", o "Hoy no hay eventos." si el día está vacío. */
function lineaDelDia(dia: string, eventos: EventoDelResumen[]): string {
  if (eventos.length === 0) return `${dia} no hay eventos.`;
  const nombres = eventos.map((e) => e.lugar);
  const lista =
    nombres.length > MAX_NOMBRES
      ? `${nombres.slice(0, MAX_NOMBRES).join(", ")} y ${nombres.length - MAX_NOMBRES} más`
      : unidos(nombres);
  return `${dia}: ${lista}`;
}

/**
 * Título, cuerpo y destino del resumen de la mañana para alguien con ese rol.
 * `null` si no hay eventos ni hoy ni mañana: no hay nada que resumir y el
 * teléfono no suena.
 *
 * Destino al tocarlo: el depósito va a Preparar; el resto, al inicio.
 */
export function textoDelResumen(rol: string, d: DatosDelResumen): { title: string; body: string; url: string } | null {
  if (d.hoy.length === 0 && d.manana.length === 0) return null;

  const lineas = [lineaDelDia("Hoy", d.hoy), lineaDelDia("Mañana", d.manana)];

  if (canEditOrders(rol)) {
    const eventos = [...d.hoy, ...d.manana];
    const sinPedido = eventos.filter((e) => e.renglones === 0).length;
    const sinListo = eventos.filter((e) => e.renglones > 0 && !e.listo).length;
    const pendientes: string[] = [];
    if (sinPedido > 0) pendientes.push(`Sin pedido: ${sinPedido}`);
    if (sinListo > 0) pendientes.push(`Sin marcar listo: ${sinListo}`);
    if (pendientes.length > 0) lineas.push(pendientes.join(" · "));
  }

  if (d.faltan > 0) {
    lineas.push(`Faltan ${d.faltan} ${d.faltan === 1 ? "producto" : "productos"} en el depósito.`);
  }

  if (rol === "ADMIN" && d.sinAvisos.length > 0) {
    lineas.push(`Sin avisos en el celular: ${d.sinAvisos.join(", ")}`);
  }

  return {
    title: "Hoy y mañana",
    body: recortar(lineas.join("\n"), MAX_CUERPO),
    url: rol === "DEPOSITO" ? "/preparar" : "/",
  };
}
