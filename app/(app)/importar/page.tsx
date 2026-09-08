import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canAdministrarComprobantes } from "@/lib/permissions";
import { activas } from "@/lib/comprobantes/entidades";
import { prismaComprobantes as db } from "@/lib/db-comprobantes";
import { ImportarArca } from "@/components/ImportarArca";

export const dynamic = "force-dynamic";
export const metadata = { title: "Importar de ARCA" };

/**
 * Traer las facturas que el fisco ya conoce.
 *
 * La captura por foto cubre lo que llega al depósito, pero solo eso. Esto
 * contesta la otra mitad: **qué facturas existen que nadie trajo**.
 */
export default async function ImportarPage() {
  const sesion = await getSessionUser();
  if (!sesion) redirect("/login");
  if (!canAdministrarComprobantes(sesion.role)) redirect("/");

  const [entidades, previas] = await Promise.all([
    activas(),
    // El historial de importaciones. Es lo que después contesta "¿cuántas
    // facturas aparecieron que nadie había traído?", que es la pregunta que
    // motivó toda esta etapa.
    db.arcaImport.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Importar de ARCA</h1>
          <div className="sub">Las facturas que el fisco ya conoce</div>
        </div>
      </div>
      <div className="content">
        <p className="msub">
          Entrá a <strong>arca.gob.ar</strong> con la clave fiscal, abrí{" "}
          <strong>Mis Comprobantes → Recibidos</strong>, elegí el período y descargá el CSV.
          No lo abras en Excel: le cambia el formato.
        </p>

        <ImportarArca entidades={entidades.map((e) => ({ id: e.id, nombre: e.nombre }))} />

        {previas.length > 0 && (
          <section className="imp-historial">
            <h2>Importaciones anteriores</h2>
            <ul>
              {previas.map((p) => (
                <li key={p.id}>
                  <strong>{p.archivo}</strong>
                  <span className="msub">
                    {p.desde ? `${p.desde} al ${p.hasta} · ` : ""}
                    {p.creadas} nueva{p.creadas === 1 ? "" : "s"}, {p.completadas} completada
                    {p.completadas === 1 ? "" : "s"}
                    {p.discrepancias > 0 ? `, ${p.discrepancias} diferencia${p.discrepancias === 1 ? "" : "s"}` : ""}
                    {" · "}
                    {p.actorName}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
