import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canPagar } from "@/lib/permissions";
import { conCondicion } from "@/lib/comprobantes/condiciones";
import { activas } from "@/lib/comprobantes/entidades";
import { formatear } from "@/lib/money";
import { hoy } from "@/lib/dates";
import { CondicionesPago } from "@/components/CondicionesPago";

export const dynamic = "force-dynamic";
export const metadata = { title: "Proveedores" };

/**
 * A cuántos días se le paga a cada proveedor.
 *
 * **Por qué existe esta pantalla.** La mayoría de las facturas no traen fecha
 * de vencimiento: son cuenta corriente, y el plazo se pacta con cada proveedor.
 * Sin ese dato, la pantalla de pagos sabe cuánto se debe pero no qué pagar
 * primero — que es la pregunta que trae a alguien a mirarla.
 *
 * La alternativa era cargar el vencimiento factura por factura. Con 145
 * facturas nuevas por importación eso es trabajo inventado, y además produce un
 * número falso: no vence nada, se paga cuando se acordó pagar. El plazo se
 * carga **una vez por proveedor** y sirve para todas sus facturas, las de hoy y
 * las que vengan.
 *
 * El permiso es `canPagar` y no `canAdministrarComprobantes`: pactar cómo se le
 * paga a un proveedor es parte de pagar, no de administrar el sistema. Si sólo
 * pudiera el ADMIN, la persona que efectivamente paga tendría que pedirle a
 * otra que le cargue el dato, y eso es como un dato se queda sin cargar.
 */
export default async function ProveedoresPage({
  searchParams,
}: {
  searchParams: Promise<{ entidad?: string }>;
}) {
  const sesion = await getSessionUser();
  if (!sesion) redirect("/login");
  if (!canPagar(sesion.role)) redirect("/");

  // **El mismo filtro que la pantalla de pagos.** Sin esto, la deuda que ordena
  // esta lista suma dos contribuyentes en cuanto exista una segunda entidad, y
  // el orden —que es todo el valor de la pantalla— sale mal sin avisar. Hoy hay
  // una sola entidad activa, así que el error no se vería: por eso conviene que
  // el filtro exista antes y no después.
  const entidades = await activas();
  const pedida = (await searchParams).entidad;
  const entidadId =
    pedida === "sin" ? null : entidades.some((e) => e.id === pedida) ? pedida : undefined;

  const filas = await conCondicion(entidadId);
  const conDeuda = filas.filter((f) => f.comprobantes > 0);
  const deudaTotal = conDeuda.reduce((a, f) => a + f.deuda, 0n);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Proveedores</h1>
          <div className="sub">A cuántos días se le paga a cada uno</div>
        </div>
      </div>
      <div className="content">
        <p className="intro">
          La mayoría de las facturas no trae fecha de vencimiento: el plazo se pacta con cada
          proveedor. Cargalo una vez acá y todas sus facturas —las de ahora y las que vengan—
          reciben su fecha de pago calculada, sin tipear ninguna.
        </p>

        {conDeuda.length > 0 && (
          <p className="cond-total">
            Hoy se le debe algo a <strong>{conDeuda.length}</strong> proveedor
            {conDeuda.length === 1 ? "" : "es"}, por <strong>{formatear(deudaTotal)}</strong>.
          </p>
        )}

        <CondicionesPago
          hoy={hoy()}
          filas={filas.map((f) => ({ ...f, deuda: formatear(f.deuda) }))}
        />
      </div>
    </>
  );
}
