import { Fragment } from "react";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { fmtEventDate } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";
import { ShareOrderButton } from "@/components/ShareOrderButton";
import { Cartel } from "@/components/Cartel";
import { PickList } from "@/components/PickList";
import type { PickItem } from "@/lib/picklist";

export const dynamic = "force-dynamic";

const SECTORS = ["ENSERES", "MOBILIARIO", "BEBIDA"];
const CAT_LABEL: Record<string, string> = { ENSERES: "Enseres", BEBIDA: "Bebida", MOBILIARIO: "Mobiliario" };
// Solo Enseres y Bebida llevan cartel automático (van a depósitos distintos).
// Mobiliario se puede imprimir aparte desde /pdf/cartel/MOBILIARIO si hace falta.
const AUTO_CARTEL = new Set(["ENSERES", "BEBIDA"]);

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

  const bySector = new Map<string, { products: PickItem[]; customs: PickItem[] }>();
  for (const s of SECTORS) bySector.set(s, { products: [], customs: [] });

  for (const l of lines) {
    if (l.product) {
      bySector.get(l.product.category)?.products.push({
        id: l.id,
        name: l.product.name,
        rubro: l.product.rubro,
        unit: l.product.unit,
        qty: l.qty,
        note: l.note,
      });
    } else {
      bySector.get(l.customCategory ?? "ENSERES")?.customs.push({
        id: l.id,
        name: l.customName ?? "",
        unit: l.customUnit,
        qty: l.qty,
        note: l.note,
      });
    }
  }
  for (const b of bySector.values()) {
    b.products.sort((a, b) => (a.rubro ?? "").localeCompare(b.rubro ?? "") || a.name.localeCompare(b.name));
  }

  const totalItems = lines.length;

  const eventInfo = (
    <div className="pdf-event-box">
      <div className="pdf-event-row"><span className="pdf-k">Lugar</span><span className="pdf-v">{ev.lugar}</span></div>
      <div className="pdf-event-row"><span className="pdf-k">Fecha</span><span className="pdf-v">{fmtEventDate(ev.date)}</span></div>
      <div className="pdf-event-row"><span className="pdf-k">Invitados</span><span className="pdf-v">{ev.guests}</span></div>
      <div className="pdf-event-row"><span className="pdf-k">Responsable</span><span className="pdf-v">{ev.responsable || "—"}</span></div>
    </div>
  );

  return (
    <>
      <div className="topbar no-print">
        <div>
          <h1>PDF del pedido</h1>
          <div className="sub">{ev.lugar} · una hoja por sector</div>
        </div>
        <div className="spacer" />
        <Link className="btn ghost" href={`/evento/${ev.id}`}>Volver</Link>
        {/* Enlace común, no <Link>: la ruta devuelve un archivo, no una pantalla. */}
        <a className="btn ghost" href={`/api/evento/${ev.id}/pdf-file`} download>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 3v12M8 11l4 4 4-4" /><path d="M4 17v2.5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V17" />
          </svg>
          Descargar
        </a>
        <PrintButton />
        <ShareOrderButton eventId={ev.id} lugar={ev.lugar} dateLabel={fmtEventDate(ev.date)} disabled={totalItems === 0} />
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

                  <PickList products={bucket.products} customs={bucket.customs} />

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
