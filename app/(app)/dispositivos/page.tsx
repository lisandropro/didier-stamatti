import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canManageUsers, ROLE_LABEL } from "@/lib/permissions";
import { estadoDeDispositivos, FALLOS_PARA_ALARMA } from "@/lib/dispositivos";
import { fmtMomento } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function DispositivosPage() {
  // Como el resto: la pantalla comprueba su propio permiso, no se apoya en que
  // no haya un enlace.
  const sesion = await getSessionUser();
  if (!sesion || !canManageUsers(sesion.role)) notFound();

  const personas = await estadoDeDispositivos();

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Dispositivos</h1>
          <div className="sub">A quién le llegan los avisos, y a quién no</div>
        </div>
      </div>
      <div className="content">
        <div className="disp-lista">
          {personas.map((p) => (
            <section key={p.id} className="settings-card">
              <h2>
                {p.name} <span className="count-pill">{ROLE_LABEL[p.role] ?? p.role}</span>
              </h2>
              {p.dispositivos.length === 0 ? (
                <p className="disp-alarma">
                  Ningún teléfono: no le llega ningún aviso. Tiene que entrar a Avisos y tocar “Activar notificaciones”.
                </p>
              ) : (
                <ul className="revision-list">
                  {p.dispositivos.map((d) => (
                    <li key={d.id} className={`revision-item${d.noLeLlega ? " grav-alta disp-alarma" : ""}`}>
                      <b>{d.descripcion}</b> · activado {fmtMomento(d.alta)} ·{" "}
                      {d.lastOkAt ? `último aviso que llegó: ${fmtMomento(d.lastOkAt)}` : "todavía no le llegó ninguno"}
                      {d.lastErrorAt ? ` · último error: ${fmtMomento(d.lastErrorAt)}` : ""}
                      {d.noLeLlega ? ` · NO LE LLEGA: fallaron los últimos ${FALLOS_PARA_ALARMA} envíos` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
