import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { fmtEventDate } from "@/lib/format";
import { PrintButton, PrintSectorButton } from "@/components/PrintButton";
import { PrintablePedido, type Bloque } from "@/components/PrintablePedido";
import { ShareOrderButton } from "@/components/ShareOrderButton";
import { Cartel } from "@/components/Cartel";
import { PickList } from "@/components/PickList";
import { CATEGORIES as SECTORS, CATEGORY_LABEL, llevaCartel } from "@/lib/categories";
import { sectoresConPedido } from "@/lib/order-sections";
import type { PickItem } from "@/lib/picklist";

export const dynamic = "force-dynamic";

const IconDown = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M12 3v12M8 11l4 4 4-4" /><path d="M4 17v2.5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V17" />
  </svg>
);



export default async function EventoPdfPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ev = await prisma.event.findUnique({ where: { id } });
  if (!ev || ev.deletedAt) notFound();

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

  // Los bloques que se imprimen, en el orden en que salen de la impresora y
  // etiquetados por tipo: así cada botón manda a imprimir solo lo suyo.
  const bloques: Bloque[] = [];
  for (const sector of SECTORS) {
    const bucket = bySector.get(sector)!;
    if (bucket.products.length === 0 && bucket.customs.length === 0) continue;
    if (llevaCartel(sector)) {
      bloques.push({
        clave: `cartel-${sector}`,
        tipo: "cartel",
        sector,
        nodo: <Cartel sector={sector} lugar={ev.lugar} dateLabel={fmtEventDate(ev.date)} />,
      });
    }
    bloques.push({
      clave: `sec-${sector}`,
      tipo: "seccion",
      sector,
      nodo: (
        <div className="pdf-section">
          <div className="pdf-header">
            <span className="logo-mark pdf-logo" role="img" aria-label="Didier Stamatti Catering" />
            <h1 className="pdf-title">{CATEGORY_LABEL[sector]}</h1>
          </div>
          {eventInfo}
          <PickList products={bucket.products} customs={bucket.customs} />
          <div className="pdf-footer">
            Preparado por: _______________________ &nbsp;&nbsp;&nbsp; Revisado por: _______________________
          </div>
        </div>
      ),
    });
  }
  const carteles = bloques.filter((b) => b.tipo === "cartel").length;

  // Los sectores que se pueden despachar solos. Sale de la misma función que
  // usa la ruta del PDF, así el botón nunca ofrece algo que el archivo no trae.
  const sectores = sectoresConPedido(
    lines.map((l) => ({
      categoria: l.product ? l.product.category : (l.customCategory ?? "ENSERES"),
      esDeCatalogo: Boolean(l.product),
    }))
  );

  return (
    <>
      <div className="topbar no-print">
        <div>
          <h1>PDF del pedido</h1>
          <div className="sub">
            {ev.lugar} · una hoja por sector{carteles > 0 ? ` · ${carteles} cartelito${carteles === 1 ? "" : "s"}` : ""}
          </div>
        </div>
        <div className="spacer" />
        <Link className="btn ghost" href={`/evento/${ev.id}`}>Volver</Link>
        {/* Enlace común, no <Link>: la ruta devuelve un archivo, no una pantalla. */}
        <a className="btn ghost" href={`/api/evento/${ev.id}/pdf-file`} download>
          {IconDown} Descargar
        </a>
        <PrintButton hayCarteles={carteles > 0} />
        <ShareOrderButton eventId={ev.id} lugar={ev.lugar} dateLabel={fmtEventDate(ev.date)} disabled={totalItems === 0} />
      </div>

      <div className="content pdf-content">
        {/* Cada sector, por separado: a quien prepara la bebida no le sirven las
            hojas de mobiliario, y mandárselas lo obliga a buscar la suya entre
            papeles que no le tocan. Solo se ofrecen los que tienen algo pedido. */}
        {sectores.length > 0 && (
          <div className="no-print sector-block">
            <div className="sector-title">Mandar un sector solo</div>
            {sectores.map((s) => (
              <div key={s.key} className="sector-row">
                <div className="sector-name">
                  <b>{s.label}</b>
                  <span className="sector-count">
                    {s.lineas} {s.lineas === 1 ? "producto" : "productos"}
                  </span>
                </div>
                <div className="sector-acts">
                  <PrintSectorButton sector={s.key} />
                  <a className="btn ghost" href={`/api/evento/${ev.id}/pdf-file?sector=${s.key}`} download>
                    {IconDown} Descargar
                  </a>
                  <ShareOrderButton
                    eventId={ev.id}
                    lugar={ev.lugar}
                    dateLabel={fmtEventDate(ev.date)}
                    sector={s.key}
                    label={`Compartir ${s.label}`}
                    variant="ghost"
                  />
                  {llevaCartel(s.key) && (
                    <Link className="btn ghost" href={`/evento/${ev.id}/pdf/cartel/${s.key}`}>
                      Cartel
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {totalItems === 0 ? (
          <div className="empty-card">
            <p className="empty-title">Este pedido todavía no tiene productos cargados</p>
          </div>
        ) : (
          // Cartel y sección van como HERMANOS directos de .pdf-content (no anidados),
          // así ".pdf-content > *:not(:last-child)" corta hoja entre cada uno al imprimir.
          // Se arman etiquetados para que cada botón imprima solo su parte.
          <PrintablePedido bloques={bloques} />
        )}
      </div>
    </>
  );
}
