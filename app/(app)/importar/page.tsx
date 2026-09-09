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
        <p className="intro">
          Entrá a <strong>arca.gob.ar</strong> con la clave fiscal, abrí{" "}
          <strong>Mis Comprobantes → Recibidos</strong>, elegí el período y descargá el CSV.
          Te lo va a bajar en un <strong>.zip</strong>: descomprimilo y subí el archivo que hay
          adentro. No lo abras en Excel: le cambia el formato.
        </p>

        <ImportarArca entidades={entidades.map((e) => ({ id: e.id, nombre: e.nombre }))} />

        {/* Sin historial, la pantalla no dice nada de lo que hace. Y es la única
            de la app que se usa una vez por mes: nadie se acuerda de qué
            esperaba. Los tres resultados son los que devuelve el importador,
            así que esto es la pantalla explicándose con lo que realmente hace. */}
        {previas.length === 0 && (
          <section className="imp-que-hace">
            <h2>Qué va a pasar cuando subas el archivo</h2>
            <dl>
              <div>
                <dt>Van a aparecer las facturas que nadie trajo</dt>
                <dd>
                  El fisco ya sabe qué te facturaron. Las que no estén cargadas entran solas, sin
                  foto. Es lo que contesta &ldquo;¿qué facturas hay que no tengo?&rdquo;.
                </dd>
              </div>
              <div>
                <dt>Las que ya están se completan con el dato exacto</dt>
                <dd>
                  ARCA le gana a una lectura automática, pero nunca a algo que corregiste a mano:
                  eso no se pisa, se te muestra la diferencia.
                </dd>
              </div>
              <div>
                <dt>Vas a ver primero, y confirmar después</dt>
                <dd>
                  El primer paso no guarda nada. Te dice cuántas se crean, cuántas se completan y
                  qué diferencias hay; recién ahí decidís.
                </dd>
              </div>
            </dl>
          </section>
        )}

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
