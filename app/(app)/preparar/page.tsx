import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canVerPreparacion } from "@/lib/permissions";
import { eventosParaPreparar, DIAS_A_PREPARAR } from "@/lib/preparacion-db";
import { fmtEvento, haceCuanto, hoy, sumarDias } from "@/lib/dates";
import { InstalarApp } from "@/components/InstalarApp";
import { RefrescoPeriodico } from "@/components/RefrescoPeriodico";

export const dynamic = "force-dynamic";

/** Cuántas acciones entran en la tarjeta; el resto se cuenta ("y 2 más"). */
const MAX_EN_TARJETA = 3;
/** Un cambio de las últimas 24 horas se destaca en naranja. */
const UN_DIA = 24 * 60 * 60 * 1000;

export default async function PrepararPage() {
  // Como el resto: la pantalla comprueba su propio permiso.
  const sesion = await getSessionUser();
  if (!sesion || !canVerPreparacion(sesion.role)) notFound();

  const eventos = await eventosParaPreparar();
  const hoyDia = hoy();
  const manana = sumarDias(hoyDia, 1);
  const ahora = new Date();

  return (
    <>
      {/* La lista también se actualiza sola: un cambio de Enrique aparece en la
          tarjeta sin recargar. */}
      <RefrescoPeriodico />
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
                {/* Qué rehacer, dicho en la tarjeta: sin abrir el evento ya se sabe
                    qué agregar o sacar de lo que estaba preparado. */}
                {e.acciones.length > 0 && (
                  <div className="prep-alerta">
                    ⚠ Para rehacer: {e.acciones.slice(0, MAX_EN_TARJETA).join(" · ")}
                    {e.acciones.length > MAX_EN_TARJETA ? ` · y ${e.acciones.length - MAX_EN_TARJETA} más` : ""}
                  </div>
                )}
                {/* Aunque no haya nada tildado: quien prepara de memoria o con un
                    papel tiene que enterarse de que el pedido se movió. */}
                {e.ultimoCambio && (
                  <div className={`prep-card-cambio${ahora.getTime() - e.ultimoCambio.at.getTime() < UN_DIA ? " reciente" : ""}`}>
                    Último cambio: {e.ultimoCambio.actorName}, {haceCuanto(e.ultimoCambio.at, ahora)}
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
