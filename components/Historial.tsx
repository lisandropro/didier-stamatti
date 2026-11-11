"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { IconCal, IconHistory, IconSearch } from "@/components/iconos";
import { MOTIVOS_DE_STOCK, norm } from "@/components/util";

type PeriodRow = {
  id: string;
  label: string;
  rangeLabel: string;
  eventCount: number;
  hasSnapshot: boolean;
};
type MovementRow = {
  id: string;
  productName: string;
  unit: string;
  delta: number;
  reason: string;
  note: string | null;
  userName: string | null;
  dateLabel: string;
};
/** `movements` son los últimos; `totalMovimientos`, cuántos hay en total. */
type Data = { periodos: PeriodRow[]; movements: MovementRow[]; totalMovimientos: number };

const REASONS = [{ v: "TODOS", l: "Todos" }, ...MOTIVOS_DE_STOCK];
const REASON_LABEL: Record<string, string> = { ROTURA: "Rotura", PERDIDA: "Pérdida", COMPRA: "Compra", AJUSTE: "Ajuste" };
const REASON_CLASS: Record<string, string> = { ROTURA: "crit", PERDIDA: "crit", COMPRA: "ok", AJUSTE: "neutral" };

export function Historial({ data }: { data: Data }) {
  const [tab, setTab] = useState<"periodos" | "movements">("periodos");

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Historial</h1>
          <div className="sub">Períodos pasados y movimientos de stock</div>
        </div>
      </div>

      <div className="content">
        <div className="seg" style={{ maxWidth: 360, marginBottom: 20 }}>
          <button type="button" className={tab === "periodos" ? "active" : ""} aria-pressed={tab === "periodos"} onClick={() => setTab("periodos")}>
            Períodos pasados ({data.periodos.length})
          </button>
          <button type="button" className={tab === "movements" ? "active" : ""} aria-pressed={tab === "movements"} onClick={() => setTab("movements")}>
            Movimientos de stock ({data.totalMovimientos})
          </button>
        </div>

        {tab === "periodos" ? <PeriodosPasados periodos={data.periodos} /> : <Movements movements={data.movements} total={data.totalMovimientos} />}
      </div>
    </>
  );
}

function PeriodosPasados({ periodos }: { periodos: PeriodRow[] }) {
  if (periodos.length === 0) {
    return (
      <div className="empty-card">
        <p className="empty-title">Todavía no hay períodos pasados</p>
        <p>Cuando termine un período, va a aparecer acá para consultarlo cuando quieras.</p>
      </div>
    );
  }

  return (
    <div className="event-grid">
      {periodos.map((w) => (
        <Link key={w.id} href={`/?w=${w.id}`} className="event">
          <div className="row1">
            <h3>{w.label}</h3>
            {w.hasSnapshot && <span className="chip neutral">{IconHistory} Con versión guardada</span>}
          </div>
          <div className="meta">
            <span className="metaicon">{IconCal}<b>{w.rangeLabel}</b></span>
          </div>
          <div className="event-foot">
            {w.eventCount} evento{w.eventCount === 1 ? "" : "s"} · Abrir →
          </div>
        </Link>
      ))}
    </div>
  );
}

function Movements({ movements, total }: { movements: MovementRow[]; total: number }) {
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("TODOS");

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return movements.filter((m) => {
      if (reason !== "TODOS" && m.reason !== reason) return false;
      if (!q) return true;
      return norm(m.productName).includes(q);
    });
  }, [movements, query, reason]);

  if (movements.length === 0) {
    return (
      <div className="empty-card">
        <p className="empty-title">Todavía no hay movimientos de stock</p>
        <p>Los cambios que hagas en Inventario (roturas, pérdidas, compras, ajustes) van a quedar registrados acá.</p>
      </div>
    );
  }

  return (
    <>
      <div className="searchbar">
        <label className="search">
          {IconSearch}
          <input aria-label="Buscar producto" enterKeyHint="search" placeholder="Buscar producto…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {/* Como en Inventario: en el celular los motivos van en una sola fila que
            se desliza, no apilados en dos líneas. */}
        <div className="filtros-scroll">
          {REASONS.map((r) => (
            <button key={r.v} type="button" className={`tab${reason === r.v ? " active" : ""}`} aria-pressed={reason === r.v} onClick={() => setReason(r.v)}>
              {r.l}
            </button>
          ))}
        </div>
      </div>

      <div className="countnote">
        Mostrando {filtered.length} de {movements.length} movimientos
        {total > movements.length && ` (los ${movements.length} más recientes de ${total}; la búsqueda no llega a los anteriores)`}
      </div>

      <div className="tablewrap">
        <table className="tabla-lista">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Producto</th>
              <th>Motivo</th>
              <th>Cantidad</th>
              <th>Quién</th>
              <th>Nota</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td className="emptyrow" colSpan={6}>No hay movimientos que coincidan.</td>
              </tr>
            )}
            {filtered.map((m) => (
              <tr key={m.id}>
                <td className="dim" data-label="Fecha">{m.dateLabel}</td>
                <td className="prod celda-titulo">{m.productName}</td>
                <td data-label="Motivo"><span className={`chip ${REASON_CLASS[m.reason] ?? "neutral"}`}>{REASON_LABEL[m.reason] ?? m.reason}</span></td>
                <td data-label="Cantidad">
                  <span className="stocknum" style={{ color: m.delta > 0 ? "var(--ok)" : m.delta < 0 ? "var(--crit)" : undefined }}>
                    {m.delta > 0 ? `+${m.delta}` : m.delta}
                  </span>
                </td>
                <td className="dim" data-label="Quién">{m.userName ?? "—"}</td>
                <td className="dim" data-label="Nota">{m.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
