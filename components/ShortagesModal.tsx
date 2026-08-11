"use client";

import { useEffect, useState } from "react";
import { getEventShortages } from "@/app/actions/shortages";
import type { ShortageRow } from "@/lib/shortage-rule";

/** Panel informativo de faltantes de un evento. No modifica nada: solo lee. */
export function ShortagesModal({
  eventId,
  lugar,
  onClose,
}: {
  eventId: string;
  lugar: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ShortageRow[] | null>(null);
  const [weekendLabel, setWeekendLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    let vivo = true;
    getEventShortages(eventId).then((res) => {
      if (!vivo) return;
      if (!res.ok) return setError(res.error ?? "No se pudieron calcular los faltantes.");
      setRows(res.rows ?? []);
      setWeekendLabel(res.weekendLabel ?? null);
    });
    return () => {
      vivo = false;
    };
  }, [eventId]);

  const compartidos = rows?.filter((r) => r.causedByOthers).length ?? 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-xwide" onClick={(e) => e.stopPropagation()}>
        <h2>Faltantes de {lugar}</h2>
        <p className="modal-sub">
          El depósito es uno solo para todo el fin de semana{weekendLabel ? ` (${weekendLabel})` : ""}: lo que piden los
          otros eventos también descuenta. Esto es solo informativo, no cambia ningún pedido.
        </p>

        {error && <div className="form-error">{error}</div>}

        {rows === null && !error && <p className="trash-meta">Calculando…</p>}

        {rows?.length === 0 && (
          <div className="empty-card">
            <p className="empty-title">No falta nada para este evento</p>
            <p>Todo lo que pide entra en el stock disponible del fin de semana.</p>
          </div>
        )}

        {rows && rows.length > 0 && (
          <>
            {compartidos > 0 && (
              <div className="banner crit">
                <div>
                  <b>
                    {compartidos === 1
                      ? "1 producto ya estaba agotado antes de este evento"
                      : `${compartidos} productos ya estaban agotados antes de este evento`}
                  </b>
                  <p>
                    Los otros eventos del finde solos se pasan del stock, así que el faltante es del fin de semana y no de
                    este pedido. Están marcados abajo.
                  </p>
                </div>
              </div>
            )}

            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Pide este evento</th>
                    <th>Piden los otros</th>
                    <th>Total del finde</th>
                    <th>En el depósito</th>
                    <th>Disponible acá</th>
                    <th>Falta</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.productId}>
                      <td>
                        <div className="prod">{r.name}</div>
                        <div className="rubro">
                          {r.unit}
                          {r.rubro ? ` · ${r.rubro}` : ""}
                          {r.causedByOthers ? " · ya agotado por los otros eventos" : ""}
                        </div>
                      </td>
                      <td><span className="stocknum">{r.requested}</span></td>
                      <td className="dim">{r.otherRequested}</td>
                      <td><span className="stocknum">{r.totalRequested}</span></td>
                      <td className="dim">{r.stock}</td>
                      <td>
                        <span className="stocknum" style={{ color: r.available === 0 ? "var(--crit)" : undefined }}>
                          {r.available}
                        </span>
                      </td>
                      <td>
                        <span className="chip crit">{r.missing} {r.unit.toLowerCase()}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="modal-sub" style={{ marginTop: "var(--sp-4)" }}>
              <b>Disponible acá</b> es lo que queda del depósito después de lo que piden los otros eventos.{" "}
              <b>Falta</b> es cuánto habría que conseguir para que entren todos.
            </p>
          </>
        )}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
