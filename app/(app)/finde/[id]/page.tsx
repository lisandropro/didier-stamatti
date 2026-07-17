import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { fmtEventDate, fmtRange } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

const CAT_ORDER: Record<string, number> = { ENSERES: 0, MOBILIARIO: 1, BEBIDA: 2 };
const CAT_LABEL: Record<string, string> = { ENSERES: "Enseres", BEBIDA: "Bebida", MOBILIARIO: "Mobiliario" };

type Row = {
  productId: string;
  name: string;
  category: string;
  rubro: string | null;
  type: string;
  unit: string;
  stock: number;
  total: number;
  parts: { lugar: string; qty: number; note: string | null; order: number }[];
};

export default async function ResumenPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const weekend = await prisma.weekend.findUnique({
    where: { id },
    include: { events: { orderBy: { date: "asc" } } },
  });
  if (!weekend) notFound();

  const eventOrder = new Map(weekend.events.map((e, i) => [e.id, i]));

  const lines = await prisma.orderLine.findMany({
    where: { event: { weekendId: id } },
    include: { product: true, event: { select: { id: true, lugar: true } } },
  });

  // Consolidado de productos del catálogo
  const byProduct = new Map<string, Row>();
  for (const l of lines) {
    if (!l.product) continue;
    let row = byProduct.get(l.product.id);
    if (!row) {
      row = {
        productId: l.product.id,
        name: l.product.name,
        category: l.product.category,
        rubro: l.product.rubro,
        type: l.product.type,
        unit: l.product.unit,
        stock: l.product.stock,
        total: 0,
        parts: [],
      };
      byProduct.set(l.product.id, row);
    }
    row.total += l.qty;
    row.parts.push({
      lugar: l.event.lugar,
      qty: l.qty,
      note: l.note,
      order: eventOrder.get(l.event.id) ?? 99,
    });
  }
  const rows = [...byProduct.values()].filter((r) => r.total > 0);
  rows.sort(
    (a, b) =>
      (CAT_ORDER[a.category] ?? 9) - (CAT_ORDER[b.category] ?? 9) ||
      (a.rubro ?? "").localeCompare(b.rubro ?? "") ||
      a.name.localeCompare(b.name)
  );
  rows.forEach((r) => r.parts.sort((x, y) => x.order - y.order));

  // Extras (fuera de catálogo), en orden de evento
  const extras = lines
    .filter((l) => !l.productId)
    .map((l) => ({
      id: l.id,
      name: l.customName ?? "",
      unit: l.customUnit,
      qty: l.qty,
      note: l.note,
      lugar: l.event.lugar,
      order: eventOrder.get(l.event.id) ?? 99,
    }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const overCount = rows.filter((r) => r.type === "REUTILIZABLE" && r.total > r.stock).length;
  const multiEvent = weekend.events.length > 1;

  // Filas con separador de categoría
  const rendered: React.ReactNode[] = [];
  let lastCat = "";
  for (const r of rows) {
    if (r.category !== lastCat) {
      lastCat = r.category;
      rendered.push(
        <tr key={`cat-${r.category}`} className="cat-row">
          <td colSpan={5}>{CAT_LABEL[r.category] ?? r.category}</td>
        </tr>
      );
    }
    const reutil = r.type === "REUTILIZABLE";
    const st = !reutil
      ? { cls: "neutral", txt: "Se compra" }
      : r.total > r.stock
        ? { cls: "crit", txt: `Faltan ${r.total - r.stock}` }
        : r.total === r.stock
          ? { cls: "warn", txt: "Al límite" }
          : { cls: "ok", txt: "Alcanza" };
    rendered.push(
      <tr key={r.productId}>
        <td>
          <div className="prod">{r.name}</div>
          <div className="rubro">{r.rubro}{r.unit !== "Unidad" ? ` · por ${r.unit.toLowerCase()}` : ""}</div>
        </td>
        <td className="parts">
          {r.parts.map((p, i) => (
            <span key={i} className="part">
              {p.lugar} <b>{p.qty}</b>
              {p.note ? <em> ({p.note})</em> : null}
              {i < r.parts.length - 1 ? " · " : ""}
            </span>
          ))}
        </td>
        <td><span className="stocknum">{r.total}</span></td>
        <td className="dim">{reutil ? r.stock : "—"}</td>
        <td><span className={`chip ${st.cls}`}>{st.txt}</span></td>
      </tr>
    );
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Resumen del depósito</h1>
          <div className="sub">
            {weekend.label} · {fmtRange(weekend.startDate, weekend.endDate)} ·{" "}
            {weekend.events.map((e) => `${e.lugar} (${fmtEventDate(e.date)})`).join(" · ") || "sin eventos"}
          </div>
        </div>
        <div className="spacer" />
        <Link className="btn ghost no-print" href={`/?w=${weekend.id}`}>Volver</Link>
        <PrintButton />
      </div>

      <div className="content">
        {rows.length === 0 && extras.length === 0 ? (
          <div className="empty-card">
            <p className="empty-title">Los pedidos de este fin de semana están vacíos</p>
            <p>Cargá productos en los eventos y acá vas a ver el total a preparar en el depósito.</p>
            <Link className="btn primary" href={`/?w=${weekend.id}`}>Ir a los eventos</Link>
          </div>
        ) : (
          <>
            <div className="summary-note">
              Total a preparar sumando {weekend.events.length} evento{weekend.events.length === 1 ? "" : "s"} ·{" "}
              {rows.length} producto{rows.length === 1 ? "" : "s"}
              {extras.length > 0 ? ` · ${extras.length} extra${extras.length === 1 ? "" : "s"}` : ""}
              {overCount > 0 ? <span className="over"> · ⚠ {overCount} sin stock suficiente</span> : " · ✓ todo alcanza"}
            </div>

            {rows.length > 0 && (
              <div className="tablewrap">
                <table className="summary-table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>{multiEvent ? "Por evento" : "Evento"}</th>
                      <th>Total</th>
                      <th>Depósito</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>{rendered}</tbody>
                </table>
              </div>
            )}

            {extras.length > 0 && (
              <>
                <div className="section-title">Extras (fuera de catálogo)</div>
                <div className="tablewrap">
                  <table className="summary-table">
                    <thead>
                      <tr>
                        <th>Ítem</th>
                        <th>Evento</th>
                        <th>Cantidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {extras.map((x) => (
                        <tr key={x.id}>
                          <td>
                            <div className="prod">{x.name}</div>
                            {x.note && <div className="rubro">{x.note}</div>}
                          </td>
                          <td className="dim">{x.lugar}</td>
                          <td>
                            <span className="stocknum">{x.qty}</span>
                            {x.unit ? <span className="dim"> {x.unit.toLowerCase()}</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
