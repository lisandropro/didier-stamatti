import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { canVerStock } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/format";
import { cambiosDeLaTanda } from "@/lib/notify";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  AGREGADO: "Agregado",
  QUITADO: "Sacado",
  CANTIDAD: "Cantidad",
  NOTA: "Nota",
  COPIADO: "Pedido copiado",
  RESPONSABLE: "Responsable",
  LUGAR: "Nombre",
  FECHA: "Fecha",
  INVITADOS: "Invitados",
  PERIODO: "Período",
  ESTADO: "Estado",
  PAPELERA: "Papelera",
};
const KIND_CLASS: Record<string, string> = {
  AGREGADO: "ok",
  QUITADO: "crit",
  CANTIDAD: "warn",
  NOTA: "neutral",
  COPIADO: "neutral",
  RESPONSABLE: "warn",
  LUGAR: "warn",
  FECHA: "warn",
  INVITADOS: "warn",
  PERIODO: "crit",
  PAPELERA: "crit",
};

// El color sale del tipo, salvo en el estado: ahí depende del valor. Verde para
// todo el tipo hacía que "Volvió a borrador" (el evento deja de estar listo) se
// viera como una buena noticia; con `warn` pide fijarse, como los demás cambios
// que obligan a revisar el pedido.
function claseDelCambio(kind: string, after: string | null): string {
  if (kind === "ESTADO") return after === "LISTO" ? "ok" : "warn";
  return KIND_CLASS[kind] ?? "neutral";
}

// El estado y la papelera se guardan como códigos (NO_LISTO, BORRADO), que sirven
// para comparar pero no para leer. Se traducen solo al mostrar: lo guardado no cambia.
const VALOR_LEGIBLE: Record<string, Record<string, string>> = {
  ESTADO: { LISTO: "Listo", NO_LISTO: "Borrador" },
  PAPELERA: { VIVO: "En su período", BORRADO: "En la papelera" },
};
function valorLegible(kind: string, valor: string | null): string | null {
  if (valor === null) return null;
  return VALOR_LEGIBLE[kind]?.[valor] ?? valor;
}

export default async function AvisoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const aviso = await prisma.notification.findUnique({ where: { id } });
  // Cada quien ve solo sus propios avisos.
  if (!aviso || aviso.recipientId !== user.id) notFound();

  // Abrirlo cuenta como leerlo. Es idempotente: volver a entrar no cambia nada.
  if (!aviso.read) {
    await prisma.notification.update({ where: { id }, data: { read: true } });
  }

  // "Qué cambió" es solo de los cambios de pedido. Los avisos del sistema
  // anteriores a que existiera `linkUrl` también llegan acá, y mostrarles una
  // tabla de cambios vacía (o los cambios de otra cosa) confunde.
  if (aviso.type !== "ORDER_EDIT") redirect(aviso.linkUrl ?? "/notificaciones");

  const evento = aviso.eventId
    ? await prisma.event.findUnique({ where: { id: aviso.eventId }, select: { lugar: true, deletedAt: true } })
    : null;

  // Los cambios de ESTA tanda y no los de las siguientes: ver cambiosDeLaTanda.
  const cambios = await cambiosDeLaTanda(aviso);
  // En el aviso que avisa justamente el borrado, "se borró después de estos
  // cambios" sería falso: el borrado ES el cambio.
  const avisaElBorrado = cambios.some((c) => c.kind === "PAPELERA" && c.after === "BORRADO");

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Qué cambió</h1>
          <div className="sub">
            {evento ? `Pedido de ${evento.lugar}` : "Pedido"} · {aviso.actorName} · {fmtDateTime(aviso.createdAt)}
          </div>
        </div>
        <div className="spacer" />
        <Link className="btn ghost" href="/notificaciones">Volver a los avisos</Link>
        {aviso.eventId && !evento?.deletedAt && (
          // Quien no ve el editor (el depósito) va a la preparación del evento.
          canVerStock(user.role)
            ? <Link className="btn primary" href={`/evento/${aviso.eventId}`}>Abrir el pedido</Link>
            : <Link className="btn primary" href={`/preparar/${aviso.eventId}`}>Ver en Preparar</Link>
        )}
      </div>

      <div className="content">
        {evento?.deletedAt && (
          <div className="banner crit">
            <div>
              <b>Este evento está en la papelera</b>
              <p>
                {!avisaElBorrado && "Se borró después de estos cambios. "}
                Se puede recuperar desde Períodos → Papelera.
              </p>
            </div>
          </div>
        )}

        {cambios.length === 0 ? (
          <div className="empty-card">
            <p className="empty-title">No quedó registrado el detalle de este cambio</p>
            <p>Los avisos anteriores al 10/08/2026 no guardaban el detalle. Los nuevos sí.</p>
          </div>
        ) : (
          <>
            <div className="countnote">
              {cambios.length} {cambios.length === 1 ? "cambio" : "cambios"} · desde {fmtDateTime(aviso.sinceAt)}
            </div>
            <div className="tablewrap">
              <table className="tabla-lista">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Qué pasó</th>
                    <th>Antes</th>
                    <th>Ahora</th>
                  </tr>
                </thead>
                <tbody>
                  {cambios.map((c) => (
                    <tr key={c.id}>
                      <td className="prod">{c.itemName}</td>
                      <td data-label="Qué pasó">
                        <span className={`chip ${claseDelCambio(c.kind, c.after)}`}>
                          {KIND_LABEL[c.kind] ?? c.kind}
                        </span>
                      </td>
                      <td className="dim" data-label="Antes">{valorLegible(c.kind, c.before) ?? "—"}</td>
                      <td data-label="Ahora">
                        {c.after ? <span className="stocknum">{valorLegible(c.kind, c.after)}</span> : <span className="dim">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
