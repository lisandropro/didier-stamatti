import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canVerPreparacion } from "@/lib/permissions";
import { eventosParaPreparar, DIAS_A_PREPARAR } from "@/lib/preparacion-db";
import { fmtEvento, hoy, sumarDias } from "@/lib/dates";
import { InstalarApp } from "@/components/InstalarApp";

export const dynamic = "force-dynamic";

export default async function PrepararPage() {
  // Como el resto: la pantalla comprueba su propio permiso.
  const sesion = await getSessionUser();
  if (!sesion || !canVerPreparacion(sesion.role)) notFound();

  const eventos = await eventosParaPreparar();
  const hoyDia = hoy();
  const manana = sumarDias(hoyDia, 1);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Preparar</h1>
          <div className="sub">Los eventos de los próximos {DIAS_A_PREPARAR} días</div>
        </div>
      </div>
      <div className="content">
        <InstalarApp />
        {eventos.length === 0 ? (
          <div className="empty-card">
            <p className="empty-title">No hay eventos para preparar</p>
            <p>Cuando se cargue un evento de los próximos {DIAS_A_PREPARAR} días, aparece acá.</p>
          </div>
        ) : (
          <div className="prep-lista">
            {eventos.map((e) => (
              <Link key={e.id} href={`/preparar/${e.id}`} className="prep-card">
                <div className="prep-card-top">
                  <b>{e.lugar}</b>
                  {e.dia === hoyDia && <span className="prep-dia hoy">HOY</span>}
                  {e.dia === manana && <span className="prep-dia">MAÑANA</span>}
                </div>
                <div className="prep-card-cuando">{fmtEvento(e.date)}</div>
                {e.cambiosParaAplicar > 0 && (
                  <div className="prep-alerta">
                    {e.cambiosParaAplicar} {e.cambiosParaAplicar === 1 ? "cambio para aplicar" : "cambios para aplicar"}
                  </div>
                )}
                <div className="prep-avance">
                  {e.avance.length === 0 ? (
                    <span className="prep-chip">Sin pedido todavía</span>
                  ) : (
                    e.avance.map((a) => (
                      <span key={a.category} className={`prep-chip${a.listos === a.total ? " ok" : ""}`}>
                        {a.label} {a.listos}/{a.total}
                      </span>
                    ))
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
