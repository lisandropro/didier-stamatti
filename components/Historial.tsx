"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type WeekendRow = {
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
  dateLabel: string;
};
type Data = { weekends: WeekendRow[]; movements: MovementRow[] };

const REASONS = [
  { v: "TODOS", l: "Todos" },
  { v: "ROTURA", l: "Rotura" },
  { v: "PERDIDA", l: "Pérdida" },
  { v: "COMPRA", l: "Compra" },
  { v: "AJUSTE", l: "Ajuste" },
];
const REASON_LABEL: Record<string, string> = { ROTURA: "Rotura", PERDIDA: "Pérdida", COMPRA: "Compra", AJUSTE: "Ajuste" };
const REASON_CLASS: Record<string, string> = { ROTURA: "crit", PERDIDA: "crit", COMPRA: "ok", AJUSTE: "neutral" };

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const IconCal = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>
);
const IconHistory = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 8v4l3 2" /></svg>
);

export function Historial({ data }: { data: Data }) {
  const [tab, setTab] = useState<"weekends" | "movements">("weekends");

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Historial</h1>
          <div className="sub">Fines de semana pasados y movimientos de stock</div>
        </div>
      </div>

      <div className="content">
        <div className="seg" style={{ maxWidth: 360, marginBottom: 20 }}>
          <button className={tab === "weekends" ? "active" : ""} onClick={() => setTab("weekends")}>
            Fines de semana ({data.weekends.length})
          </button>
          <button className={tab === "movements" ? "active" : ""} onClick={() => setTab("movements")}>
            Movimientos de stock ({data.movements.length})
          </button>
        </div>

        {tab === "weekends" ? <PastWeekends weekends={data.weekends} /> : <Movements movements={data.movements} />}
      </div>
    </>
  );
}

function PastWeekends({ weekends }: { weekends: WeekendRow[] }) {
  if (weekends.length === 0) {
    return (
      <div className="empty-card">
        <p className="empty-title">Todavía no hay fines de semana pasados</p>
        <p>Cuando termine un fin de semana, va a aparecer acá para consultarlo cuando quieras.</p>
      </div>
    );
  }

  return (
    <div className="event-grid">
      {weekends.map((w) => (
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

function Movements({ movements }: { movements: MovementRow[] }) {
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>
          <input placeholder="Buscar producto…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {REASONS.map((r) => (
          <button key={r.v} className={`tab${reason === r.v ? " active" : ""}`} onClick={() => setReason(r.v)}>
            {r.l}
          </button>
        ))}
      </div>

      <div className="countnote">
        Mostrando {filtered.length} de {movements.length} movimientos
      </div>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Producto</th>
              <th>Motivo</th>
              <th>Cantidad</th>
              <th>Nota</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td className="emptyrow" colSpan={5}>No hay movimientos que coincidan.</td>
              </tr>
            )}
            {filtered.map((m) => (
              <tr key={m.id}>
                <td className="dim">{m.dateLabel}</td>
                <td className="prod">{m.productName}</td>
                <td><span className={`chip ${REASON_CLASS[m.reason] ?? "neutral"}`}>{REASON_LABEL[m.reason] ?? m.reason}</span></td>
                <td>
                  <span className="stocknum" style={{ color: m.delta > 0 ? "var(--ok)" : m.delta < 0 ? "var(--crit)" : undefined }}>
                    {m.delta > 0 ? `+${m.delta}` : m.delta}
                  </span>
                </td>
                <td className="dim">{m.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
