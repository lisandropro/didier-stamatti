import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canVerImportes } from "@/lib/permissions";
import { deudaPorProveedor, vencimientosEntre, pendientes } from "@/app/actions/comprobantes";
import { hoy, sumarDias } from "@/lib/dates";
import ListaPagos from "./lista-pagos";

export const metadata = { title: "Pagos" };

/**
 * La pantalla de quien paga.
 *
 * Arranca en "qué vence" y no en un resumen: la pregunta que trae a alguien
 * acá es "¿qué pago hoy?", y un tablero de cifras la contesta más lento que
 * una lista ordenada por urgencia.
 */
export default async function PagosPage() {
  const sesion = await getSessionUser();
  if (!sesion) redirect("/login");
  if (!canVerImportes(sesion.role)) redirect("/");

  // Desde bastante atrás para que lo vencido aparezca, no solo lo que viene.
  const desde = sumarDias(hoy(), -365);
  const hasta = sumarDias(hoy(), 60);

  const [deuda, vencen, pend] = await Promise.all([
    deudaPorProveedor(),
    vencimientosEntre(desde, hasta),
    pendientes(),
  ]);

  return (
    <ListaPagos
      hoy={hoy()}
      deuda={deuda.filas ?? []}
      vencen={vencen.filas ?? []}
      bandejas={pend.bandejas ?? { sinProveedor: 0, sinRevisar: 0, sinVencimiento: 0 }}
      duplicados={pend.duplicados ?? []}
    />
  );
}
