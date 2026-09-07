import { canVerImportes } from "@/lib/permissions";
import { aTextoPlano } from "@/lib/money";
import { leerQr, elegirQrDeFactura } from "./qr";
import { esDia, instanteDe } from "@/lib/dates";
import type { Cabecera, Destino, Kind } from "./tipos";
import type { DeudaProveedor } from "./pagos";

// Las decisiones que toman las server actions, fuera de las server actions.
//
// Viven acá por dos razones. La técnica: un archivo `"use server"` solo puede
// exportar funciones asíncronas, así que nada de esto podría vivir ahí. Y la
// buena: son las reglas que más importan del módulo —a quién se le da un
// importe, qué se acepta de lo que manda el navegador— y probarlas no debería
// necesitar levantar Next.

/** Un importe que cruza al navegador. `total` va en TEXTO porque
 *  `JSON.stringify` de un BigInt tira. */
export type FilaDeuda = {
  supplierId: string | null;
  nombre: string;
  total: string;
  cantidad: number;
  /** Cuántos de esos comprobantes NO tienen importe cargado.
   *
   *  Se calculaba y se tiraba acá. Sin esto, un proveedor cuyo único
   *  comprobante todavía no tiene importe se mostraba como **$ 0,00**, que se
   *  lee como "no debe nada" cuando lo que pasa es que no se sabe cuánto. */
  sinImporte: number;
};

/**
 * Si esta sesión puede recibir plata.
 *
 * Es la regla más importante del módulo. Toda acción que arme una respuesta con
 * importes pasa por acá **antes** de consultar la base: al teléfono del depósito
 * el número no le llega nunca, y no porque la pantalla lo esconda.
 */
export function puedeResponderImportes(sesion: { role: string } | null): boolean {
  return !!sesion && canVerImportes(sesion.role);
}

/** Convierte una fila de deuda en algo que puede viajar como JSON. */
export function aFilaDeuda(d: DeudaProveedor): FilaDeuda {
  return {
    supplierId: d.supplierId,
    nombre: d.nombre,
    total: aTextoPlano(d.total),
    cantidad: d.cantidad,
    sinImporte: d.sinImporte,
  };
}

/**
 * La cabecera, a partir de los QR que la cámara vio.
 *
 * El navegador manda los textos crudos y el servidor los vuelve a parsear. No
 * se confía en campos sueltos que mande el cliente: un navegador puede mandar
 * cualquier cosa, y un importe inventado que entre por acá termina en la
 * pantalla de quien paga.
 *
 * Una foto puede traer varios QR —el de AFIP, uno de marketing, el de Data
 * Fiscal—, así que primero se elige el de factura.
 */
export function cabeceraDeLaCaptura(qrVistos: string[]): Cabecera {
  const elegido = elegirQrDeFactura(qrVistos.filter((t) => typeof t === "string" && t));
  return (elegido && leerQr(elegido)) || { fuente: "MANUAL" };
}

const DESTINOS: Destino[] = ["COCINA", "DEPOSITO", "OTRO"];
const KINDS: Kind[] = ["FACTURA", "REMITO", "TICKET", "NOTA_CREDITO", "NOTA_DEBITO", "OTRO"];

/** Lo que no está en la lista se descarta y queda en NULL, que significa "no se
 *  sabe" — no un valor inventado que después nadie puede explicar. */
export function destinoValido(v: string): Destino | undefined {
  return (DESTINOS as string[]).includes(v) ? (v as Destino) : undefined;
}

/** Un tipo desconocido cae en OTRO en vez de rechazar la captura: la foto se
 *  guarda pase lo que pase, y el tipo se corrige después. */
export function kindValido(v: string): Kind {
  return (KINDS as string[]).includes(v) ? (v as Kind) : "OTRO";
}

/** Los códigos fiscales que el QR devuelve, mapeados al tipo del sistema. */
const POR_TIPO_FISCAL: Record<string, Kind> = {
  A: "FACTURA",
  B: "FACTURA",
  C: "FACTURA",
  M: "FACTURA",
  NOTA_CREDITO_A: "NOTA_CREDITO",
  NOTA_CREDITO_B: "NOTA_CREDITO",
  NOTA_CREDITO_C: "NOTA_CREDITO",
  NOTA_DEBITO_A: "NOTA_DEBITO",
  NOTA_DEBITO_B: "NOTA_DEBITO",
  NOTA_DEBITO_C: "NOTA_DEBITO",
};

/**
 * El tipo del comprobante: **el papel le gana al botón**.
 *
 * El signo de la plata lo decide `kind` —una nota de crédito resta, una factura
 * suma— y hasta ahora lo elegía la pantalla del depósito, que además tiene el
 * tipo fijo en "FACTURA". Una nota de crédito entraba como factura y **sumaba
 * en vez de restar**: un error del doble del importe, silencioso, decidido por
 * alguien que por diseño no puede ver importes.
 *
 * El QR ya traía el tipo fiscal correcto y nadie lo miraba. Cuando está, gana.
 * El botón sirve solo para lo que no tiene identidad fiscal: remitos, tickets y
 * comprobantes de proveedores informales.
 */
export function kindDelComprobante(tipoCbte: string | undefined, elegido: string): Kind {
  if (tipoCbte && POR_TIPO_FISCAL[tipoCbte]) return POR_TIPO_FISCAL[tipoCbte];
  return kindValido(elegido);
}

/** Cuántas fotos se aceptan en una sola captura.
 *
 *  Sin tope, un cliente podía mandar 2.000 archivos chicos válidos y el
 *  servidor hacía 2.000 subidas en serie en un solo pedido. */
export const MAX_FOTOS = 12;

/** La página que manda el navegador. Aceptaba `-5` y `1e999`. */
export function paginaValida(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 50) return 1;
  return n;
}

/**
 * La fecha en que salió la plata.
 *
 * `new Date("2026-02-30T12:00:00")` **no es una fecha inválida en JavaScript**:
 * rueda al 2 de marzo. Un dedo que erraba el día registraba el pago en otra
 * fecha, sin ningún error. Se valida el día de verdad, con la misma función
 * que ya usa el resto de la app.
 */
export function fechaDePago(dia: string | undefined, ahora: Date): Date | null {
  if (!dia) return ahora;
  if (!esDia(dia)) return null;
  // Mediodía en Argentina: con la hora en 00:00 un corrimiento de zona horaria
  // puede tirar el pago al día anterior.
  return instanteDe(dia, "12:00");
}
