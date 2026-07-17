import { Fragment } from "react";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { fmtEventDate } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";
import { Cartel } from "@/components/Cartel";

export const dynamic = "force-dynamic";

const SECTORS = ["ENSERES", "MOBILIARIO", "BEBIDA"];
const CAT_LABEL: Record<string, string> = { ENSERES: "Enseres", BEBIDA: "Bebida", MOBILIARIO: "Mobiliario" };
// Solo Enseres y Bebida llevan cartel automático (van a depósitos distintos).
// Mobiliario se puede imprimir aparte desde /pdf/cartel/MOBILIARIO si hace falta.
const AUTO_CARTEL = new Set(["ENSERES", "BEBIDA"]);

type Row = { id: string; name: string; rubro: string | null; unit: string | null; qty: number; note: string | null };

export default async function EventoPdfPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ev = await prisma.event.findUnique({ where: { id } });
  if (!ev) notFound();

  const lines = await prisma.orderLine.findMany({
    where: { eventId: id },
    include: { product: true },
  });

  const bySector = new Map<string, { products: Row[]; customs: Row[] }>();
  for (const s of SECTORS) bySector.set(s, { products: [], customs: [] });

  for (const l of lines) {
    if (l.product) {
      const bucket = bySector.get(l.product.category);
      if (bucket) {
        bucket.products.push({
          id: l.id,
          name: l.product.name,
          rubro: l.product.rubro,
          unit: l.product.unit,
          qty: l.qty,
          note: l.note,
        });
      }
    } else {
      const cat = l.customCategory ?? "ENSERES";
      const bucket = bySector.get(cat);
      if (bucket) {
        bucket.customs.push({
          id: l.id,
          name: l.customName ?? "",
          rubro: null,
          unit: l.customUnit,
          qty: l.qty,
          note: l.note,
        });
      }
    }
  }
  for (const b of bySector.values()) {
    b.products.sort((a, b) => (a.rubro ?? "").localeCompare(b.rubro ?? "") || a.name.localeCompare(b.name));
  }

  const totalItems = lines.length;

  const eventInfo = (
    <div className="pdf-event-box">
      <div className="pdf-event-row">
        <span className="pdf-k">Lugar</span>
        <span className="pdf-v">{ev.lugar}</span>
      </div>
      <div className="pdf-event-row">
        <span className="pdf-k">Fecha</span>
        <span className="pdf-v">{fmtEventDate(ev.date)}</span>
      </div>
      <div className="pdf-event-row">
        <span className="pdf-k">Invitados</span>
        <span className="pdf-v">{ev.guests}</span>
      </div>
      <div className="pdf-event-row">
        <span className="pdf-k">Responsable</span>
        <span className="pdf-v">{ev.responsable || "—"}</span>
      </div>
    </div>
  );

  return (
    <>
      <div className="topbar no-print">
        <div>
          <h1>PDF del pedido</h1>
          <div className="sub">{ev.lugar} · vista de impresión, separado por sector</div>
        </div>
        <div className="spacer" />
        <Link className="btn ghost" href={`/evento/${ev.id}`}>Volver</Link>
        <PrintButton />
      </div>

      <div className="content pdf-content">
        <div className="no-print reprint-row">
          <span>Reimprimir un solo cartel:</span>
          {SECTORS.map((s) => (
            <Link key={s} className="btn ghost" href={`/evento/${ev.id}/pdf/cartel/${s}`}>
              {CAT_LABEL[s]}
            </Link>
          ))}
        </div>

        {totalItems === 0 ? (
          <div className="empty-card">
            <p className="empty-title">Este pedido todavía no tiene productos cargados</p>
          </div>
        ) : (
          SECTORS.filter((sector) => {
            const b = bySector.get(sector)!;
            return b.products.length > 0 || b.customs.length > 0;
          }).map((sector) => {
            const bucket = bySector.get(sector)!;
            return (
              // Cartel y sección van como HERMANOS directos de .pdf-content (no anidados),
              // así ".pdf-content > *:not(:last-child)" corta hoja entre cada uno al imprimir.
              <Fragment key={sector}>
                {AUTO_CARTEL.has(sector) && <Cartel sector={sector} lugar={ev.lugar} dateLabel={fmtEventDate(ev.date)} />}

                <div className="pdf-section">
                  <div className="pdf-header">
                    <span className="logo-mark pdf-logo" role="img" aria-label="Didier Stamatti Catering" />
                    <h1 className="pdf-title">{CAT_LABEL[sector]}</h1>
                  </div>

                  {eventInfo}

                  {bucket.products.length > 0 && (
                    <div className="tablewrap">
                      <table className="summary-table pdf-table">
                        <thead>
                          <tr>
                            <th className="checkcol"></th>
                            <th>Producto</th>
                            <th>Unidad</th>
                            <th>Cantidad</th>
                            <th>Nota</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bucket.products.map((l) => (
                            <tr key={l.id}>
                              <td className="checkcol"><span className="checkbox" /></td>
                              <td>
                                <div className="prod">{l.name}</div>
                                {l.rubro && <div className="rubro">{l.rubro}</div>}
                              </td>
                              <td className="dim">{l.unit !== "Unidad" ? l.unit : ""}</td>
                              <td><span className="stocknum">{l.qty}</span></td>
                              <td className="dim">{l.note ?? ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {bucket.customs.length > 0 && (
                    <>
                      <div className="section-title">Extras (fuera de catálogo)</div>
                      <div className="tablewrap">
                        <table className="summary-table pdf-table">
                          <thead>
                            <tr>
                              <th className="checkcol"></th>
                              <th>Ítem</th>
                              <th>Unidad</th>
                              <th>Cantidad</th>
                              <th>Nota</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bucket.customs.map((l) => (
                              <tr key={l.id}>
                                <td className="checkcol"><span className="checkbox" /></td>
                                <td className="prod">{l.name}</td>
                                <td className="dim">{l.unit ?? ""}</td>
                                <td><span className="stocknum">{l.qty}</span></td>
                                <td className="dim">{l.note ?? ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  <div className="pdf-footer">
                    Preparado por: _______________________ &nbsp;&nbsp;&nbsp; Revisado por: _______________________
                  </div>
                </div>
              </Fragment>
            );
          })
        )}
      </div>
    </>
  );
}
