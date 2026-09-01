import { canVerImportes } from "@/lib/permissions";
import { aTextoPlano } from "@/lib/money";
import { leerQr, elegirQrDeFactura } from "./qr";
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
