import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canVerMargen } from "@/lib/permissions";
import { eventosConIngreso } from "@/app/actions/comprobantes";
import { hoy, sumarDias } from "@/lib/dates";
import { IngresosEventos } from "@/components/IngresosEventos";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ingresos" };

/**
 * Lo que se le cobró al cliente por cada evento.
 *
 * **Es la mitad que faltaba del margen.** El sistema sabía lo que costó una
 * fiesta —las facturas de proveedor, con su neto y su IVA— y no sabía lo que se
 * cobró por ella. Con una sola de las dos mitades no se puede decir si dejó
 * plata, por perfecta que sea la otra.
 *
 * **Pantalla aparte y no dentro del evento**, como lo pidió el usuario: el
 * evento lo mira también quien arma el pedido, y todo el diseño de permisos de
 * esta app existe para que a un teléfono de depósito no le llegue un importe.
 *
 * El permiso es `canVerMargen`: ADMIN y DIRECCION. **`PAGOS` queda afuera a
 * propósito** — lo que se le cobra a un cliente es más sensible que lo que se
 * le debe a un proveedor, y quien paga proveedores no lo necesita.
 */
export default async function IngresosPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const sesion = await getSessionUser();
  if (!sesion) redirect("/login");
  if (!canVerMargen(sesion.role)) redirect("/");

  // Por defecto, los últimos tres meses y los próximos tres: lo que ya pasó y
  // hay que cargar, y lo que viene y conviene tener cargado antes.
  const { desde, hasta } = await searchParams;
  const rango = {
    desde: esDiaValido(desde) ? desde : sumarDias(hoy(), -90),
    hasta: esDiaValido(hasta) ? hasta : sumarDias(hoy(), 90),
  };

  const r = await eventosConIngreso(rango.desde, rango.hasta);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Ingresos</h1>
          <div className="sub">Lo que se le cobró al cliente por cada evento</div>
        </div>
      </div>
      <div className="content">
        <p className="intro">
          Es la mitad que falta para medir el margen: el sistema ya sabe lo que costó cada fiesta,
          pero no lo que se cobró por ella. Se carga lo pactado en el presupuesto, se haya cobrado
          o no — es lo que dice si el evento fue buen negocio.
        </p>

        {!r.ok ? (
          <div className="login-error">{r.error}</div>
        ) : (
          <IngresosEventos filas={r.filas} />
        )}
      </div>
    </>
  );
}

/** Un parámetro de la URL no es una fecha hasta que se demuestre. */
function esDiaValido(v: string | undefined): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
