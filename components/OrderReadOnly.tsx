"use client";

import { CATEGORIES as ORDEN, nombreDeCategoria } from "@/lib/categories";

import Link from "next/link";
import { useState } from "react";
import { ShortagesModal } from "@/components/ShortagesModal";
import { ResponsableEditor } from "@/components/ResponsableEditor";
import { computeShortage } from "@/lib/shortage-rule";

const IconWarn = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </svg>
);
const IconBack = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
);
const IconPrint = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M7 8V3.5h10V8M7 17h10v3.5H7z" /><path d="M4.5 8h15a1.5 1.5 0 0 1 1.5 1.5V16h-4M3 16h4M3 9.5A1.5 1.5 0 0 1 4.5 8" />
  </svg>
);

type Row = {
  id: string;
  name: string;
  category: string;
  rubro: string | null;
  type: string;
  unit: string;
  stock: number | null;
  reserved: number;
  qty: number;
  note: string;
};
type CustomLine = { id: string; name: string; unit: string | null; qty: number; note: string | null; category: string };


/**
 * El pedido en modo lectura, para quien no puede modificarlo.
 *
 * Es una pantalla aparte y no el armador con los controles apagados: apagar
 * veinte controles uno por uno es fácil de arruinar la próxima vez que se
 * agregue otro. Acá directamente no existe ninguno.
 */
export function OrderReadOnly({
  data,
}: {
  data: {
    event: { id: string; lugar: string; subLabel: string; status: string; responsable: string | null };
    products: Row[];
    customLines: CustomLine[];
    canSetResponsable: boolean;
  };
}) {
  const [verFaltantes, setVerFaltantes] = useState(false);

  const pedidos = data.products.filter((p) => p.qty > 0);
  const faltantes = pedidos.filter((p) =>
    computeShortage({
      productId: p.id,
      name: p.name,
      unit: p.unit,
      rubro: p.rubro,
      type: p.type,
      stock: p.stock,
      requested: p.qty,
      otherRequested: p.reserved,
    })
  );

  const total = pedidos.length + data.customLines.length;

  return (
    <>
      <div className="topbar topbar-pedido">
        <Link className="topbar-volver solo-celular" href="/" aria-label="Volver">{IconBack}</Link>
        <div className="topbar-titulo">
          <h1>{data.event.lugar}</h1>
          <div className="sub">
            <span className="sub-datos">
              {data.event.subLabel} · {total} producto{total === 1 ? "" : "s"} en el pedido
            </span>
            {/* En el celular la falta de controles ya dice que es de solo lectura,
                y el chip dejaba la fecha cortada en "Sáb 17/10 · …". */}
            <span className="chip neutral sub-chip solo-ancho">Solo lectura</span>
          </div>
        </div>
        <div className="spacer" />
        <Link className="btn ghost solo-ancho" href="/">Volver</Link>
        {faltantes.length > 0 && (
          <button
            className="btn btn-falta btn-falta-top"
            onClick={() => setVerFaltantes(true)}
            aria-label={`Ver faltantes (${faltantes.length})`}
          >
            {IconWarn} <span className="solo-ancho">Ver faltantes</span> <span className="count-pill">{faltantes.length}</span>
          </button>
        )}
        <Link className="btn ghost solo-ancho" href={`/evento/${data.event.id}/pdf`}>
          {IconPrint}
          PDF del pedido
        </Link>
        {/* En el celular el PDF es un ícono: es la única acción, no hace falta menú. */}
        <Link className="btn ghost topbar-icono solo-celular" href={`/evento/${data.event.id}/pdf`} aria-label="PDF del pedido">
          {IconPrint}
        </Link>
      </div>

      <div className="content">
        <div className="ro-resp">
          <span className="ro-resp-label">Responsable de la fiesta</span>
          <ResponsableEditor
            eventId={data.event.id}
            responsable={data.event.responsable}
            canEdit={data.canSetResponsable}
          />
        </div>

        {total === 0 ? (
          <div className="empty-card">
            <p className="empty-title">Este pedido todavía no tiene productos</p>
            <p>Cuando el equipo lo cargue, lo vas a ver acá.</p>
          </div>
        ) : (
          ORDEN.map((cat) => {
            const delSector = pedidos.filter((p) => p.category === cat);
            const extras = data.customLines.filter((l) => l.category === cat);
            if (delSector.length === 0 && extras.length === 0) return null;
            return (
              <section key={cat} className="ro-section">
                <div className="section-title">
                  {nombreDeCategoria(cat)}
                  <span className="count-pill">{delSector.length + extras.length}</span>
                </div>
                <div className="tablewrap">
                  <table className="ro-tabla">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>Cantidad</th>
                        <th>Nota</th>
                      </tr>
                    </thead>
                    <tbody>
                      {delSector.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <div className="prod">{p.name}</div>
                            <div className="rubro">{p.rubro ?? ""}</div>
                          </td>
                          <td>
                            <span className="stocknum">{p.qty}</span>
                            {p.unit !== "Unidad" ? <span className="dim"> {p.unit}</span> : null}
                          </td>
                          <td className="dim">{p.note || ""}</td>
                        </tr>
                      ))}
                      {extras.map((l) => (
                        <tr key={l.id}>
                          <td>
                            <div className="prod">{l.name}</div>
                            <div className="rubro">Fuera de catálogo</div>
                          </td>
                          <td>
                            <span className="stocknum">{l.qty}</span>
                            {l.unit ? <span className="dim"> {l.unit}</span> : null}
                          </td>
                          <td className="dim">{l.note ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })
        )}
      </div>

      {verFaltantes && (
        <ShortagesModal
          eventId={data.event.id}
          lugar={data.event.lugar}
          onClose={() => setVerFaltantes(false)}
        />
      )}
    </>
  );
}
