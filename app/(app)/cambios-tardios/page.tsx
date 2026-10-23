import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { canManageUsers } from "@/lib/permissions";
import { registroTardio } from "@/lib/cambios-tardios";
import { describirCambio } from "@/lib/aviso-texto";
import { fmtEvento, fmtMomento } from "@/lib/dates";
import { nombreDe } from "@/lib/period-fit";

export const dynamic = "force-dynamic";

export default async function CambiosTardiosPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const sesion = await getSessionUser();
  if (!sesion || !canManageUsers(sesion.role)) notFound();

  const { p } = await searchParams;
  const periodos = await prisma.operationalPeriod.findMany({
    where: { deletedAt: null },
    orderBy: { startDay: "desc" },
    take: 20,
    select: { id: true, label: true, startDay: true, endDay: true },
  });
  const elegido = periodos.find((x) => x.id === p) ?? null;
  const r = await registroTardio(elegido?.id);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Cambios tardíos</h1>
          <div className="sub">Lo que se cambió en un pedido después de que el depósito lo preparó</div>
        </div>
      </div>
      <div className="content">
        <div className="searchbar">
          <div className="filtros-scroll">
            <Link className={`tab${elegido ? "" : " active"}`} href="/cambios-tardios">Todos</Link>
            {periodos.map((x) => (
              <Link key={x.id} className={`tab${elegido?.id === x.id ? " active" : ""}`} href={`/cambios-tardios?p=${x.id}`}>
                {nombreDe(x)}
              </Link>
            ))}
          </div>
        </div>

        {r.total === 0 ? (
          <div className="empty-card">
            <p className="empty-title">No hubo cambios tardíos</p>
            <p>Aparecen cuando alguien cambia un ítem que el depósito ya había tildado como preparado.</p>
          </div>
        ) : (
          <div className="disp-lista">
            <section className="settings-card">
              <h2>Por persona</h2>
              <ul className="revision-list">
                {r.personas.map((x) => (
                  <li key={x.actorName} className="revision-item">
                    <b>{x.actorName}</b>: {x.total} {x.total === 1 ? "cambio" : "cambios"} en {x.eventos} {x.eventos === 1 ? "evento" : "eventos"}
                    {x.mismoDia > 0 ? ` · ${x.mismoDia} el día del evento o después` : ""}
                  </li>
                ))}
              </ul>
            </section>
            <section className="settings-card">
              <h2>Por evento</h2>
              {r.eventos.map((e) => (
                <details key={e.eventId} className="tardio-evento">
                  <summary>
                    <b>{e.lugar}</b> · {fmtEvento(e.date)} · {e.total} {e.total === 1 ? "cambio" : "cambios"}
                    {e.mismoDia > 0 && <span className="disp-alarma"> · {e.mismoDia} el día del evento o después</span>}
                  </summary>
                  <ul className="revision-list">
                    {e.cambios.map((c) => (
                      <li key={c.id} className={`revision-item${c.mismoDia ? " grav-alta" : ""}`}>
                        {fmtMomento(c.at)} · {c.actorName} · {describirCambio(c)}
                      </li>
                    ))}
                  </ul>
                  {e.total > e.cambios.length && (
                    <p className="notif-enable-note">Se listan los últimos {e.cambios.length} de {e.total}.</p>
                  )}
                </details>
              ))}
            </section>
          </div>
        )}
      </div>
    </>
  );
}
