import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canVerImportes } from "@/lib/permissions";
import {
  deudaPorProveedor,
  vencimientosEntre,
  pendientes,
  debitosDelMes,
  proveedoresSinPlazo,
} from "@/app/actions/comprobantes";
import { activas } from "@/lib/comprobantes/entidades";
import { hoy, sumarDias } from "@/lib/dates";
import ListaPagos from "./lista-pagos";

export const metadata = { title: "Pagos" };

/**
 * La pantalla de quien paga.
 *
 * Arranca en "qué vence" y no en un resumen: la pregunta que trae a alguien
 * acá es "¿qué pago hoy?", y un tablero de cifras la contesta más lento que
 * una lista ordenada por urgencia.
 *
 * **El filtro de entidad va en la URL y no en el estado del cliente.** Sobrevive
 * a un refresh, se puede dejar abierto en una pestaña y se puede mandar por
 * mensaje. En una pantalla de plata además importa que el filtro esté a la
 * vista: un total sin saber de qué entidad es, es un total que no significa
 * nada.
 */
export default async function PagosPage({
  searchParams,
}: {
  searchParams: Promise<{ entidad?: string }>;
}) {
  const sesion = await getSessionUser();
  if (!sesion) redirect("/login");
  if (!canVerImportes(sesion.role)) redirect("/");

  const entidades = await activas();
  const pedida = (await searchParams).entidad;

  // Tres casos y los tres distintos:
  //   ausente     -> todas
  //   "sin"       -> SOLO las que quedaron sin entidad, que es lo que hay que ir
  //                  a resolver y no un subconjunto de "todas"
  //   un id       -> esa, si existe
  //
  // Un id que no existe cae en "todas" en vez de mostrar una lista vacía: una
  // pantalla vacía por un parámetro mal escrito se lee como "no debemos nada".
  const entidadId =
    pedida === "sin" ? null : entidades.some((e) => e.id === pedida) ? pedida : undefined;

  // Desde bastante atrás para que lo vencido aparezca, no solo lo que viene.
  const desde = sumarDias(hoy(), -365);
  const hasta = sumarDias(hoy(), 60);

  const [deuda, vencen, pend, debitos, sinPlazo] = await Promise.all([
    deudaPorProveedor(entidadId),
    vencimientosEntre(desde, hasta, entidadId),
    pendientes(),
    debitosDelMes(entidadId),
    proveedoresSinPlazo(entidadId),
  ]);

  return (
    <ListaPagos
      hoy={hoy()}
      deuda={deuda.filas ?? []}
      vencen={vencen.filas ?? []}
      bandejas={pend.bandejas ?? { sinProveedor: 0, sinRevisar: 0, sinVencimiento: 0 }}
      duplicados={pend.duplicados ?? []}
      incompletos={pend.incompletos ?? []}
      entidades={entidades.map((e) => ({ id: e.id, nombre: e.nombre }))}
      entidadElegida={pedida === "sin" ? "sin" : (entidadId ?? "")}
      sinEntidad={pend.sinEntidad ?? 0}
      huerfanos={pend.huerfanos ?? []}
      sinPlazo={sinPlazo.ok ? sinPlazo.cantidad : 0}
      debitos={
        debitos.ok && debitos.cantidad > 0
          ? { cantidad: debitos.cantidad, total: debitos.total, sinImporte: debitos.sinImporte }
          : null
      }
    />
  );
}
