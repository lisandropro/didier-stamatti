import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canAdministrarComprobantes } from "@/lib/permissions";
import { todas } from "@/lib/comprobantes/entidades";
import { EntidadesManager } from "@/components/EntidadesManager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entidades" };

/**
 * A nombre de quién está cada factura.
 *
 * Es de ADMIN y no de quien paga: acá no se ve un solo importe, pero un CUIT
 * mal cargado manda al limbo todas las facturas de esa entidad sin dar un solo
 * error.
 */
export default async function EntidadesPage() {
  const sesion = await getSessionUser();
  if (!sesion) redirect("/login");
  if (!canAdministrarComprobantes(sesion.role)) redirect("/");

  const filas = await todas();

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Entidades</h1>
          <div className="sub">A nombre de quién vienen las facturas</div>
        </div>
      </div>
      <div className="content">
        <p className="msub">
          Cada factura pertenece a un contribuyente. La empresa y la UTE son dos, con CUIT y libro
          de IVA propios, y sus deudas no se suman. Cuando el comprobante trae QR, la entidad se
          reconoce sola por el CUIT del receptor.
        </p>
        <EntidadesManager filas={filas} />
      </div>
    </>
  );
}
