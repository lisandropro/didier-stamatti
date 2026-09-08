import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canCapturarComprobantes } from "@/lib/permissions";
import { capturasDelDia } from "@/lib/comprobantes/documentos";
import { activas } from "@/lib/comprobantes/entidades";
import { hoy, instanteDe } from "@/lib/dates";
import CapturaCliente from "./captura-cliente";

export const metadata = { title: "Recepción" };

/**
 * La pantalla del depósito.
 *
 * Se le pasa al cliente **lo mínimo y ni un importe**: quien recibe la
 * mercadería tiene rol RECEPCION y su teléfono no ve plata. Ni siquiera la de
 * la factura que acaba de fotografiar.
 */
export default async function RecepcionPage() {
  const sesion = await getSessionUser();
  if (!sesion) redirect("/login");
  if (!canCapturarComprobantes(sesion.role)) redirect("/");

  // "Hoy" es el día de calendario en Argentina, no las últimas 24 horas: quien
  // recibe piensa en jornadas, no en ventanas móviles.
  //
  // Las entidades van SIN el CUIT: el teléfono solo necesita el nombre para
  // pintar el botón, y mandar un dato fiscal a una pantalla que no lo usa es
  // exactamente lo que este archivo dice que no hace.
  const [capturas, entidades] = await Promise.all([
    capturasDelDia(sesion.id, instanteDe(hoy(), "00:00")),
    activas(),
  ]);

  return (
    <CapturaCliente
      capturasIniciales={capturas}
      entidades={entidades.map((e) => ({ id: e.id, nombre: e.nombre }))}
    />
  );
}
