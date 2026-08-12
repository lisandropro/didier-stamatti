import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";

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
  FINDE: "Fin de semana",
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
  FINDE: "crit",
};

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

  const evento = aviso.eventId
    ? await prisma.event.findUnique({ where: { id: aviso.eventId }, select: { lugar: true, deletedAt: true } })
    : null;

  // Los cambios de esta tanda: desde que arrancó, sobre este pedido, de esta persona.
  const cambios = aviso.eventId
    ? await prisma.orderChange.findMany({
        where: { eventId: aviso.eventId, actorName: aviso.actorName, createdAt: { gte: aviso.sinceAt } },
        orderBy: { createdAt: "asc" },
      })
    : [];

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
          <Link className="btn primary" href={`/evento/${aviso.eventId}`}>Abrir el pedido</Link>
        )}
      </div>

      <div className="content">
        {evento?.deletedAt && (
          <div className="banner crit">
            <div>
              <b>Este evento está en la papelera</b>
              <p>Se borró después de estos cambios. Se puede recuperar desde Fin de semana → Papelera.</p>
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
              <table>
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
                      <td>
                        <span className={`chip ${KIND_CLASS[c.kind] ?? "neutral"}`}>
                          {KIND_LABEL[c.kind] ?? c.kind}
                        </span>
                      </td>
                      <td className="dim">{c.before ?? "—"}</td>
                      <td>
                        {c.after ? <span className="stocknum">{c.after}</span> : <span className="dim">—</span>}
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
